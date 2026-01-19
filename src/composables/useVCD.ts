import type { Signal, DisplayFormat, TreeNode, SignalReference, SignalGroup } from '../types/waveform';
import { isSignalReference, isSignalGroup } from '../types/waveform';

// Helper to format value as binary string for VCD
// Supports both number and bigint for arbitrary bit widths
function toBinaryString(value: number | bigint, width: number): string {
  if (typeof value === 'bigint') {
    // Use BigInt's toString(2) for binary conversion
    const binStr = value.toString(2);
    // Handle negative values (shouldn't happen for unsigned, but be safe)
    if (binStr.startsWith('-')) {
      return '0'.repeat(width);
    }
    return binStr.padStart(width, '0');
  }
  return value.toString(2).padStart(width, '0');
}

function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const groupColors = [
  '#5C6BC0', // Indigo
  '#26A69A', // Teal
  '#FF7043', // Deep Orange
  '#AB47BC', // Purple
  '#42A5F5', // Blue
  '#66BB6A', // Green
];

export function useVCD() {

  function generateVCD(signals: Signal[], tree: TreeNode[], timescale: string = '1ns'): string {
    const lines: string[] = [];

    // Header
    lines.push('$date');
    lines.push(`   ${new Date().toISOString()}`);
    lines.push('$end');
    lines.push('$version');
    lines.push('   Waveform Editor 1.0');
    lines.push('$end');
    lines.push(`$timescale ${timescale} $end`);

    // Assign short identifiers to each signal (!, ", #, $, etc.)
    const signalIds = new Map<string, string>();
    let idIndex = 0;
    for (const signal of signals) {
      const id = String.fromCharCode(33 + idIndex); // Start from '!'
      signalIds.set(signal.id, id);
      idIndex++;
    }

    // Generate variable definitions with scope hierarchy
    function writeTreeNode(node: TreeNode) {
      if (isSignalGroup(node)) {
        // Open a scope for the group
        const scopeName = node.name.replace(/\s+/g, '_');
        lines.push(`$scope module ${scopeName} $end`);

        // Write children
        for (const child of node.children) {
          writeTreeNode(child);
        }

        // Close scope
        lines.push('$upscope $end');
      } else if (isSignalReference(node)) {
        const signal = signals.find(s => s.id === node.signalId);
        if (signal) {
          const id = signalIds.get(signal.id);
          if (id) {
            const width = signal.width || 1;
            if (width > 1) {
              // Vector signal with bus notation
              lines.push(`$var wire ${width} ${id} ${signal.name}[${width - 1}:0] $end`);
            } else {
              lines.push(`$var wire 1 ${id} ${signal.name} $end`);
            }
          }
        }
      }
    }

    // Write top-level scope
    lines.push('$scope module top $end');

    for (const node of tree) {
      writeTreeNode(node);
    }

    lines.push('$upscope $end');
    lines.push('$enddefinitions $end');

    // Collect all time points and sort them
    const allTimePoints = new Set<number>();
    signals.forEach(signal => {
      signal.points.forEach(point => {
        allTimePoints.add(point.x);
      });
    });

    const sortedTimes = Array.from(allTimePoints).sort((a, b) => a - b);

    // Initial values (dumpvars)
    lines.push('$dumpvars');
    signals.forEach(signal => {
      const id = signalIds.get(signal.id)!;
      const sortedPoints = [...signal.points].sort((a, b) => a.x - b.x);
      const firstPoint = sortedPoints[0];
      const initialLevel = firstPoint !== undefined ? firstPoint.level : 0;
      const width = signal.width || 1;
      if (width > 1) {
        // Vector: use binary format
        lines.push(`b${toBinaryString(initialLevel, width)} ${id}`);
      } else {
        // Single-bit: use simple format
        lines.push(`${initialLevel}${id}`);
      }
    });
    lines.push('$end');

    // Value changes
    for (const time of sortedTimes) {
      lines.push(`#${time}`);

      for (const signal of signals) {
        const id = signalIds.get(signal.id)!;
        const point = signal.points.find(p => p.x === time);
        if (point) {
          const width = signal.width || 1;
          if (width > 1) {
            // Vector: use binary format
            lines.push(`b${toBinaryString(point.level, width)} ${id}`);
          } else {
            // Single-bit: use simple format
            lines.push(`${point.level}${id}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  function parseVCD(content: string): { signals: Signal[], tree: TreeNode[], maxTime: number } {
    const lines = content.split('\n').map(l => l.trim());
    const signals: Signal[] = [];
    const varIdToSignal = new Map<string, Signal>();

    // Stack to track current scope hierarchy
    const scopeStack: { name: string; children: TreeNode[] }[] = [];
    let rootChildren: TreeNode[] = [];
    let currentChildren = rootChildren;

    let inHeader = true;
    let maxTime = 0;
    let currentTime = 0;
    let lineIndex = 0;
    let groupColorIndex = 0;

    // Parse header and variable definitions
    while (lineIndex < lines.length && inHeader) {
      const line = lines[lineIndex]!;

      if (line.startsWith('$scope')) {
        // Parse: $scope module scopeName $end
        const match = line.match(/\$scope\s+\w+\s+(\S+)/);
        if (match) {
          const scopeName = match[1]!;

          // Skip the top-level "top" scope
          if (scopeName !== 'top') {
            const newGroup: SignalGroup = {
              type: 'group',
              id: generateGroupId(),
              name: scopeName.replace(/_/g, ' '),
              color: groupColors[groupColorIndex % groupColors.length] ?? '#5C6BC0',
              isCollapsed: false,
              children: [],
            };
            groupColorIndex++;

            currentChildren.push(newGroup);
            scopeStack.push({ name: scopeName, children: currentChildren });
            currentChildren = newGroup.children;
          }
        }
      } else if (line.startsWith('$upscope')) {
        // Pop scope
        const popped = scopeStack.pop();
        if (popped) {
          currentChildren = popped.children;
        } else {
          currentChildren = rootChildren;
        }
      } else if (line.startsWith('$var')) {
        // Parse: $var wire 1 ! signalName $end
        // or: $var wire 8 ! data[7:0] $end
        const match = line.match(/\$var\s+\w+\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+\$end)?/);
        if (match) {
          const widthStr = match[1]!;
          const id = match[2]!;
          const name = match[3]!;
          const width = parseInt(widthStr, 10);
          // Clean up name: remove bus notation like [7:0] or [0]
          const cleanName = name.replace(/\[\d+:\d+\]$/, '').replace(/\[\d+\]$/, '').replace(/\s*\$end$/, '').replace(/\s+/g, '_');
          const signal: Signal = {
            id: `signal-${signals.length + 1}`,
            name: cleanName,
            points: [],
            color: getColorForIndex(signals.length),
            width: width,
            displayFormat: 'hex' as DisplayFormat,
          };
          signals.push(signal);
          varIdToSignal.set(id, signal);

          // Add signal reference to current scope
          const signalRef: SignalReference = {
            type: 'signal',
            id: generateNodeId(),
            signalId: signal.id,
          };
          currentChildren.push(signalRef);
        }
      } else if (line === '$enddefinitions $end' || line.startsWith('$enddefinitions')) {
        inHeader = false;
      }

      lineIndex++;
    }

    // Parse value changes
    while (lineIndex < lines.length) {
      const line = lines[lineIndex]!;

      if (line.startsWith('#')) {
        // Timestamp
        currentTime = parseInt(line.substring(1), 10);
        if (currentTime > maxTime) {
          maxTime = currentTime;
        }
      } else if (line.length >= 2 && (line[0] === '0' || line[0] === '1' || line[0] === 'x' || line[0] === 'z')) {
        // Single-bit value change: 0! or 1!
        const level = (line[0] === '1') ? 1 : 0;
        const id = line.substring(1);
        const signal = varIdToSignal.get(id);
        if (signal) {
          // Check if there's already a point at this time
          const existingIndex = signal.points.findIndex(p => p.x === currentTime);
          const existingPoint = signal.points[existingIndex];
          if (existingIndex !== -1 && existingPoint) {
            existingPoint.level = level;
          } else {
            signal.points.push({ x: currentTime, level });
          }
        }
      } else if (line.startsWith('b') || line.startsWith('B')) {
        // Binary value: b10101010 ! or B10101010 !
        const match = line.match(/[bB]([01xXzZ]+)\s+(\S+)/);
        if (match) {
          const value = match[1]!;
          const id = match[2]!;
          // Convert binary string to number/bigint (treat x/z as 0)
          const cleanValue = value.replace(/[xXzZ]/g, '0');
          const signal = varIdToSignal.get(id);
          if (signal) {
            // Use BigInt for vectors > 53 bits to avoid precision loss
            const level: number | bigint = signal.width > 53
              ? BigInt('0b' + cleanValue)
              : parseInt(cleanValue, 2);
            const existingIndex = signal.points.findIndex(p => p.x === currentTime);
            const existingPoint = signal.points[existingIndex];
            if (existingIndex !== -1 && existingPoint) {
              existingPoint.level = level;
            } else {
              signal.points.push({ x: currentTime, level });
            }
          }
        }
      }

      lineIndex++;
    }

    // Sort points in each signal
    for (const signal of signals) {
      signal.points.sort((a, b) => a.x - b.x);
    }

    return { signals, tree: rootChildren, maxTime };
  }

  function downloadVCD(signals: Signal[], tree: TreeNode[], filename: string = 'waveform.vcd') {
    const content = generateVCD(signals, tree);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    generateVCD,
    parseVCD,
    downloadVCD,
  };
}

const signalColors = [
  '#2196F3', // Blue
  '#4CAF50', // Green
  '#FF9800', // Orange
  '#9C27B0', // Purple
  '#F44336', // Red
  '#00BCD4', // Cyan
  '#795548', // Brown
  '#607D8B', // Blue Grey
];

function getColorForIndex(index: number): string {
  return signalColors[index % signalColors.length] ?? '#2196F3';
}
