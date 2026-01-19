import { WaveValue, toWaveValue } from './WaveValue';

export { WaveValue, toWaveValue };

export interface WavePoint {
  x: number;      // Time position in grid units
  level: number | bigint;  // For single-bit: 0 or 1. For vectors: numeric value (bigint for large values)
}

export type DisplayFormat = 'hex' | 'decimal' | 'binary';

export interface Signal {
  id: string;
  name: string;
  points: WavePoint[];
  color: string;
  width: number;              // Bit width (1 = single-bit, 2+ = vector)
  displayFormat: DisplayFormat;  // How to display vector values
  isDerived?: boolean;        // True if this signal was created by a sieve
  sieveId?: string;           // ID of the sieve that created this derived signal
}

export interface GridConfig {
  cellWidth: number;    // Width of one grid cell in pixels
  cellHeight: number;   // Height of one grid cell in pixels
  columns: number;      // Number of time divisions
}

export interface EditorState {
  signals: Signal[];
  gridConfig: GridConfig;
  selectedSignalId: string | null;
}

// Signal tree types for grouping
export interface SignalReference {
  type: 'signal';
  id: string;
  signalId: string;  // References Signal.id in the flat signals array
}

export interface SignalGroup {
  type: 'group';
  id: string;
  name: string;
  color: string;
  isCollapsed: boolean;
  children: TreeNode[];
}

export type TreeNode = SignalReference | SignalGroup;

// Type guards for tree nodes
export function isSignalReference(node: TreeNode): node is SignalReference {
  return node.type === 'signal';
}

export function isSignalGroup(node: TreeNode): node is SignalGroup {
  return node.type === 'group';
}

// Edge detection types for markers
export type EdgeType = 'rising' | 'falling' | 'any';

export interface Marker {
  id: string;
  x: number;        // Time position in grid units
  color: string;
  label?: string;   // Optional label for the marker
  sourceSignalId?: string;  // Signal that generated this marker
}

// Marker placement mode for manual marker creation
export type MarkerPlacementMode = 'off' | 'snap-grid' | 'snap-edge' | 'free';

// Monitor types for ready/valid interface monitoring
export interface MonitorConfig {
  clockSignalId: string | null;
  readySignalId: string | null;
  validSignalId: string | null;
  dataSignalId: string | null;
  enabled: boolean;
}

export interface Transaction {
  id: string;
  time: number;           // Time position when transaction occurred
  dataValue: number | bigint;  // Captured data value (bigint for large values)
  displayFormat: DisplayFormat;  // Format inherited from data signal
}

// Sieve region for visual annotations on waveforms
export interface SieveRegion {
  id: string;
  startX: number;         // Start time position in grid units
  endX: number;           // End time position in grid units
  color: string;          // Color with alpha, e.g., 'rgba(0, 255, 0, 0.3)'
  signalName?: string;    // If specified, only show on this signal; otherwise show on all
  signalId?: string;      // If specified, only show on this signal ID (more precise than name)
  label?: string;         // Optional label to display in the region
  tooltip?: string;       // Optional tooltip text shown on hover
}

// Modifications to an existing signal by a sieve
export interface SignalModification {
  id: string;
  sourceSignalId: string;
  sourceSignalName: string;
  sieveId: string;
  modifiedPoints: WavePoint[];
  timestamp: number;
}

// Signal created entirely by a sieve
export interface DerivedSignal {
  id: string;
  name: string;
  sieveId: string;
  width: number;
  displayFormat: DisplayFormat;
  color: string;
  points: WavePoint[];
  sourceSignalNames?: string[];
}
