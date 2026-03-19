<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted, nextTick, computed } from 'vue';
import type { Signal, GridConfig, WavePoint, DisplayFormat, TreeNode, MarkerPlacementMode, DerivedSignal, SieveRegion } from '../types/waveform';
import { isSignalReference, isSignalGroup } from '../types/waveform';
import SignalTreeNode from './SignalTreeNode.vue';
import SignalBrowser from './SignalBrowser.vue';
import ContextMenu from './ContextMenu.vue';
import type { MenuItem } from './ContextMenu.vue';
import { useVCD } from '../composables/useVCD';
import { useSimulation } from '../composables/useSimulation';
import { useSignalTree } from '../composables/useSignalTree';
import { useDragDrop } from '../composables/useDragDrop';
import { useMarkers } from '../composables/useMarkers';
import { useSieve } from '../composables/useSieve';
import { useViewport } from '../composables/useViewport';

const { downloadVCD, parseVCD } = useVCD();
const {
  simulators,
  selectedSimulator,
  topModule,
  currentProject,
  isConnected: simConnected,
  isCompiling,
  isSimulating,
  compileOutput,
  simulationOutput,
  simulatedSignals,
  error: simError,
  availableSimulators,
  canCompile,
  canSimulate,
  init: initSimulation,
  createProject,
  uploadFiles,
  compile,
  simulate,
  stopSimulation,
  clearError: clearSimError,
  clearOutput: clearSimOutput,
} = useSimulation();
const {
  sieves,
  sieveTransactions,
  sieveRegions,
  isRunning: sieveRunning,
  hasSieve,
  globalSieves,
  allDerivedSignals,
  pyodideLoading,
  addSieve,
  removeSieveById,
  toggleSieveById,
  addSieveToGroup,
  removeSieveFromGroup,
  setSieveGlobal,
  getSievesForGroup,
  executeSieveById,
  getEffectivePoints,
  isSignalModified,
} = useSieve();

// Show original data toggle (when true, displays original waveform instead of sieve-modified)
const showOriginalData = ref(false);

// Flag to prevent sieve re-execution during derived signal sync
const isSyncingDerivedSignals = ref(false);

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

let nextId = 1;
let colorIndex = 0;

function getNextColor(): string {
  const color = signalColors[colorIndex % signalColors.length] ?? '#2196F3';
  colorIndex++;
  return color;
}

function sanitizeName(name: string): string {
  return name.replace(/\s+/g, '_');
}

function createSignal(name?: string, width: number = 1, displayFormat: DisplayFormat = 'hex'): Signal {
  return {
    id: `signal-${nextId++}`,
    name: sanitizeName(name || `Signal_${nextId - 1}`),
    points: [{ x: 0, level: 0 }], // Start with initial value of 0 at position 0
    color: getNextColor(),
    width,
    displayFormat,
  };
}

const fileInputRef = ref<HTMLInputElement | null>(null);
const sieveInputRef = ref<HTMLInputElement | null>(null);
const verilogInputRef = ref<HTMLInputElement | null>(null);
const simulationPanelExpanded = ref(true);
const vectorBitWidth = ref(8);
const clockPeriod = ref(2);
const waveformHeight = ref(30); // Default height in pixels
const isEditMode = ref(true); // Toggle between edit mode and view-only mode
const editTool = ref<'draw' | 'select'>('draw'); // Current editing tool

// Selection state for copy/paste
interface SelectionState {
  startX: number;
  endX: number;
  signalIds: string[];
}
const selection = ref<SelectionState | null>(null);
const selectionClipboard = ref<{ signalId: string; points: { x: number; level: number | bigint }[] }[] | null>(null);

// Global selection dragging state (for multi-row selection)
const isSelectionDragging = ref(false);
const selectionDragStartX = ref<number | null>(null);
const selectionDragCurrentX = ref<number | null>(null);
const selectionDragSignals = ref<string[]>([]);

// Lazy loading: available signals pool (parsed from VCD but not yet rendered)
const availableSignals = ref<Signal[]>([]);
const availableTree = ref<TreeNode[]>([]);
const signalBrowserExpanded = ref(true);
const signalBrowserFilter = ref('');

const gridConfig = reactive<GridConfig>({
  cellWidth: 26,
  cellHeight: 60,
  columns: 20,
});

// Viewport management for efficient rendering
const signalsContainerRef = ref<HTMLElement | null>(null);
const gridConfigRef = computed(() => gridConfig);
const {
  scrollLeft,
  viewportBounds,
  handleScroll: handleViewportScroll,
  updateViewportWidth,
} = useViewport(gridConfigRef);

const signals = ref<Signal[]>([createSignal('CLK'), createSignal('DATA', 8)]);
const selectedSignalId = ref<string | null>(signals.value[0]?.id || null);

// Tree management
const {
  tree,
  allGroups,
  initializeTree,
  addGroup,
  createGroupFromSignals,
  addSubgroup,
  toggleCollapse,
  renameGroup,
  moveNode,
  moveToRoot,
  moveToGroup,
  ungroup,
  deleteGroupKeepChildren,
  addSignalReference,
  removeSignalReference,
  findNode,
} = useSignalTree(signals);

// Drag and drop
const { state: dragState, startDrag, endDrag, handleDragOver, handleDragLeave, getDropInfo } = useDragDrop();

// Markers
const { markers, addMarkersFromEdges, addMarker, clearAllMarkers, getNextMarkerColor } = useMarkers();
const markerPlacementMode = ref<MarkerPlacementMode>('off');


// Selection functions for copy/paste
function startSelectionDrag(startX: number, signalId: string) {
  isSelectionDragging.value = true;
  selectionDragStartX.value = startX;
  selectionDragCurrentX.value = startX;
  selectionDragSignals.value = [signalId];
  // Clear any previous selection when starting a new drag
  selection.value = null;
}

function updateSelectionDrag(currentX: number, signalId: string) {
  if (!isSelectionDragging.value || selectionDragStartX.value === null) return;

  // Update current X position
  selectionDragCurrentX.value = currentX;

  // Add signal to selection if not already included
  if (!selectionDragSignals.value.includes(signalId)) {
    selectionDragSignals.value = [...selectionDragSignals.value, signalId];
  }
}

function endSelectionDrag(endX: number) {
  if (!isSelectionDragging.value || selectionDragStartX.value === null) return;

  const minX = Math.min(selectionDragStartX.value, endX);
  const maxX = Math.max(selectionDragStartX.value, endX);

  // Only create selection if there's an actual range
  if (minX !== maxX && selectionDragSignals.value.length > 0) {
    selection.value = {
      startX: minX,
      endX: maxX,
      signalIds: [...selectionDragSignals.value],
    };
  }

  // Reset drag state
  isSelectionDragging.value = false;
  selectionDragStartX.value = null;
  selectionDragCurrentX.value = null;
  selectionDragSignals.value = [];
}

function cancelSelectionDrag() {
  isSelectionDragging.value = false;
  selectionDragStartX.value = null;
  selectionDragCurrentX.value = null;
  selectionDragSignals.value = [];
}

function clearSelection() {
  selection.value = null;
}

function copySelection() {
  if (!selection.value) return;

  const { startX, endX, signalIds } = selection.value;
  const copiedData: { signalId: string; points: { x: number; level: number | bigint }[] }[] = [];

  for (const signalId of signalIds) {
    const signal = signals.value.find(s => s.id === signalId);
    if (!signal) continue;

    // Get points within the selection range, normalized to start at 0
    const pointsInRange = signal.points
      .filter(p => p.x >= startX && p.x < endX)
      .map(p => ({ x: p.x - startX, level: p.level }));

    // Also capture the value at the start if there's no point exactly at startX
    const sortedPoints = [...signal.points].sort((a, b) => a.x - b.x);
    let valueAtStart: number | bigint = signal.width === 1 ? 0 : BigInt(0);
    for (const p of sortedPoints) {
      if (p.x > startX) break;
      valueAtStart = p.level;
    }

    // If no point at startX, add one with the value at start
    if (!pointsInRange.some(p => p.x === 0)) {
      pointsInRange.unshift({ x: 0, level: valueAtStart });
    }

    copiedData.push({ signalId, points: pointsInRange });
  }

  selectionClipboard.value = copiedData;
}

function pasteSelection(targetX: number) {
  if (!selectionClipboard.value || selectionClipboard.value.length === 0) return;

  for (const { signalId, points } of selectionClipboard.value) {
    const signal = signals.value.find(s => s.id === signalId);
    if (!signal) continue;

    // Shift points to target position
    const shiftedPoints = points.map(p => ({
      x: p.x + targetX,
      level: p.level,
    }));

    // Find the range we're pasting into
    const pasteEndX = targetX + Math.max(...points.map(p => p.x), 0);

    // Remove existing points in the paste range
    const filteredPoints = signal.points.filter(
      p => p.x < targetX || p.x >= pasteEndX
    );

    // Add the pasted points
    const newPoints = [...filteredPoints, ...shiftedPoints];

    // Update the signal
    const signalIndex = signals.value.findIndex(s => s.id === signalId);
    if (signalIndex !== -1) {
      signals.value[signalIndex] = { ...signal, points: newPoints };
    }
  }
}

// Dark mode (default to dark mode on launch)
const isDarkMode = ref(true);

// Sieve drag state
const isSieveDragging = ref(false);
const globalSievesDropZoneOver = ref(false);

// Clipboard for copy/paste
const clipboardSignal = ref<Signal | null>(null);

const emit = defineEmits<{
  (e: 'update:darkMode', value: boolean): void;
}>();

function toggleDarkMode() {
  isDarkMode.value = !isDarkMode.value;
  emit('update:darkMode', isDarkMode.value);
}

// Context menu state
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  items: [] as MenuItem[],
});

const contextTargetNodeId = ref<string | null>(null);
const contextTargetSignalId = ref<string | null>(null);

// Initialize tree on mount
// Keyboard event handler for copy/paste
function handleKeyDown(e: KeyboardEvent) {
  // Only handle if not in an input field
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  // Escape - clear selection
  if (e.key === 'Escape') {
    if (selection.value) {
      clearSelection();
      e.preventDefault();
      return;
    }
  }

  // Ctrl+C or Cmd+C - Copy
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    // If in select mode with active selection, copy selection
    if (editTool.value === 'select' && selection.value) {
      copySelection();
      e.preventDefault();
      return;
    }
    // Otherwise copy the whole signal
    if (selectedSignalId.value) {
      copySignal();
      e.preventDefault();
    }
  }

  // Ctrl+V or Cmd+V - Paste
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    // If in select mode with clipboard, prompt for paste position
    if (editTool.value === 'select' && selectionClipboard.value && isEditMode.value) {
      const targetXStr = prompt('Enter paste position (grid X):');
      if (targetXStr !== null) {
        const targetX = parseFloat(targetXStr);
        if (!isNaN(targetX)) {
          pasteSelection(targetX);
        }
      }
      e.preventDefault();
      return;
    }
    // Otherwise paste signal
    if (clipboardSignal.value && isEditMode.value) {
      pasteSignal();
      e.preventDefault();
    }
  }

  // Ctrl+D or Cmd+D - Duplicate
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    if (selectedSignalId.value && isEditMode.value) {
      duplicateSignal();
      e.preventDefault();
    }
  }
}

// ResizeObserver for viewport tracking
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  initializeTree();
  initSimulation();
  window.addEventListener('keydown', handleKeyDown);

  // Set up viewport tracking
  if (signalsContainerRef.value) {
    updateViewportWidth(signalsContainerRef.value.clientWidth);

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateViewportWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(signalsContainerRef.value);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

// Sync tree when signals change externally (e.g., VCD load)
watch(() => signals.value.length, () => {
  // Check if any signals aren't in the tree
  const signalIdsInTree = new Set<string>();
  function collectSignalIds(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (isSignalReference(node)) {
        signalIdsInTree.add(node.signalId);
      } else if (isSignalGroup(node)) {
        collectSignalIds(node.children);
      }
    }
  }
  collectSignalIds(tree.value);

  for (const signal of signals.value) {
    if (!signalIdsInTree.has(signal.id)) {
      addSignalReference(signal.id);
    }
  }
});

function addSignal() {
  const newSignal = createSignal();
  signals.value.push(newSignal);
  addSignalReference(newSignal.id);
  selectedSignalId.value = newSignal.id;
}

function addVectorSignal() {
  // Allow bit widths up to 1024 (could go higher, but this covers most practical cases)
  const width = Math.max(2, Math.min(1024, vectorBitWidth.value));
  const newSignal = createSignal(undefined, width);
  signals.value.push(newSignal);
  addSignalReference(newSignal.id);
  selectedSignalId.value = newSignal.id;
}

function addClockSignal() {
  const period = Math.max(1, Math.min(20, clockPeriod.value));
  const halfPeriod = period / 2;
  const newSignal = createSignal('CLK');

  // Generate square wave points for the entire grid
  const points: WavePoint[] = [];
  let currentLevel = 0;

  for (let x = 0; x < gridConfig.columns; x += halfPeriod) {
    points.push({ x, level: currentLevel });
    currentLevel = currentLevel === 0 ? 1 : 0;
  }

  newSignal.points = points;
  signals.value.push(newSignal);
  addSignalReference(newSignal.id);
  selectedSignalId.value = newSignal.id;
}

function deleteSignal(id: string) {
  const index = signals.value.findIndex(s => s.id === id);
  if (index !== -1) {
    signals.value.splice(index, 1);
    removeSignalReference(id);
    if (selectedSignalId.value === id) {
      selectedSignalId.value = signals.value[0]?.id || null;
    }
  }
}

function updateSignalPoints(id: string, points: WavePoint[]) {
  const signal = signals.value.find(s => s.id === id);
  if (signal) {
    signal.points = points;
  }
}

function renameSignal(id: string, name: string) {
  const signal = signals.value.find(s => s.id === id);
  if (signal) {
    signal.name = sanitizeName(name);
  }
}

function updateSignalDisplayFormat(id: string, format: DisplayFormat) {
  const signal = signals.value.find(s => s.id === id);
  if (signal) {
    signal.displayFormat = format;
  }
}

// Copy the selected signal to clipboard
function copySignal(signalId?: string) {
  const id = signalId || selectedSignalId.value;
  if (!id) return;

  const signal = signals.value.find(s => s.id === id);
  if (signal) {
    // Deep copy the signal
    clipboardSignal.value = {
      ...signal,
      points: signal.points.map(p => ({ ...p })),
    };
  }
}

// Paste the signal from clipboard
function pasteSignal() {
  if (!clipboardSignal.value || !isEditMode.value) return;

  const source = clipboardSignal.value;
  const newSignal: Signal = {
    id: `signal-${nextId++}`,
    name: sanitizeName(`${source.name}_copy`),
    points: source.points.map(p => ({ ...p })),
    color: getNextColor(),
    width: source.width,
    displayFormat: source.displayFormat,
  };

  signals.value.push(newSignal);
  addSignalReference(newSignal.id);
  selectedSignalId.value = newSignal.id;
}

// Duplicate the selected signal (copy + paste in one action)
function duplicateSignal(signalId?: string) {
  const id = signalId || selectedSignalId.value;
  if (!id || !isEditMode.value) return;

  const signal = signals.value.find(s => s.id === id);
  if (signal) {
    const newSignal: Signal = {
      id: `signal-${nextId++}`,
      name: sanitizeName(`${signal.name}_copy`),
      points: signal.points.map(p => ({ ...p })),
      color: getNextColor(),
      width: signal.width,
      displayFormat: signal.displayFormat,
    };

    signals.value.push(newSignal);
    addSignalReference(newSignal.id);
    selectedSignalId.value = newSignal.id;
  }
}

function clearAllSignals() {
  for (const signal of signals.value) {
    signal.points = [];
  }
}

// Watch for signal changes to re-execute all sieves
// Only watch non-derived signals to avoid feedback loops
watch(
  () => [
    hasSieve.value,
    sieves.value.filter(s => s.enabled).length,
    signals.value.filter(s => !s.isDerived).map(s => s.points),
  ],
  async () => {
    if (hasSieve.value && !isSyncingDerivedSignals.value) {
      await executeAllSievesScoped();
    }
  },
  { deep: true }
);

// Watch for tree structure changes to re-execute sieves
// (e.g., when signals are moved into/out of groups)
watch(
  () => JSON.stringify(tree.value),
  async () => {
    if (hasSieve.value && !isSyncingDerivedSignals.value) {
      await executeAllSievesScoped();
    }
  }
);

function handleCreateGroup() {
  addGroup('New Group');
}

// Context menu handlers
function showContextMenu(event: MouseEvent, nodeId: string, nodeType: 'signal' | 'group', signalId?: string) {
  contextTargetNodeId.value = nodeId;
  contextTargetSignalId.value = signalId || null;

  const items: MenuItem[] = [];

  if (nodeType === 'signal') {
    items.push({
      label: 'Create Group from Selection',
      action: () => {
        if (contextTargetSignalId.value) {
          createGroupFromSignals([contextTargetSignalId.value], 'New Group');
        }
      },
    });

    if (allGroups.value.length > 0) {
      items.push({
        label: 'Move to Group',
        submenu: allGroups.value.map(group => ({
          label: group.name,
          action: () => {
            if (contextTargetNodeId.value) {
              moveToGroup(contextTargetNodeId.value, group.id);
            }
          },
        })),
      });
    }

    items.push({
      label: 'Move to Root',
      action: () => {
        if (contextTargetNodeId.value) {
          moveToRoot(contextTargetNodeId.value);
        }
      },
    });

    items.push({ divider: true, label: '' });

    // Edge detection markers
    items.push({
      label: 'Add Markers from Edges',
      submenu: [
        {
          label: 'Rising Edges',
          action: () => {
            if (contextTargetSignalId.value) {
              const signal = signals.value.find(s => s.id === contextTargetSignalId.value);
              if (signal) {
                addMarkersFromEdges(signal, 'rising');
              }
            }
          },
        },
        {
          label: 'Falling Edges',
          action: () => {
            if (contextTargetSignalId.value) {
              const signal = signals.value.find(s => s.id === contextTargetSignalId.value);
              if (signal) {
                addMarkersFromEdges(signal, 'falling');
              }
            }
          },
        },
        {
          label: 'Any Change',
          action: () => {
            if (contextTargetSignalId.value) {
              const signal = signals.value.find(s => s.id === contextTargetSignalId.value);
              if (signal) {
                addMarkersFromEdges(signal, 'any');
              }
            }
          },
        },
      ],
    });

    items.push({ divider: true, label: '' });

    // Copy/Paste operations (edit mode only)
    if (isEditMode.value) {
      items.push({
        label: 'Copy Signal (Ctrl+C)',
        action: () => {
          if (contextTargetSignalId.value) {
            copySignal(contextTargetSignalId.value);
          }
        },
      });

      items.push({
        label: 'Paste Signal (Ctrl+V)',
        disabled: !clipboardSignal.value,
        action: () => {
          pasteSignal();
        },
      });

      items.push({
        label: 'Duplicate Signal (Ctrl+D)',
        action: () => {
          if (contextTargetSignalId.value) {
            duplicateSignal(contextTargetSignalId.value);
          }
        },
      });

      items.push({ divider: true, label: '' });
    }

    items.push({
      label: 'Delete Signal',
      action: () => {
        if (contextTargetSignalId.value) {
          deleteSignal(contextTargetSignalId.value);
        }
      },
    });
  } else {
    // Group context menu
    items.push({
      label: 'Rename Group',
      action: () => {
        const newName = prompt('Enter new group name:');
        if (newName && contextTargetNodeId.value) {
          renameGroup(contextTargetNodeId.value, newName);
        }
      },
    });

    items.push({
      label: 'Create Subgroup',
      action: () => {
        if (contextTargetNodeId.value) {
          addSubgroup(contextTargetNodeId.value, 'Subgroup');
        }
      },
    });

    const otherGroups = allGroups.value.filter(g => g.id !== nodeId);
    if (otherGroups.length > 0) {
      items.push({
        label: 'Move to Group',
        submenu: otherGroups.map(group => ({
          label: group.name,
          action: () => {
            if (contextTargetNodeId.value) {
              moveToGroup(contextTargetNodeId.value, group.id);
            }
          },
        })),
      });
    }

    items.push({
      label: 'Move to Root',
      action: () => {
        if (contextTargetNodeId.value) {
          moveToRoot(contextTargetNodeId.value);
        }
      },
    });

    items.push({ divider: true, label: '' });

    items.push({
      label: 'Ungroup (Keep Signals)',
      action: () => {
        if (contextTargetNodeId.value) {
          ungroup(contextTargetNodeId.value);
        }
      },
    });

    items.push({
      label: 'Delete Group (Keep Signals)',
      action: () => {
        if (contextTargetNodeId.value) {
          deleteGroupKeepChildren(contextTargetNodeId.value);
        }
      },
    });
  }

  contextMenu.items = items;
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.visible = true;
}

function closeContextMenu() {
  contextMenu.visible = false;
  contextTargetNodeId.value = null;
  contextTargetSignalId.value = null;
}

// Drag and drop handlers
function handleTreeDragStart(nodeId: string, nodeType: 'signal' | 'group') {
  startDrag(nodeId, nodeType);
}

function handleTreeDragEnd() {
  endDrag();
}

function handleTreeDragOver(event: DragEvent, nodeId: string) {
  const node = findNode(nodeId);
  const isGroup = node ? isSignalGroup(node) : false;
  handleDragOver(event, nodeId, isGroup);
}

function handleTreeDragLeave(nodeId: string) {
  handleDragLeave(nodeId);
}

function handleTreeDrop(_event: DragEvent, _targetNodeId: string) {
  const dropInfo = getDropInfo();
  if (dropInfo && dragState.value.draggedNodeId && dropInfo.position) {
    moveNode(dragState.value.draggedNodeId, dropInfo.targetId, dropInfo.position);
  }
  endDrag();
}

function handlePlaceMarker(x: number) {
  const color = getNextMarkerColor();
  addMarker(x, color, `M${markers.value.length + 1}`);
}

// Get all signal IDs within a group (recursively)
function getSignalIdsInGroup(groupId: string): string[] {
  const signalIds: string[] = [];
  const group = findNode(groupId);

  if (group && isSignalGroup(group)) {
    function collectSignalIds(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (isSignalReference(node)) {
          signalIds.push(node.signalId);
        } else if (isSignalGroup(node)) {
          collectSignalIds(node.children);
        }
      }
    }
    collectSignalIds(group.children);
  }

  return signalIds;
}

// Sieve drag handlers
function handleSieveDragStart(e: DragEvent, sieveId: string) {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sieveId);
    e.dataTransfer.setData('application/x-sieve', JSON.stringify({ id: sieveId }));
  }
  isSieveDragging.value = true;
  startDrag(sieveId, 'sieve');
}

function handleSieveDragEnd() {
  isSieveDragging.value = false;
  globalSievesDropZoneOver.value = false;
  endDrag();
}

function handleGlobalDropZoneDragOver(e: DragEvent) {
  if (isSieveDragging.value) {
    e.preventDefault();
    globalSievesDropZoneOver.value = true;
  }
}

function handleGlobalDropZoneDragLeave() {
  globalSievesDropZoneOver.value = false;
}

async function handleGlobalDropZoneDrop(e: DragEvent) {
  e.preventDefault();
  const sieveData = e.dataTransfer?.getData('application/x-sieve');
  if (sieveData) {
    try {
      const { id: sieveId } = JSON.parse(sieveData);
      setSieveGlobal(sieveId, true);
      await nextTick();
      await executeAllSievesScoped();
    } catch {
      // Invalid data
    }
  }
  globalSievesDropZoneOver.value = false;
  handleSieveDragEnd();
}

// Handle sieve drop on a group
async function handleSieveDropOnGroup(sieveId: string, groupId: string) {
  // When dropping on a specific group, remove from global
  // (if user wants both, they can drag to global zone separately)
  setSieveGlobal(sieveId, false);
  addSieveToGroup(sieveId, groupId);
  // Wait for reactivity to settle before executing
  await nextTick();
  await executeAllSievesScoped();
  handleSieveDragEnd();
}

// Handle removing sieve from global
async function handleRemoveSieveFromGlobal(sieveId: string) {
  setSieveGlobal(sieveId, false);
  await nextTick();
  await executeAllSievesScoped();
}

// Handle removing sieve from a group
async function handleRemoveSieveFromGroup(sieveId: string, groupId: string) {
  removeSieveFromGroup(sieveId, groupId);
  await nextTick();
  await executeAllSievesScoped();
}

// Get group name by ID for display
function getGroupName(groupId: string): string {
  const group = allGroups.value.find(g => g.id === groupId);
  return group?.name ?? 'Unknown';
}

// Get regions filtered by sieve group assignments
// Only returns regions that should be visible based on the sieve's scope
const scopedSieveRegions = computed(() => {
  const result: typeof sieveRegions.value = [];

  for (const region of sieveRegions.value) {
    const sieve = sieves.value.find(s => s.id === region.sieveId);
    if (!sieve) {
      // Region from unknown sieve, skip
      continue;
    }

    // If sieve is global, include all its regions as-is
    if (sieve.isGlobal) {
      result.push(region);
      continue;
    }

    // If sieve is assigned to groups, only include regions for signals in those groups
    if (sieve.groupIds.length > 0) {
      // Get all signal IDs that this sieve should affect
      const allowedSignalIds = new Set<string>();
      for (const groupId of sieve.groupIds) {
        const groupSignalIds = getSignalIdsInGroup(groupId);
        for (const id of groupSignalIds) {
          allowedSignalIds.add(id);
        }
      }

      // If the region already has a signalId, check if it's in the allowed set
      if (region.signalId) {
        if (allowedSignalIds.has(region.signalId)) {
          result.push(region);
        }
        // Otherwise skip - region is for a signal not in the group
      } else if (region.signalName) {
        // Region has signalName but no signalId - find matching signal IDs
        // Only include if at least one matching signal is in allowed set
        const matchingSignals = signals.value.filter(s => s.name === region.signalName);
        for (const sig of matchingSignals) {
          if (allowedSignalIds.has(sig.id)) {
            result.push({
              ...region,
              signalId: sig.id,
            });
          }
        }
      } else {
        // Region applies to all signals, but we need to limit to group signals
        // Create a copy of the region for each allowed signal ID
        for (const signalId of allowedSignalIds) {
          result.push({
            ...region,
            signalId: signalId,
          });
        }
      }
    }
    // If sieve has no assignments (not global and no groups), don't show its regions
  }

  return result;
});

// Combined regions: sieve regions + user highlights + selection region
const allRegions = computed(() => {
  const regions = [...scopedSieveRegions.value];

  // Add selection preview during drag (handled in SignalRow/VectorSignalRow for better reactivity)
  // This is intentionally empty - the preview is rendered directly in each signal row component

  // Add final selection region if there's an active selection
  if (selection.value && editTool.value === 'select') {
    for (const signalId of selection.value.signalIds) {
      regions.push({
        id: `selection_${signalId}`,
        startX: selection.value.startX,
        endX: selection.value.endX,
        color: 'rgba(33, 150, 243, 0.3)',  // Blue for selection
        signalId,
      });
    }
  }

  return regions;
});

// Execute all sieves with proper signal scoping
// A sieve can be global AND/OR assigned to groups - we collect all signals to analyze
async function executeAllSievesScoped() {
  for (const sieve of sieves.value) {
    if (!sieve.enabled) continue;

    // Collect all signals this sieve should analyze
    const signalSet = new Set<string>();

    // If global, add all signals
    if (sieve.isGlobal) {
      for (const s of signals.value) {
        signalSet.add(s.id);
      }
    }

    // Add signals from each assigned group
    for (const groupId of sieve.groupIds) {
      const groupSignalIds = getSignalIdsInGroup(groupId);
      for (const id of groupSignalIds) {
        signalSet.add(id);
      }
    }

    // Execute sieve on the collected signals
    const sieveSignals = signals.value.filter(s => signalSet.has(s.id));
    if (sieveSignals.length > 0) {
      await executeSieveById(sieve.id, sieveSignals);
    }
  }
}

function saveVCD() {
  downloadVCD(signals.value, tree.value, 'waveform.vcd');
}

function triggerLoadVCD() {
  fileInputRef.value?.click();
}

function handleFileLoad(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target?.result as string;
    if (content) {
      const { signals: loadedSignals, tree: loadedTree, maxTime } = parseVCD(content);
      if (loadedSignals.length > 0) {
        // Store as available (not displayed yet) for lazy loading
        availableSignals.value = loadedSignals;
        availableTree.value = loadedTree;

        // Clear current display - user will select signals to view
        signals.value = [];
        tree.value = [];
        selectedSignalId.value = null;

        // Expand grid columns to fit the loaded data
        gridConfig.columns = Math.max(maxTime + 5, 20);
        // Update nextId to avoid conflicts
        nextId = loadedSignals.length + 1;
        colorIndex = loadedSignals.length;

        // Expand the signal browser to show available signals
        signalBrowserExpanded.value = true;
      }
    }
  };
  reader.readAsText(file);

  // Reset file input so the same file can be loaded again
  input.value = '';
}

// Signal browser functions for lazy loading
function isSignalDisplayed(signalId: string): boolean {
  return signals.value.some(s => s.id === signalId);
}

function addSignalToDisplay(signalId: string) {
  const signal = availableSignals.value.find(s => s.id === signalId);
  if (signal && !signals.value.find(s => s.id === signalId)) {
    signals.value.push(signal);
    addSignalReference(signalId);
    if (!selectedSignalId.value) {
      selectedSignalId.value = signalId;
    }
  }
}

function removeSignalFromDisplay(signalId: string) {
  const index = signals.value.findIndex(s => s.id === signalId);
  if (index !== -1) {
    signals.value.splice(index, 1);
    removeSignalReference(signalId);
    if (selectedSignalId.value === signalId) {
      selectedSignalId.value = signals.value[0]?.id || null;
    }
  }
}

function toggleSignalDisplay(signalId: string) {
  if (isSignalDisplayed(signalId)) {
    removeSignalFromDisplay(signalId);
  } else {
    addSignalToDisplay(signalId);
  }
}

function addAllSignalsToDisplay() {
  // Show confirmation for large signal counts
  if (availableSignals.value.length > 100) {
    const confirmed = confirm(
      `You are about to add ${availableSignals.value.length} signals to the viewer. ` +
      `This may impact performance. Continue?`
    );
    if (!confirmed) return;
  }

  for (const signal of availableSignals.value) {
    if (!signals.value.find(s => s.id === signal.id)) {
      signals.value.push(signal);
      addSignalReference(signal.id);
    }
  }
  if (!selectedSignalId.value && signals.value.length > 0) {
    selectedSignalId.value = signals.value[0]?.id || null;
  }
}

function removeAllSignalsFromDisplay() {
  // Only remove signals that came from VCD (are in availableSignals)
  const availableIds = new Set(availableSignals.value.map(s => s.id));
  const toRemove = signals.value.filter(s => availableIds.has(s.id));

  for (const signal of toRemove) {
    const index = signals.value.findIndex(s => s.id === signal.id);
    if (index !== -1) {
      signals.value.splice(index, 1);
      removeSignalReference(signal.id);
    }
  }

  if (selectedSignalId.value && !signals.value.find(s => s.id === selectedSignalId.value)) {
    selectedSignalId.value = signals.value[0]?.id || null;
  }
}

function addAllSignalsInGroupToDisplay(groupId: string) {
  // Find the group in the available tree
  function findGroup(nodes: TreeNode[]): TreeNode | null {
    for (const node of nodes) {
      if (isSignalGroup(node)) {
        if (node.id === groupId) return node;
        const found = findGroup(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Get all signal IDs in a group (recursive)
  function getSignalIdsInGroup(nodes: TreeNode[]): string[] {
    const ids: string[] = [];
    for (const node of nodes) {
      if (isSignalReference(node)) {
        ids.push(node.signalId);
      } else if (isSignalGroup(node)) {
        ids.push(...getSignalIdsInGroup(node.children));
      }
    }
    return ids;
  }

  const group = findGroup(availableTree.value);
  if (group && isSignalGroup(group)) {
    const signalIds = getSignalIdsInGroup(group.children);
    for (const signalId of signalIds) {
      addSignalToDisplay(signalId);
    }
  }
}

function clearAvailableSignals() {
  availableSignals.value = [];
  availableTree.value = [];
}

// Sieve functions
function triggerLoadSieve() {
  sieveInputRef.value?.click();
}

async function handleSieveLoad(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target?.result as string;
    if (content) {
      await addSieve(file.name, content);
      // Execute all sieves after adding a new one (with scoped execution)
      await executeAllSievesScoped();
    }
  };
  reader.readAsText(file);

  // Reset file input so the same file can be loaded again
  input.value = '';
}

function handleRemoveSieve(id: string) {
  removeSieveById(id);
}

function handleToggleSieve(id: string, enabled: boolean) {
  toggleSieveById(id, enabled);
  // Re-execute sieves if toggling on (with scoped execution)
  if (enabled) {
    executeAllSievesScoped();
  }
}

// Simulation functions
function triggerUploadVerilog() {
  verilogInputRef.value?.click();
}

async function handleVerilogUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  await uploadFiles(files);

  // Reset file input
  input.value = '';
}

async function handleCompile() {
  await compile();
}

async function handleSimulate() {
  await simulate();
}

async function handleStopSimulation() {
  await stopSimulation();
}

function addSimulatedSignalsToDisplay() {
  // Add simulated signals to the main signals array
  for (const simSignal of simulatedSignals.value) {
    // Check if signal already exists (by name)
    const existingIndex = signals.value.findIndex(s => s.name === simSignal.name);
    if (existingIndex >= 0) {
      // Update existing signal's points
      signals.value[existingIndex] = {
        ...signals.value[existingIndex]!,
        points: [...simSignal.points],
      };
    } else {
      // Add new signal
      signals.value.push({ ...simSignal });
      addSignalReference(simSignal.id);
    }
  }

  // Expand grid if needed
  const maxTime = simulatedSignals.value.reduce((max, s) => {
    const sigMax = s.points.reduce((m, p) => Math.max(m, p.x), 0);
    return Math.max(max, sigMax);
  }, 0);

  if (maxTime > gridConfig.columns) {
    gridConfig.columns = maxTime + 5;
  }
}

// Helper to format transaction data values
// Supports both number and bigint for large bit widths
function formatTransactionValue(value: number | bigint, format: DisplayFormat, width: number = 8): string {
  switch (format) {
    case 'hex':
      return '0x' + value.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
    case 'binary':
      return '0b' + value.toString(2).padStart(width, '0');
    case 'decimal':
    default:
      return value.toString();
  }
}

// Watch for changes to derived signals and integrate them into the main signals array
watch(
  allDerivedSignals,
  (newDerivedSignals, oldDerivedSignals) => {
    // Set flag to prevent sieve re-execution during sync
    isSyncingDerivedSignals.value = true;

    try {
      // Get the IDs of derived signals that should exist
      const newDerivedIds = new Set(newDerivedSignals.map(d => d.id));

      // Remove derived signals that no longer exist
      const oldDerivedIds = new Set((oldDerivedSignals || []).map((d: DerivedSignal) => d.id));
      for (const oldId of oldDerivedIds) {
        if (!newDerivedIds.has(oldId)) {
          // Remove from signals array
          const signalIndex = signals.value.findIndex(s => s.id === oldId);
          if (signalIndex !== -1) {
            signals.value.splice(signalIndex, 1);
          }
          // Remove from tree
          removeSignalReference(oldId);
        }
      }

      // Add or update derived signals
      for (const derived of newDerivedSignals) {
        const existingSignal = signals.value.find(s => s.id === derived.id);
        if (existingSignal) {
          // Update existing signal's points
          existingSignal.points = derived.points;
          existingSignal.name = derived.name;
        } else {
          // Create new signal entry from derived
          const newSignal: Signal = {
            id: derived.id,
            name: derived.name,
            points: derived.points,
            color: derived.color,
            width: derived.width,
            displayFormat: derived.displayFormat,
            isDerived: true,
            sieveId: derived.sieveId,
          };
          signals.value.push(newSignal);
          addSignalReference(derived.id);
        }
      }
    } finally {
      // Reset flag after sync completes
      nextTick(() => {
        isSyncingDerivedSignals.value = false;
      });
    }
  },
  { deep: true }
);
</script>

<template>
  <div class="waveform-editor" :class="{ 'dark-mode': isDarkMode }">
    <button class="dark-mode-toggle" @click="toggleDarkMode" :title="isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'">
      {{ isDarkMode ? '☀️' : '🌙' }}
    </button>

    <input
      type="file"
      ref="fileInputRef"
      accept=".vcd"
      style="display: none"
      @change="handleFileLoad"
    />

    <input
      type="file"
      ref="sieveInputRef"
      accept=".py"
      style="display: none"
      @change="handleSieveLoad"
    />

    <input
      type="file"
      ref="verilogInputRef"
      accept=".v,.sv,.vh,.svh"
      multiple
      style="display: none"
      @change="handleVerilogUpload"
    />

    <div class="toolbar">
      <button
        @click="isEditMode = !isEditMode"
        class="btn"
        :class="isEditMode ? 'btn-edit-mode' : 'btn-view-mode'"
        :title="isEditMode ? 'Switch to view-only mode' : 'Switch to edit mode'"
      >
        {{ isEditMode ? 'Edit Mode' : 'View Mode' }}
      </button>
      <div v-if="isEditMode" class="edit-tool-toggle">
        <button
          @click="editTool = 'draw'"
          class="tool-btn"
          :class="{ active: editTool === 'draw' }"
          title="Draw waveform points"
        >Draw</button>
        <button
          @click="editTool = 'select'; selection = null"
          class="tool-btn"
          :class="{ active: editTool === 'select' }"
          title="Select and copy/paste waveform data"
        >Select</button>
      </div>
      <div class="toolbar-separator"></div>
      <div class="clock-controls">
        <input
          type="number"
          v-model.number="clockPeriod"
          min="1"
          max="20"
          step="1"
          class="period-input"
          title="Clock period (grid units)"
          :disabled="!isEditMode"
        />
        <button @click="addClockSignal" class="btn btn-clock" :disabled="!isEditMode">
          + Add Clock
        </button>
      </div>
      <button @click="handleCreateGroup" class="btn btn-group" :disabled="!isEditMode">
        + Create Group
      </button>
      <button @click="clearAllSignals" class="btn btn-secondary" :disabled="!isEditMode">
        Clear All
      </button>
      <button
        v-if="markers.length > 0"
        @click="clearAllMarkers"
        class="btn btn-marker"
      >
        Clear Markers ({{ markers.length }})
      </button>
      <div class="marker-mode-selector">
        <label>Place markers:</label>
        <select v-model="markerPlacementMode" class="mode-select">
          <option value="off">Off</option>
          <option value="snap-grid">Snap to Grid</option>
          <option value="snap-edge">Snap to Edge</option>
          <option value="free">Free</option>
        </select>
      </div>
      <div class="toolbar-separator"></div>
      <button @click="saveVCD" class="btn btn-secondary">
        Save VCD
      </button>
      <button @click="triggerLoadVCD" class="btn btn-secondary">
        Load VCD
      </button>
      <div class="grid-controls">
        <label>
          Columns:
          <input
            type="number"
            v-model.number="gridConfig.columns"
            min="5"
            max="100"
            class="grid-input"
          />
        </label>
        <label>
          Cell width:
          <input
            type="number"
            v-model.number="gridConfig.cellWidth"
            min="20"
            max="80"
            class="grid-input"
          />
        </label>
        <label>
          Height:
          <input
            type="number"
            v-model.number="waveformHeight"
            min="20"
            max="120"
            class="grid-input"
          />
        </label>
      </div>
    </div>

    <!-- Signal Browser for lazy loading VCD signals -->
    <SignalBrowser
      :available-signals="availableSignals"
      :available-tree="availableTree"
      :displayed-signals="signals"
      :expanded="signalBrowserExpanded"
      :filter="signalBrowserFilter"
      :is-dark-mode="isDarkMode"
      @update:expanded="signalBrowserExpanded = $event"
      @update:filter="signalBrowserFilter = $event"
      @toggle-signal="toggleSignalDisplay"
      @add-all="addAllSignalsToDisplay"
      @remove-all="removeAllSignalsFromDisplay"
      @add-all-in-group="addAllSignalsInGroupToDisplay"
      @clear-available="clearAvailableSignals"
    />

    <div ref="signalsContainerRef" class="signals-container" @scroll="handleViewportScroll">
      <div v-if="tree.length === 0 && availableSignals.length === 0" class="empty-state">
        No signals. Use the + button below to create one, or load a VCD file.
      </div>
      <div v-else-if="tree.length === 0 && availableSignals.length > 0" class="empty-state">
        Select signals from the browser above to display them.
      </div>
      <SignalTreeNode
        v-for="node in tree"
        :key="node.id"
        :node="node"
        :depth="0"
        :signals="signals"
        :grid-config="gridConfig"
        :selected-signal-id="selectedSignalId"
        :all-groups="allGroups"
        :drag-over-node-id="dragState.dragOverNodeId"
        :drop-position="dragState.dropPosition"
        :markers="markers"
        :marker-placement-mode="markerPlacementMode"
        :is-dark-mode="isDarkMode"
        :waveform-height="waveformHeight"
        :regions="allRegions"
        :is-edit-mode="isEditMode"
        :edit-tool="editTool"
        :get-sieves-for-group="getSievesForGroup"
        :is-sieve-dragging="isSieveDragging"
        :get-effective-points="getEffectivePoints"
        :is-signal-modified="isSignalModified"
        :show-original-data="showOriginalData"
        :is-selection-dragging="isSelectionDragging"
        :selection-drag-start-x="selectionDragStartX"
        :selection-drag-current-x="selectionDragCurrentX"
        :selection-drag-signals="selectionDragSignals"
        :viewport-bounds="viewportBounds"
        :scroll-left="scrollLeft"
        @toggle-collapse="toggleCollapse"
        @rename-group="renameGroup"
        @select-signal="(id) => selectedSignalId = id"
        @update-points="updateSignalPoints"
        @rename-signal="renameSignal"
        @delete-signal="deleteSignal"
        @update-display-format="updateSignalDisplayFormat"
        @contextmenu="showContextMenu"
        @dragstart="handleTreeDragStart"
        @dragend="handleTreeDragEnd"
        @dragover="handleTreeDragOver"
        @dragleave="handleTreeDragLeave"
        @drop="handleTreeDrop"
        @place-marker="handlePlaceMarker"
        @selection-start="(startX, signalId) => startSelectionDrag(startX, signalId)"
        @selection-move="(currentX, signalId) => updateSelectionDrag(currentX, signalId)"
        @selection-end="(endX) => endSelectionDrag(endX)"
        @sieve-toggle="handleToggleSieve"
        @sieve-remove-from-group="handleRemoveSieveFromGroup"
        @sieve-drop="handleSieveDropOnGroup"
      />

      <!-- Add Signal Shadow Row -->
      <div v-if="isEditMode" class="add-signal-row" :class="{ 'dark-mode': isDarkMode }">
        <div class="add-signal-label">
          <button
            @click="addSignal"
            class="add-signal-btn"
            title="Add single-bit signal"
          >+</button>
          <button
            @click="addVectorSignal"
            class="add-vector-btn"
            title="Add vector signal"
          >V</button>
          <input
            type="number"
            v-model.number="vectorBitWidth"
            min="2"
            max="1024"
            class="vector-width-input"
            title="Vector bit width"
          />
        </div>
        <div class="add-signal-canvas-placeholder"></div>
      </div>
    </div>

    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @close="closeContextMenu"
    />

    <!-- Simulation Panel -->
    <div class="simulation-panel" :class="{ 'dark-mode': isDarkMode }">
      <div class="sim-header" @click="simulationPanelExpanded = !simulationPanelExpanded">
        <h3>
          <span class="expand-icon">{{ simulationPanelExpanded ? '&#9660;' : '&#9654;' }}</span>
          Simulation
        </h3>
        <div class="sim-status">
          <span v-if="!simConnected" class="status-badge disconnected">Disconnected</span>
          <span v-else-if="isCompiling" class="status-badge compiling">Compiling...</span>
          <span v-else-if="isSimulating" class="status-badge simulating">Running...</span>
          <span v-else class="status-badge connected">Ready</span>
        </div>
      </div>

      <div v-if="simulationPanelExpanded" class="sim-content">
        <!-- Simulator Selection -->
        <div class="sim-row">
          <label>Simulator:</label>
          <select v-model="selectedSimulator" :disabled="isCompiling || isSimulating" class="sim-select">
            <option v-for="sim in availableSimulators" :key="sim.id" :value="sim.id">
              {{ sim.name }} {{ sim.version ? `(${sim.version})` : '' }}
            </option>
          </select>
        </div>

        <!-- Top Module Selection -->
        <div class="sim-row">
          <label>Top Module:</label>
          <input
            v-model="topModule"
            type="text"
            class="sim-input"
            placeholder="Auto-detect from file"
            :disabled="isCompiling || isSimulating"
          />
          <select
            v-if="currentProject && currentProject.files.length > 0"
            @change="(e) => { const v = (e.target as HTMLSelectElement).value; if (v) topModule = v.replace('.v', '').replace('.sv', ''); }"
            class="sim-select-small"
            :disabled="isCompiling || isSimulating"
          >
            <option value="">From file...</option>
            <option v-for="file in currentProject.files" :key="file" :value="file">
              {{ file }}
            </option>
          </select>
        </div>

        <!-- Project Files -->
        <div class="sim-row">
          <label>Files:</label>
          <div class="files-info">
            <span v-if="currentProject && currentProject.files.length > 0">
              {{ currentProject.files.length }} file(s): {{ currentProject.files.join(', ') }}
            </span>
            <span v-else class="no-files">No files uploaded</span>
          </div>
          <button @click="triggerUploadVerilog" class="btn btn-small" :disabled="isCompiling || isSimulating">
            Upload Verilog
          </button>
        </div>

        <!-- Action Buttons -->
        <div class="sim-actions">
          <button
            @click="handleCompile"
            class="btn btn-compile"
            :disabled="!canCompile"
          >
            Compile
          </button>
          <button
            v-if="!isSimulating"
            @click="handleSimulate"
            class="btn btn-simulate"
            :disabled="!canSimulate"
          >
            Simulate
          </button>
          <button
            v-else
            @click="handleStopSimulation"
            class="btn btn-stop"
          >
            Stop
          </button>
          <button
            v-if="simulatedSignals.length > 0"
            @click="addSimulatedSignalsToDisplay"
            class="btn btn-add-signals"
          >
            Add to Waveform ({{ simulatedSignals.length }})
          </button>
        </div>

        <!-- Error Display -->
        <div v-if="simError" class="sim-error">
          <span>{{ simError }}</span>
          <button @click="clearSimError" class="btn-dismiss">&times;</button>
        </div>

        <!-- Output Console -->
        <div v-if="compileOutput.length > 0 || simulationOutput.length > 0" class="sim-console">
          <div class="console-header">
            <span>Output</span>
            <button @click="clearSimOutput" class="btn-clear">Clear</button>
          </div>
          <div class="console-output">
            <div v-for="(line, i) in compileOutput" :key="'c' + i" class="console-line">{{ line }}</div>
            <div v-for="(line, i) in simulationOutput" :key="'s' + i" class="console-line sim-line">{{ line }}</div>
          </div>
        </div>

        <!-- Simulated Signals Preview -->
        <div v-if="simulatedSignals.length > 0" class="sim-signals-preview">
          <div class="preview-header">Simulated Signals ({{ simulatedSignals.length }})</div>
          <div class="preview-list">
            <div v-for="sig in simulatedSignals" :key="sig.id" class="preview-signal">
              <span class="sig-color" :style="{ background: sig.color }"></span>
              <span class="sig-name">{{ sig.name }}</span>
              <span class="sig-width">[{{ sig.width - 1 }}:0]</span>
              <span class="sig-points">{{ sig.points.length }} pts</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sieve Panel -->
    <div class="sieve-panel">
      <div class="sieve-header">
        <h3>Sieves</h3>
        <div class="sieve-controls">
          <button
            @click="triggerLoadSieve"
            class="btn btn-sieve"
            :disabled="pyodideLoading"
          >
            {{ pyodideLoading ? 'Loading Python...' : '+ Load Sieve' }}
          </button>
          <span v-if="sieveRunning" class="sieve-status running">Running...</span>
        </div>
      </div>

      <!-- Global Sieves Drop Zone -->
      <div
        class="global-sieves-zone"
        :class="{ 'drag-over': globalSievesDropZoneOver }"
        @dragover="handleGlobalDropZoneDragOver"
        @dragleave="handleGlobalDropZoneDragLeave"
        @drop="handleGlobalDropZoneDrop"
      >
        <div class="global-sieves-label">Global Sieves (analyze all signals)</div>
        <div v-if="globalSieves.length > 0" class="sieves-list global-sieves-list">
          <div
            v-for="sieve in globalSieves"
            :key="sieve.id"
            class="sieve-item sieve-assignment"
            :class="{ disabled: !sieve.enabled, 'has-error': sieve.error }"
          >
            <span class="sieve-icon">&#128269;</span>
            <span class="sieve-name">{{ sieve.name }}</span>
            <span v-if="sieve.enabled && !sieve.error" class="sieve-txn-count">
              ({{ sieve.transactions.length }} txn)
            </span>
            <button
              @click="handleRemoveSieveFromGlobal(sieve.id)"
              class="btn-remove-assignment"
              title="Remove from global"
            >×</button>
          </div>
        </div>
        <div v-else class="global-sieves-empty">
          Drop sieves here for global scope
        </div>
      </div>

      <div class="sieve-drag-hint">
        Drag sieves to groups above, or drop here for global scope.
      </div>

      <!-- Show Original Toggle -->
      <div v-if="hasSieve" class="show-original-toggle">
        <label class="toggle-label">
          <input type="checkbox" v-model="showOriginalData" />
          <span>Show Original Data</span>
        </label>
        <span v-if="allDerivedSignals.length > 0" class="derived-count-badge">
          {{ allDerivedSignals.length }} derived
        </span>
      </div>

      <!-- Master Sieve List -->
      <div v-if="sieves.length > 0" class="sieve-master-list">
        <div class="sieve-master-label">Available Sieves</div>
        <div class="sieves-list">
          <div
            v-for="sieve in sieves"
            :key="sieve.id"
            class="sieve-item"
            :class="{ disabled: !sieve.enabled, 'has-error': sieve.error, dragging: isSieveDragging && dragState.draggedNodeId === sieve.id }"
            draggable="true"
            @dragstart="handleSieveDragStart($event, sieve.id)"
            @dragend="handleSieveDragEnd"
          >
            <div class="sieve-item-header">
              <span class="sieve-drag-handle" title="Drag to group or global zone">&#9776;</span>
              <label class="sieve-checkbox">
                <input
                  type="checkbox"
                  :checked="sieve.enabled"
                  @change="handleToggleSieve(sieve.id, ($event.target as HTMLInputElement).checked)"
                  @click.stop
                />
                <span class="sieve-name">{{ sieve.name }}</span>
              </label>
              <button
                @click="handleRemoveSieve(sieve.id)"
                class="btn-remove"
                title="Delete sieve"
              >×</button>
            </div>
            <div class="sieve-item-details">
              <span v-if="sieve.error" class="sieve-item-error">Error: {{ sieve.error }}</span>
              <span v-else-if="!sieve.enabled" class="sieve-item-status">(disabled)</span>
              <span v-else class="sieve-item-assignments">
                <span v-if="sieve.isGlobal" class="assignment-badge global">Global</span>
                <span v-for="groupId in sieve.groupIds" :key="groupId" class="assignment-badge group">
                  {{ getGroupName(groupId) }}
                </span>
                <span v-if="!sieve.isGlobal && sieve.groupIds.length === 0" class="no-assignments">
                  Not assigned
                </span>
              </span>
            </div>
            <div v-if="sieve.enabled && !sieve.error" class="sieve-item-stats">
              <span v-if="sieve.signalModifications.length > 0" class="stat-badge mod">
                {{ sieve.signalModifications.length }} mod
              </span>
              <span v-if="sieve.derivedSignals.length > 0" class="stat-badge derived">
                {{ sieve.derivedSignals.length }} derived
              </span>
              <span v-if="sieve.transactions.length > 0" class="stat-badge txn">
                {{ sieve.transactions.length }} txn
              </span>
              <span v-if="sieve.regions.length > 0" class="stat-badge region">
                {{ sieve.regions.length }} regions
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="sieve-info">
        Load a Python sieve (.py file) to analyze signals and detect transactions.
      </div>

      <!-- Transactions Table -->
      <div v-if="hasSieve && sieveTransactions.length > 0" class="transactions-section">
        <div class="transactions-header">
          <h4>Transactions (from enabled sieves)</h4>
        </div>
        <div class="transactions-table-container">
          <table class="transactions-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Data</th>
                <th>Sieve</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(txn, index) in sieveTransactions" :key="txn.id">
                <td>{{ index + 1 }}</td>
                <td>{{ txn.time }}</td>
                <td class="data-value">{{ formatTransactionValue(txn.dataValue, txn.displayFormat) }}</td>
                <td class="sieve-source">{{ (txn as any).sieveName || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="hasSieve && sieveTransactions.length === 0 && !sieveRunning" class="no-transactions">
        No transactions captured. Sieves are active and monitoring signals.
      </div>
    </div>

    <div class="instructions">
      <h3>How to use:</h3>
      <ul>
        <li><strong>Single-bit signals:</strong> Click/drag to set high or low levels</li>
        <li><strong>Vector signals:</strong> Click to enter a value at that time position</li>
        <li><strong>Clock signals:</strong> Click "+ Add Clock" to generate a square wave with the specified period</li>
        <li><strong>Groups:</strong> Click "Create Group" to add a group, then drag signals into it</li>
        <li><strong>Right-click</strong> on signals or groups for more options</li>
        <li><strong>Drag</strong> the &#x2630; handle to reorder signals and groups</li>
        <li><strong>Double-click</strong> the signal/group name to rename it</li>
        <li><strong>Display format:</strong> Use the dropdown to switch between hex, decimal, and binary</li>
        <li><strong>Auto Markers:</strong> Right-click a signal and select "Add Markers from Edges" to add vertical markers at signal transitions</li>
        <li><strong>Manual Markers:</strong> Use the "Place markers" dropdown to enable marker placement, then click on any signal to place a marker (snap to grid, snap to edges, or free placement)</li>
        <li><strong>Save VCD</strong> to export waveforms (groups become $scope blocks)</li>
        <li><strong>Load VCD</strong> to import waveforms from a VCD file</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.waveform-editor {
  padding: 20px;
  width: 100%;
  min-height: calc(100vh - 80px);
  position: relative;
  transition: background-color 0.3s, color 0.3s;
  box-sizing: border-box;
}

.dark-mode-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: #e0e0e0;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s;
  z-index: 100;
}

.dark-mode-toggle:hover {
  background: #bdbdbd;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  flex-wrap: wrap;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.btn-primary {
  background: #2196F3;
  color: white;
}

.btn-primary:hover {
  background: #1976D2;
}

.btn-secondary {
  background: #e0e0e0;
  color: #333;
}

.btn-secondary:hover {
  background: #bdbdbd;
}

.btn-group {
  background: #5C6BC0;
  color: white;
}

.btn-group:hover {
  background: #3F51B5;
}

.btn-marker {
  background: #E91E63;
  color: white;
}

.btn-marker:hover {
  background: #C2185B;
}

.btn-edit-mode {
  background: #4CAF50;
  color: white;
}

.btn-edit-mode:hover {
  background: #388E3C;
}

.btn-view-mode {
  background: #607D8B;
  color: white;
}

.btn-view-mode:hover {
  background: #455A64;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.marker-mode-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #666;
}

.mode-select {
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
  background: white;
  cursor: pointer;
}

.mode-select:focus {
  outline: none;
  border-color: #2196F3;
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: #ccc;
  margin: 0 4px;
}

.edit-tool-toggle {
  display: flex;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: hidden;
}

.tool-btn {
  padding: 6px 12px;
  border: none;
  background: #f5f5f5;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  transition: all 0.2s;
}

.tool-btn:not(:last-child) {
  border-right: 1px solid #ccc;
}

.tool-btn:hover {
  background: #e8e8e8;
}

.tool-btn.active {
  background: #2196F3;
  color: white;
}

.tool-btn.active:hover {
  background: #1976D2;
}

.clock-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.period-input {
  width: 50px;
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.btn-clock {
  background: #FF9800;
  color: white;
}

.btn-clock:hover {
  background: #F57C00;
}

.grid-controls {
  display: flex;
  gap: 16px;
  margin-left: auto;
}

.grid-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #666;
}

.grid-input {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.signals-container {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  background: white;
  min-height: 200px;
  overflow-x: auto;
}

.empty-state {
  text-align: center;
  color: #999;
  padding: 40px;
}

/* Add Signal Shadow Row */
.add-signal-row {
  display: flex;
  align-items: stretch;
  border: 1px dashed #ccc;
  border-radius: 4px;
  background: #f9f9f9;
  margin-top: 8px;
  opacity: 0.7;
  transition: opacity 0.2s, border-color 0.2s;
}

.add-signal-row:hover {
  opacity: 1;
  border-color: #999;
}

.add-signal-label {
  width: 120px;
  min-width: 120px;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f0f0f0;
  border-right: 1px dashed #ccc;
  font-size: 12px;
}

.add-signal-btn,
.add-vector-btn {
  width: 22px;
  height: 22px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.add-signal-btn:hover {
  background: #2196F3;
  border-color: #2196F3;
  color: white;
}

.add-vector-btn:hover {
  background: #9C27B0;
  border-color: #9C27B0;
  color: white;
}

.vector-width-input {
  width: 38px;
  padding: 2px 4px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 11px;
  text-align: center;
}

.add-signal-canvas-placeholder {
  flex: 1;
  min-height: 30px;
}

/* Dark mode add signal row */
.add-signal-row.dark-mode {
  background: #2a2a3e;
  border-color: #444;
}

.add-signal-row.dark-mode:hover {
  border-color: #666;
}

.add-signal-row.dark-mode .add-signal-label {
  background: #252538;
  border-color: #444;
}

.add-signal-row.dark-mode .add-signal-btn,
.add-signal-row.dark-mode .add-vector-btn {
  background: #1e1e2e;
  border-color: #444;
  color: #999;
}

.add-signal-row.dark-mode .add-signal-btn:hover {
  background: #2196F3;
  border-color: #2196F3;
  color: white;
}

.add-signal-row.dark-mode .add-vector-btn:hover {
  background: #9C27B0;
  border-color: #9C27B0;
  color: white;
}

.add-signal-row.dark-mode .vector-width-input {
  background: #1e1e2e;
  border-color: #444;
  color: #e0e0e0;
}

.instructions {
  margin-top: 20px;
  padding: 16px;
  background: #f9f9f9;
  border-radius: 8px;
  font-size: 14px;
}

.instructions h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: #333;
}

.instructions ul {
  margin: 0;
  padding-left: 20px;
}

.instructions li {
  margin-bottom: 6px;
  color: #666;
}

/* Sieve/Transaction Panel Styles */
.transactions-section {
  margin-top: 12px;
}

.transactions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.transactions-header h4 {
  margin: 0;
  font-size: 14px;
  color: #333;
}

.btn-small {
  padding: 4px 10px;
  font-size: 12px;
  background: #e0e0e0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-small:hover {
  background: #bdbdbd;
}

.transactions-table-container {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
}

.transactions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.transactions-table th,
.transactions-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.transactions-table th {
  background: #f5f5f5;
  font-weight: 600;
  color: #333;
  position: sticky;
  top: 0;
}

.transactions-table tr:last-child td {
  border-bottom: none;
}

.transactions-table tr:hover td {
  background: #f9f9f9;
}

.data-value {
  font-family: monospace;
  color: #1565C0;
}

.no-transactions {
  color: #888;
  font-size: 13px;
  font-style: italic;
  padding: 12px 0;
}

/* Dark Mode Styles */
.dark-mode {
  background: #1a1a2e;
  color: #e0e0e0;
}

.dark-mode .dark-mode-toggle {
  background: #3a3a5e;
  color: #fff;
}

.dark-mode .dark-mode-toggle:hover {
  background: #4a4a6e;
}

.dark-mode .toolbar {
  background: #2a2a3e;
}

.dark-mode .btn-secondary {
  background: #3a3a5e;
  color: #e0e0e0;
}

.dark-mode .btn-secondary:hover {
  background: #4a4a6e;
}

.dark-mode .edit-tool-toggle {
  border-color: #444;
}

.dark-mode .tool-btn {
  background: #2a2a3e;
  color: #999;
  border-color: #444;
}

.dark-mode .tool-btn:hover {
  background: #3a3a4e;
}

.dark-mode .tool-btn.active {
  background: #2196F3;
  color: white;
}

.dark-mode .period-input,
.dark-mode .grid-input,
.dark-mode .mode-select,
.dark-mode .signal-select {
  background: #2a2a3e;
  border-color: #444;
  color: #e0e0e0;
}

.dark-mode .grid-controls label,
.dark-mode .marker-mode-selector,
.dark-mode .config-row label {
  color: #aaa;
}

.dark-mode .signals-container {
  background: #1e1e2e;
  border-color: #444;
}

.dark-mode .empty-state {
  color: #666;
}

.dark-mode .transactions-header h4 {
  color: #e0e0e0;
}

.dark-mode .btn-small {
  background: #3a3a5e;
  color: #e0e0e0;
}

.dark-mode .btn-small:hover {
  background: #4a4a6e;
}

.dark-mode .transactions-table-container {
  background: #1e1e2e;
  border-color: #444;
}

.dark-mode .transactions-table th {
  background: #2a2a3e;
  color: #e0e0e0;
}

.dark-mode .transactions-table td {
  border-color: #333;
  color: #ccc;
}

.dark-mode .transactions-table tr:hover td {
  background: #2a2a3e;
}

.dark-mode .data-value {
  color: #64B5F6;
}

.dark-mode .no-transactions {
  color: #666;
}

.dark-mode .instructions {
  background: #2a2a3e;
}

.dark-mode .instructions h3 {
  color: #e0e0e0;
}

.dark-mode .instructions li {
  color: #aaa;
}

/* Sieve Panel Styles */
.sieve-panel {
  margin-top: 20px;
  padding: 16px;
  background: #e8f5e9;
  border: 1px solid #c8e6c9;
  border-radius: 8px;
}

.sieve-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.sieve-header h3 {
  margin: 0;
  font-size: 16px;
  color: #2e7d32;
}

.sieve-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-sieve {
  background: #4CAF50;
  color: white;
}

.btn-sieve:hover:not(:disabled) {
  background: #388E3C;
}

.btn-sieve:disabled {
  background: #a5d6a7;
  cursor: wait;
}

.sieve-name {
  font-weight: 500;
  color: #2e7d32;
  font-family: monospace;
}

.sieve-status.running {
  color: #1565C0;
  font-size: 13px;
  font-style: italic;
}

.sieve-error {
  background: #ffebee;
  border: 1px solid #ef9a9a;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
  color: #c62828;
  font-family: monospace;
  font-size: 13px;
  white-space: pre-wrap;
}

.sieve-info {
  color: #666;
  font-size: 13px;
  font-style: italic;
}

/* Multi-sieve list styles */
.sieves-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.sieve-item {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid #c8e6c9;
  border-radius: 4px;
  padding: 8px 12px;
}

.sieve-item.disabled {
  opacity: 0.6;
}

.sieve-item.has-error {
  border-color: #ef9a9a;
  background: rgba(255, 235, 238, 0.5);
}

.sieve-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sieve-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.sieve-checkbox input {
  cursor: pointer;
}

.sieve-checkbox .sieve-name {
  font-family: monospace;
  font-weight: 500;
  color: #2e7d32;
}

.sieve-item.disabled .sieve-checkbox .sieve-name {
  color: #888;
}

.btn-remove {
  background: none;
  border: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: #888;
  padding: 2px 6px;
  border-radius: 4px;
}

.btn-remove:hover {
  background: rgba(244, 67, 54, 0.1);
  color: #c62828;
}

.sieve-item-details {
  margin-top: 4px;
  padding-left: 24px;
  font-size: 12px;
}

.sieve-item-count {
  color: #666;
}

.sieve-item-status {
  color: #888;
  font-style: italic;
}

.sieve-item-error {
  color: #c62828;
  font-family: monospace;
  font-size: 11px;
}

.sieve-source {
  font-family: monospace;
  font-size: 12px;
  color: #666;
}

/* Global sieves drop zone */
.global-sieves-zone {
  background: rgba(76, 175, 80, 0.1);
  border: 2px dashed rgba(76, 175, 80, 0.3);
  border-radius: 8px;
  padding: 12px;
  min-height: 60px;
  transition: all 0.2s;
}

.global-sieves-zone.drag-over {
  background: rgba(76, 175, 80, 0.2);
  border-color: #4CAF50;
  box-shadow: 0 0 10px rgba(76, 175, 80, 0.3);
}

.global-sieves-label {
  font-size: 12px;
  font-weight: 600;
  color: #2e7d32;
  margin-bottom: 8px;
}

.global-sieves-empty {
  font-size: 12px;
  color: #888;
  font-style: italic;
  text-align: center;
  padding: 8px;
}

.sieve-drag-hint {
  font-size: 11px;
  color: #888;
  text-align: center;
  margin: 8px 0;
  padding: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}

.sieve-drag-handle {
  cursor: grab;
  opacity: 0.5;
  font-size: 12px;
  user-select: none;
}

.sieve-drag-handle:hover {
  opacity: 1;
}

.sieve-item.dragging {
  opacity: 0.5;
}

/* Sieve master list */
.sieve-master-list {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}

.sieve-master-label {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  margin-bottom: 8px;
}

/* Assignment badges in master list */
.sieve-item-assignments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.assignment-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
}

.assignment-badge.global {
  background: rgba(33, 150, 243, 0.2);
  color: #1565C0;
  border: 1px solid rgba(33, 150, 243, 0.3);
}

.assignment-badge.group {
  background: rgba(156, 39, 176, 0.2);
  color: #7B1FA2;
  border: 1px solid rgba(156, 39, 176, 0.3);
}

.no-assignments {
  font-size: 11px;
  color: #999;
  font-style: italic;
}

/* Global sieves list items (assignments) */
.sieve-assignment {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
}

.sieve-assignment .sieve-icon {
  font-size: 12px;
}

.sieve-assignment .sieve-name {
  flex: 1;
  font-size: 12px;
}

.sieve-assignment .sieve-txn-count {
  font-size: 10px;
  color: #888;
}

.btn-remove-assignment {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 0 4px;
  font-size: 14px;
  line-height: 1;
}

.btn-remove-assignment:hover {
  color: #c62828;
}

.global-sieves-list {
  margin-top: 4px;
}

/* Dark mode sieve styles */
.dark-mode .sieve-panel {
  background: #1b3a1e;
  border-color: #2e5a32;
}

.dark-mode .sieve-header h3 {
  color: #81c784;
}

.dark-mode .sieve-name {
  color: #a5d6a7;
}

.dark-mode .sieve-error {
  background: #3e2723;
  border-color: #5d4037;
  color: #ef9a9a;
}

.dark-mode .sieve-info {
  color: #888;
}

/* Dark mode multi-sieve styles */
.dark-mode .sieve-item {
  background: rgba(30, 30, 46, 0.5);
  border-color: #2e5a32;
}

.dark-mode .sieve-item.has-error {
  border-color: #5d4037;
  background: rgba(62, 39, 35, 0.5);
}

.dark-mode .sieve-checkbox .sieve-name {
  color: #a5d6a7;
}

.dark-mode .sieve-item.disabled .sieve-checkbox .sieve-name {
  color: #666;
}

.dark-mode .btn-remove {
  color: #666;
}

.dark-mode .btn-remove:hover {
  background: rgba(244, 67, 54, 0.2);
  color: #ef9a9a;
}

.dark-mode .sieve-item-count {
  color: #888;
}

.dark-mode .sieve-item-status {
  color: #666;
}

.dark-mode .sieve-item-error {
  color: #ef9a9a;
}

.dark-mode .sieve-source {
  color: #888;
}

/* Dark mode global sieves zone */
.dark-mode .global-sieves-zone {
  background: rgba(76, 175, 80, 0.1);
  border-color: rgba(76, 175, 80, 0.3);
}

.dark-mode .global-sieves-zone.drag-over {
  background: rgba(76, 175, 80, 0.2);
  border-color: #4CAF50;
}

.dark-mode .global-sieves-label {
  color: #81c784;
}

.dark-mode .global-sieves-empty {
  color: #666;
}

.dark-mode .sieve-drag-hint {
  color: #666;
  border-top-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .sieve-drag-handle {
  color: #888;
}

/* Dark mode master list */
.dark-mode .sieve-master-list {
  border-top-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .sieve-master-label {
  color: #888;
}

.dark-mode .assignment-badge.global {
  background: rgba(33, 150, 243, 0.2);
  color: #64B5F6;
  border-color: rgba(33, 150, 243, 0.3);
}

.dark-mode .assignment-badge.group {
  background: rgba(156, 39, 176, 0.2);
  color: #CE93D8;
  border-color: rgba(156, 39, 176, 0.3);
}

.dark-mode .no-assignments {
  color: #666;
}

.dark-mode .sieve-assignment .sieve-txn-count {
  color: #666;
}

.dark-mode .btn-remove-assignment {
  color: #666;
}

.dark-mode .btn-remove-assignment:hover {
  color: #ef9a9a;
}

/* Show Original Toggle */
.show-original-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin: 8px 0;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
}

.toggle-label input {
  cursor: pointer;
}

.derived-count-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(156, 39, 176, 0.2);
  color: #7B1FA2;
  border-radius: 10px;
}

/* Sieve Item Stats */
.sieve-item-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  padding-left: 24px;
}

.stat-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
}

.stat-badge.mod {
  background: rgba(255, 152, 0, 0.2);
  color: #e65100;
  border: 1px solid rgba(255, 152, 0, 0.3);
}

.stat-badge.derived {
  background: rgba(156, 39, 176, 0.2);
  color: #7B1FA2;
  border: 1px solid rgba(156, 39, 176, 0.3);
}

.stat-badge.txn {
  background: rgba(33, 150, 243, 0.2);
  color: #1565C0;
  border: 1px solid rgba(33, 150, 243, 0.3);
}

.stat-badge.region {
  background: rgba(76, 175, 80, 0.2);
  color: #2e7d32;
  border: 1px solid rgba(76, 175, 80, 0.3);
}

/* Dark mode styles for new elements */
.dark-mode .show-original-toggle {
  background: rgba(255, 255, 255, 0.1);
}

.dark-mode .toggle-label {
  color: #e0e0e0;
}

.dark-mode .derived-count-badge {
  background: rgba(156, 39, 176, 0.3);
  color: #CE93D8;
}

.dark-mode .stat-badge.mod {
  background: rgba(255, 152, 0, 0.2);
  color: #ffb74d;
}

.dark-mode .stat-badge.derived {
  background: rgba(156, 39, 176, 0.2);
  color: #CE93D8;
}

.dark-mode .stat-badge.txn {
  background: rgba(33, 150, 243, 0.2);
  color: #64B5F6;
}

.dark-mode .stat-badge.region {
  background: rgba(76, 175, 80, 0.2);
  color: #81c784;
}

/* Simulation Panel Styles */
.simulation-panel {
  margin-top: 20px;
  padding: 16px;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 8px;
}

.sim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.sim-header h3 {
  margin: 0;
  font-size: 16px;
  color: #1565c0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.expand-icon {
  font-size: 10px;
  width: 12px;
}

.sim-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.connected {
  background: #c8e6c9;
  color: #2e7d32;
}

.status-badge.disconnected {
  background: #ffcdd2;
  color: #c62828;
}

.status-badge.compiling {
  background: #fff3e0;
  color: #e65100;
}

.status-badge.simulating {
  background: #e3f2fd;
  color: #1565c0;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.sim-content {
  margin-top: 16px;
}

.sim-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.sim-row label {
  min-width: 70px;
  font-size: 14px;
  color: #1565c0;
  font-weight: 500;
}

.sim-select {
  flex: 1;
  max-width: 250px;
  padding: 6px 10px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  background: white;
  font-size: 14px;
}

.sim-select-small {
  padding: 6px 8px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  background: white;
  font-size: 13px;
  max-width: 150px;
}

.sim-input {
  flex: 1;
  max-width: 200px;
  padding: 6px 10px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  background: white;
  font-size: 14px;
  font-family: monospace;
}

.sim-input::placeholder {
  color: #90a4ae;
  font-style: italic;
  font-family: inherit;
}

.files-info {
  flex: 1;
  font-size: 13px;
  color: #333;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-files {
  color: #888;
  font-style: italic;
}

.sim-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #90caf9;
}

.btn-compile {
  background: #1565c0;
  color: white;
}

.btn-compile:hover:not(:disabled) {
  background: #0d47a1;
}

.btn-simulate {
  background: #2e7d32;
  color: white;
}

.btn-simulate:hover:not(:disabled) {
  background: #1b5e20;
}

.btn-stop {
  background: #c62828;
  color: white;
}

.btn-stop:hover {
  background: #b71c1c;
}

.btn-add-signals {
  background: #7b1fa2;
  color: white;
}

.btn-add-signals:hover {
  background: #6a1b9a;
}

.btn-small {
  padding: 4px 10px;
  font-size: 12px;
}

.sim-error {
  margin-top: 12px;
  padding: 10px 12px;
  background: #ffebee;
  border: 1px solid #ef9a9a;
  border-radius: 4px;
  color: #c62828;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-dismiss {
  background: none;
  border: none;
  color: #c62828;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.sim-console {
  margin-top: 12px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  overflow: hidden;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #bbdefb;
  font-size: 12px;
  font-weight: 500;
  color: #1565c0;
}

.btn-clear {
  background: none;
  border: none;
  color: #1565c0;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}

.console-output {
  max-height: 150px;
  overflow-y: auto;
  padding: 8px 10px;
  background: #fafafa;
  font-family: monospace;
  font-size: 12px;
}

.console-line {
  white-space: pre-wrap;
  word-break: break-all;
  color: #333;
}

.console-line.sim-line {
  color: #2e7d32;
}

.sim-signals-preview {
  margin-top: 12px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  overflow: hidden;
}

.preview-header {
  padding: 6px 10px;
  background: #bbdefb;
  font-size: 12px;
  font-weight: 500;
  color: #1565c0;
}

.preview-list {
  max-height: 120px;
  overflow-y: auto;
  padding: 8px;
}

.preview-signal {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.sig-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.sig-name {
  font-weight: 500;
  color: #333;
}

.sig-width {
  color: #666;
  font-family: monospace;
}

.sig-points {
  margin-left: auto;
  color: #888;
  font-size: 11px;
}

/* Dark mode simulation panel */
.simulation-panel.dark-mode {
  background: #1a237e;
  border-color: #3949ab;
}

.simulation-panel.dark-mode .sim-header h3 {
  color: #90caf9;
}

.simulation-panel.dark-mode .sim-row label {
  color: #90caf9;
}

.simulation-panel.dark-mode .sim-select {
  background: #283593;
  border-color: #3949ab;
  color: #e0e0e0;
}

.simulation-panel.dark-mode .sim-select-small {
  background: #283593;
  border-color: #3949ab;
  color: #e0e0e0;
}

.simulation-panel.dark-mode .sim-input {
  background: #283593;
  border-color: #3949ab;
  color: #e0e0e0;
}

.simulation-panel.dark-mode .sim-input::placeholder {
  color: #7986cb;
}

.simulation-panel.dark-mode .files-info {
  color: #e0e0e0;
}

.simulation-panel.dark-mode .no-files {
  color: #666;
}

.simulation-panel.dark-mode .sim-actions {
  border-top-color: #3949ab;
}

.simulation-panel.dark-mode .sim-error {
  background: #3e2723;
  border-color: #5d4037;
  color: #ef9a9a;
}

.simulation-panel.dark-mode .btn-dismiss {
  color: #ef9a9a;
}

.simulation-panel.dark-mode .sim-console {
  border-color: #3949ab;
}

.simulation-panel.dark-mode .console-header {
  background: #283593;
  color: #90caf9;
}

.simulation-panel.dark-mode .btn-clear {
  color: #90caf9;
}

.simulation-panel.dark-mode .console-output {
  background: #1a1a2e;
}

.simulation-panel.dark-mode .console-line {
  color: #e0e0e0;
}

.simulation-panel.dark-mode .console-line.sim-line {
  color: #81c784;
}

.simulation-panel.dark-mode .sim-signals-preview {
  border-color: #3949ab;
}

.simulation-panel.dark-mode .preview-header {
  background: #283593;
  color: #90caf9;
}

.simulation-panel.dark-mode .preview-list {
  background: #1a1a2e;
}

.simulation-panel.dark-mode .sig-name {
  color: #e0e0e0;
}

.simulation-panel.dark-mode .sig-width {
  color: #888;
}

.simulation-panel.dark-mode .sig-points {
  color: #666;
}

.simulation-panel.dark-mode .status-badge.connected {
  background: rgba(76, 175, 80, 0.2);
  color: #81c784;
}

.simulation-panel.dark-mode .status-badge.disconnected {
  background: rgba(244, 67, 54, 0.2);
  color: #ef9a9a;
}

.simulation-panel.dark-mode .status-badge.compiling {
  background: rgba(255, 152, 0, 0.2);
  color: #ffb74d;
}

.simulation-panel.dark-mode .status-badge.simulating {
  background: rgba(33, 150, 243, 0.2);
  color: #64b5f6;
}
</style>
