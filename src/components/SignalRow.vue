<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import type { Signal, GridConfig, WavePoint, Marker, MarkerPlacementMode, SieveRegion } from '../types/waveform';
import { useGridSnap } from '../composables/useGridSnap';
import { useWaveformDraw } from '../composables/useWaveformDraw';
import { useMarkers } from '../composables/useMarkers';

const props = withDefaults(defineProps<{
  signal: Signal;
  gridConfig: GridConfig;
  isSelected: boolean;
  depth?: number;
  isDragOver?: boolean;
  dropPosition?: 'before' | 'after' | 'inside' | null;
  markers?: Marker[];
  markerPlacementMode?: MarkerPlacementMode;
  isDarkMode?: boolean;
  waveformHeight?: number;
  regions?: SieveRegion[];
  isEditMode?: boolean;
  editTool?: 'draw' | 'annotate' | 'select';
  effectivePoints?: WavePoint[];
  isModified?: boolean;
  isSelectionDragging?: boolean;
  selectionDragStartX?: number | null;
  selectionDragCurrentX?: number | null;
  selectionDragSignals?: string[];
}>(), {
  depth: 0,
  isDragOver: false,
  dropPosition: null,
  markers: () => [],
  markerPlacementMode: 'off',
  isDarkMode: false,
  waveformHeight: 40,
  regions: () => [],
  isEditMode: true,
  editTool: 'draw',
  isModified: false,
  isSelectionDragging: false,
  selectionDragStartX: null,
  selectionDragCurrentX: null,
  selectionDragSignals: () => [],
});

// Use effectivePoints if provided, otherwise use signal.points
const displayPoints = computed(() => props.effectivePoints ?? props.signal.points);

const emit = defineEmits<{
  (e: 'update:points', points: WavePoint[]): void;
  (e: 'select'): void;
  (e: 'rename', name: string): void;
  (e: 'delete'): void;
  (e: 'contextmenu', event: MouseEvent): void;
  (e: 'dragstart', signalId: string): void;
  (e: 'dragend'): void;
  (e: 'dragover', event: DragEvent): void;
  (e: 'dragleave'): void;
  (e: 'drop', event: DragEvent): void;
  (e: 'place-marker', x: number): void;
  (e: 'create-highlight', startX: number, endX: number): void;
  (e: 'selection-start', startX: number): void;
  (e: 'selection-move', currentX: number): void;
  (e: 'selection-end', endX: number): void;
}>();

// For edge snapping
const { findNearestEdge } = useMarkers();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const isEditing = ref(false);
const editName = ref(props.signal.name);
const isDragging = ref(false);
const lastDragX = ref<number | null>(null);

// Annotate dragging state
const isAnnotateDragging = ref(false);
const annotateStartX = ref<number | null>(null);
const annotateEndX = ref<number | null>(null);

// Selection dragging state
const isSelectDragging = ref(false);
const selectStartX = ref<number | null>(null);
const selectEndX = ref<number | null>(null);

// Hover preview state
const hoverGridX = ref<number | null>(null);
const hoverLevel = ref<number | null>(null);

// Marker placement preview state
const markerPreviewX = ref<number | null>(null);

// Block length for extended segment drawing (adjustable via scroll wheel)
const blockLength = ref(1);
const MIN_BLOCK_LENGTH = 1;
const MAX_BLOCK_LENGTH = 20;

// Tooltip state
const tooltipVisible = ref(false);
const tooltipText = ref('');
const tooltipPosition = ref({ x: 0, y: 0 });

const canvasWidth = computed(() => props.gridConfig.cellWidth * props.gridConfig.columns);
const canvasHeight = computed(() => props.waveformHeight);
const labelWidth = 120;

const indentStyle = computed(() => ({
  paddingLeft: `${props.depth * 20 + 12}px`,
}));

const rowStyle = computed(() => ({
  minWidth: `${labelWidth + canvasWidth.value + 4}px`, // +4 for border
}));

const canvasCursor = computed(() => {
  if (!props.isEditMode) {
    return 'default';
  }
  if (props.markerPlacementMode !== 'off') {
    return 'copy';
  }
  if (props.editTool === 'annotate' || props.editTool === 'select') {
    return 'text';  // Text cursor indicates selection
  }
  return 'crosshair';
});

let drawFunctions: ReturnType<typeof useWaveformDraw> | null = null;

function handleDragStart(e: DragEvent) {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', props.signal.id);
    e.dataTransfer.setData('application/x-tree-node', JSON.stringify({
      type: 'signal',
      id: props.signal.id,
    }));
  }
  emit('dragstart', props.signal.id);
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
  emit('dragover', e);
}

function handleDragLeave() {
  emit('dragleave');
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  emit('drop', e);
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault();
  emit('contextmenu', e);
}

onMounted(() => {
  if (canvasRef.value) {
    canvasRef.value.width = canvasWidth.value;
    canvasRef.value.height = canvasHeight.value;
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode);
    render();
  }
});

watch(() => [displayPoints.value, props.gridConfig, props.isSelected, props.markers, props.isDarkMode, props.regions, props.isEditMode, props.effectivePoints, props.isSelectionDragging, props.selectionDragCurrentX, props.selectionDragSignals], () => {
  if (canvasRef.value) {
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode);
  }
  render();
}, { deep: true });

watch(canvasWidth, (newWidth) => {
  if (canvasRef.value) {
    canvasRef.value.width = newWidth;
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode);
    render();
  }
});

watch(canvasHeight, (newHeight) => {
  if (canvasRef.value) {
    canvasRef.value.height = newHeight;
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode);
    render();
  }
});

function render() {
  if (drawFunctions) {
    // Use waveform preview when hovering in edit mode (and not placing markers, and draw tool)
    const showWaveformPreview = props.isEditMode && props.markerPlacementMode === 'off' && props.editTool === 'draw' && hoverGridX.value !== null;
    // Use marker preview when in marker placement mode
    const showMarkerPreview = props.isEditMode && props.markerPlacementMode !== 'off' && markerPreviewX.value !== null;

    // Include annotate preview region if we're dragging an annotation
    let regionsWithPreview = props.regions;
    if (isAnnotateDragging.value && annotateStartX.value !== null && annotateEndX.value !== null) {
      const previewRegion = {
        id: 'annotate-preview',
        startX: Math.min(annotateStartX.value, annotateEndX.value),
        endX: Math.max(annotateStartX.value, annotateEndX.value),
        color: 'rgba(255, 235, 59, 0.4)',  // Yellow preview for annotate
        signalId: props.signal.id,
      };
      regionsWithPreview = [...props.regions, previewRegion];
    }

    // Include local selection preview region if we're dragging a selection in this row
    if (isSelectDragging.value && selectStartX.value !== null && selectEndX.value !== null) {
      const previewRegion = {
        id: 'select-preview',
        startX: Math.min(selectStartX.value, selectEndX.value),
        endX: Math.max(selectStartX.value, selectEndX.value),
        color: 'rgba(33, 150, 243, 0.3)',  // Blue preview for select
        signalId: props.signal.id,
      };
      regionsWithPreview = [...regionsWithPreview, previewRegion];
    }

    // Include global selection preview if this signal is part of the multi-row selection drag
    if (props.isSelectionDragging && props.selectionDragStartX !== null &&
        props.selectionDragSignals?.includes(props.signal.id) && !isSelectDragging.value) {
      const currentX = props.selectionDragCurrentX ?? props.selectionDragStartX;
      const previewRegion = {
        id: 'global-select-preview',
        startX: Math.min(props.selectionDragStartX, currentX),
        endX: Math.max(props.selectionDragStartX, currentX),
        color: 'rgba(33, 150, 243, 0.3)',  // Blue preview for select
        signalId: props.signal.id,
      };
      regionsWithPreview = [...regionsWithPreview, previewRegion];
    }

    if (showWaveformPreview) {
      drawFunctions.renderWithPreview(
        displayPoints.value,
        props.signal.color,
        props.markers,
        regionsWithPreview,
        props.signal.name,
        props.signal.id,
        hoverGridX.value,
        hoverLevel.value,
        blockLength.value
      );
    } else if (showMarkerPreview) {
      drawFunctions.renderWithMarkerPreview(
        displayPoints.value,
        props.signal.color,
        props.markers,
        regionsWithPreview,
        props.signal.name,
        props.signal.id,
        markerPreviewX.value
      );
    } else {
      drawFunctions.renderWithMarkersAndRegions(
        displayPoints.value,
        props.signal.color,
        props.markers,
        regionsWithPreview,
        props.signal.name,
        props.signal.id
      );
    }
  }
}

function getCanvasPosition(e: MouseEvent): { x: number; y: number } {
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function handleMouseDown(e: MouseEvent) {
  emit('select');

  // In view-only mode, only allow selection, not editing
  if (!props.isEditMode) {
    return;
  }

  const { x, y } = getCanvasPosition(e);
  const { snapX, snapLevel } = useGridSnap(props.gridConfig);

  // Handle marker placement mode
  if (props.markerPlacementMode !== 'off') {
    let markerX: number;

    if (props.markerPlacementMode === 'snap-grid') {
      // Snap to grid
      markerX = snapX(x);
    } else if (props.markerPlacementMode === 'snap-edge') {
      // Snap to nearest edge, fall back to grid if no edge nearby
      const gridX = x / props.gridConfig.cellWidth;
      const nearestEdge = findNearestEdge(props.signal, gridX, 1.5);
      markerX = nearestEdge !== null ? nearestEdge : snapX(x);
    } else {
      // Free placement - convert pixel to grid units without snapping
      markerX = x / props.gridConfig.cellWidth;
    }

    emit('place-marker', markerX);
    return;
  }

  // Handle annotate mode
  if (props.editTool === 'annotate') {
    const gridX = snapX(x);
    isAnnotateDragging.value = true;
    annotateStartX.value = gridX;
    annotateEndX.value = gridX;
    render();
    return;
  }

  // Handle select mode - emit to parent for global handling
  if (props.editTool === 'select') {
    const gridX = snapX(x);
    isSelectDragging.value = true;
    selectStartX.value = gridX;
    selectEndX.value = gridX;
    emit('selection-start', gridX);
    render();
    return;
  }

  const gridX = snapX(x);
  const level = snapLevel(y, canvasHeight.value);

  // Ensure level is 0 or 1 for single-bit signals
  const clampedLevel = level ? 1 : 0;
  const endX = gridX + blockLength.value;

  // Helper to get the level at a given position from the current points
  function getLevelAt(points: WavePoint[], pos: number): number {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    let currentLevel = 0;
    for (const p of sorted) {
      if (p.x > pos) break;
      currentLevel = typeof p.level === 'number' ? p.level : Number(p.level);
    }
    return currentLevel;
  }

  // Get the original level at endX before making changes (for restoring after block)
  const originalLevelAtEnd = getLevelAt(props.signal.points, endX);

  // Create new points array
  let newPoints = [...props.signal.points];

  // Add/update the starting point
  const existingPointIndex = newPoints.findIndex(p => p.x === gridX);
  if (existingPointIndex !== -1) {
    newPoints[existingPointIndex] = { x: gridX, level: clampedLevel };
  } else {
    newPoints.push({ x: gridX, level: clampedLevel });
  }

  // If block length > 1, create a bounded block
  if (blockLength.value > 1) {
    // Remove points strictly between gridX and endX
    newPoints = newPoints.filter(p => p.x <= gridX || p.x >= endX);

    // Add endpoint to return to original level (only if different from the new level)
    if (originalLevelAtEnd !== clampedLevel) {
      const endPointIndex = newPoints.findIndex(p => p.x === endX);
      if (endPointIndex !== -1) {
        newPoints[endPointIndex] = { x: endX, level: originalLevelAtEnd };
      } else {
        newPoints.push({ x: endX, level: originalLevelAtEnd });
      }
    }
  }

  emit('update:points', newPoints);

  isDragging.value = true;
  lastDragX.value = gridX;
}

function handleWheel(e: WheelEvent) {
  // Only adjust block length in edit mode when hovering (preview visible)
  if (!props.isEditMode || props.markerPlacementMode !== 'off' || hoverGridX.value === null) {
    return;
  }

  e.preventDefault();

  // Scroll up = increase block length, scroll down = decrease
  if (e.deltaY < 0) {
    blockLength.value = Math.min(MAX_BLOCK_LENGTH, blockLength.value + 1);
  } else if (e.deltaY > 0) {
    blockLength.value = Math.max(MIN_BLOCK_LENGTH, blockLength.value - 1);
  }

  render();
}

function findRegionAtPosition(gridX: number): SieveRegion | null {
  for (const region of props.regions) {
    // Skip if region is for a different signal (check signalId first, then signalName)
    if (region.signalId && region.signalId !== props.signal.id) {
      continue;
    }
    if (!region.signalId && region.signalName && region.signalName !== props.signal.name) {
      continue;
    }
    if (gridX >= region.startX && gridX <= region.endX && region.tooltip) {
      return region;
    }
  }
  return null;
}

function handleMouseMove(e: MouseEvent) {
  const { x, y } = getCanvasPosition(e);
  const gridX = x / props.gridConfig.cellWidth;

  // Check for region tooltip
  const region = findRegionAtPosition(gridX);
  if (region && region.tooltip) {
    tooltipVisible.value = true;
    tooltipText.value = region.tooltip;
    tooltipPosition.value = { x: x + 10, y: -30 };
  } else {
    tooltipVisible.value = false;
  }

  const { snapX, snapLevel } = useGridSnap(props.gridConfig);

  // Update marker preview when in marker placement mode
  if (props.isEditMode && props.markerPlacementMode !== 'off') {
    let previewX: number;

    if (props.markerPlacementMode === 'snap-grid') {
      previewX = snapX(x);
    } else if (props.markerPlacementMode === 'snap-edge') {
      const nearestEdge = findNearestEdge(props.signal, gridX, 1.5);
      previewX = nearestEdge !== null ? nearestEdge : snapX(x);
    } else {
      // Free placement
      previewX = gridX;
    }

    if (markerPreviewX.value !== previewX) {
      markerPreviewX.value = previewX;
      render();
    }
  }

  // Handle annotate dragging
  if (props.isEditMode && props.editTool === 'annotate' && isAnnotateDragging.value) {
    const snappedX = snapX(x);
    if (annotateEndX.value !== snappedX) {
      annotateEndX.value = snappedX;
      render();
    }
    return;
  }

  // Handle selection dragging (local drag within this row)
  if (props.isEditMode && props.editTool === 'select' && isSelectDragging.value) {
    const snappedX = snapX(x);
    if (selectEndX.value !== snappedX) {
      selectEndX.value = snappedX;
      emit('selection-move', snappedX);
      render();
    }
    return;
  }

  // Handle global selection drag - when mouse moves over this row during multi-row selection
  if (props.isEditMode && props.editTool === 'select' && props.isSelectionDragging && !isSelectDragging.value) {
    const snappedX = snapX(x);
    // Notify parent that this signal should be part of the selection
    emit('selection-move', snappedX);
    // Update local selectEndX to show preview
    selectEndX.value = snappedX;
    render();
    return;
  }

  // Update hover preview state (only in edit mode and not in marker placement mode and draw tool)
  if (props.isEditMode && props.markerPlacementMode === 'off' && props.editTool === 'draw') {
    const snappedX = snapX(x);
    const level = snapLevel(y, canvasHeight.value);
    const clampedLevel = level ? 1 : 0;

    // Only re-render if hover position changed
    if (hoverGridX.value !== snappedX || hoverLevel.value !== clampedLevel) {
      hoverGridX.value = snappedX;
      hoverLevel.value = clampedLevel;
      render();
    }

    // Handle drag-to-draw: continuously draw as mouse moves while dragging
    if (isDragging.value && snappedX !== lastDragX.value) {
      const existingPointIndex = props.signal.points.findIndex(p => p.x === snappedX);

      let newPoints: WavePoint[];
      if (existingPointIndex === -1) {
        newPoints = [...props.signal.points, { x: snappedX, level: clampedLevel }];
      } else {
        newPoints = [...props.signal.points];
        newPoints[existingPointIndex] = { x: snappedX, level: clampedLevel };
      }

      emit('update:points', newPoints);
      lastDragX.value = snappedX;
    }
  }
}

function handleMouseUp() {
  // Finalize annotation if we were dragging one
  if (isAnnotateDragging.value && annotateStartX.value !== null && annotateEndX.value !== null) {
    // Only create annotation if there's an actual range
    if (annotateStartX.value !== annotateEndX.value) {
      emit('create-highlight', annotateStartX.value, annotateEndX.value);
    }
    isAnnotateDragging.value = false;
    annotateStartX.value = null;
    annotateEndX.value = null;
    render();
    return;
  }

  // Finalize selection if we were dragging one
  if (isSelectDragging.value && selectStartX.value !== null && selectEndX.value !== null) {
    // Emit selection-end with the final X position
    emit('selection-end', selectEndX.value);
    isSelectDragging.value = false;
    selectStartX.value = null;
    selectEndX.value = null;
    render();
    return;
  }

  // Handle global selection end if mouse up happens in this row
  if (props.isSelectionDragging && selectEndX.value !== null) {
    emit('selection-end', selectEndX.value);
    selectEndX.value = null;
    render();
    return;
  }

  isDragging.value = false;
  lastDragX.value = null;
}

function handleMouseLeave() {
  tooltipVisible.value = false;

  // Reset drag state
  isDragging.value = false;
  lastDragX.value = null;

  // Reset annotate drag state
  isAnnotateDragging.value = false;
  annotateStartX.value = null;
  annotateEndX.value = null;

  // Reset selection drag state
  isSelectDragging.value = false;
  selectStartX.value = null;
  selectEndX.value = null;

  // Clear hover previews
  const needsRender = hoverGridX.value !== null || hoverLevel.value !== null || markerPreviewX.value !== null;
  hoverGridX.value = null;
  hoverLevel.value = null;
  markerPreviewX.value = null;
  if (needsRender) {
    render();
  }
}

function startEditing() {
  editName.value = props.signal.name;
  isEditing.value = true;
}

function finishEditing() {
  if (editName.value.trim()) {
    emit('rename', editName.value.trim());
  }
  isEditing.value = false;
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    finishEditing();
  } else if (e.key === 'Escape') {
    isEditing.value = false;
  }
}
</script>

<template>
  <div
    class="signal-row"
    :class="{
      selected: isSelected,
      'drag-over': isDragOver,
      'drop-before': dropPosition === 'before',
      'drop-after': dropPosition === 'after',
      'dark-mode': isDarkMode,
      'derived': signal.isDerived,
    }"
    :style="rowStyle"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @contextmenu="handleContextMenu"
  >
    <div class="signal-label" :style="indentStyle">
      <span
        class="drag-handle"
        title="Drag to reorder"
        draggable="true"
        @dragstart="handleDragStart"
        @dragend="emit('dragend')"
      >&#x2630;</span>
      <input
        v-if="isEditing"
        v-model="editName"
        @blur="finishEditing"
        @keydown="handleKeydown"
        class="name-input"
        ref="nameInput"
      />
      <span v-else @dblclick="startEditing" class="name-text">
        {{ signal.name }}
        <span v-if="isModified" class="modified-badge" title="Modified by sieve">&#9998;</span>
      </span>
      <button @click="$emit('delete')" class="delete-btn" title="Delete signal">
        &times;
      </button>
    </div>
    <div class="canvas-container">
      <canvas
        ref="canvasRef"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave"
        @wheel="handleWheel"
        class="waveform-canvas"
        :style="{ cursor: canvasCursor }"
      />
      <div
        v-if="tooltipVisible"
        class="region-tooltip"
        :style="{
          left: tooltipPosition.x + 'px',
          top: tooltipPosition.y + 'px',
        }"
      >
        {{ tooltipText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.signal-row {
  display: flex;
  align-items: stretch;
  border: 1px solid transparent;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
  position: relative;
}

.signal-row.derived {
  background: #fff0f3;
}

.signal-row.derived .signal-label {
  background: #ffe0e6;
}

.signal-row.selected {
  border-color: #2196F3;
  background: #f0f7ff;
}

.signal-row.derived.selected {
  background: #ffe8ec;
}

.signal-row.drag-over {
  background: #f5f5ff;
}

.signal-row.drop-before::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: #42a5f5;
  z-index: 10;
}

.signal-row.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: #42a5f5;
  z-index: 10;
}

.signal-row:active {
  cursor: grabbing;
}

.signal-label {
  width: 120px;
  min-width: 120px;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f0f0f0;
  border-right: 1px solid #ddd;
  position: sticky;
  left: 0;
  z-index: 1;
  font-size: 12px;
}

.drag-handle {
  cursor: grab;
  color: #999;
  margin-right: 6px;
  font-size: 11px;
}

.drag-handle:hover {
  color: #666;
}

.name-text {
  cursor: pointer;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.modified-badge {
  color: #ff9800;
  font-size: 10px;
  margin-left: 3px;
}

.name-input {
  width: 80px;
  padding: 2px 4px;
  border: 1px solid #2196F3;
  border-radius: 2px;
  font-size: inherit;
}

.delete-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}

.delete-btn:hover {
  color: #f44336;
}

.canvas-container {
  flex: 0 0 auto;
  position: relative;
}

.waveform-canvas {
  display: block;
}

.region-tooltip {
  position: absolute;
  background: #fffde7;
  border: 1px solid #fbc02d;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #333;
  white-space: pre-wrap;
  max-width: 300px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 100;
  pointer-events: none;
}

/* Dark Mode Styles */
.signal-row.dark-mode {
  background: #2a2a3e;
  border-bottom-color: #3a3a4e;
}

.signal-row.dark-mode.selected {
  border-color: #64B5F6;
  background: #2d3a4e;
}

.signal-row.dark-mode.drag-over {
  background: #3a3a5e;
}

.signal-row.dark-mode .signal-label {
  background: #252538;
  border-color: #444;
  color: #e0e0e0;
}

.signal-row.dark-mode .drag-handle {
  color: #666;
}

.signal-row.dark-mode .drag-handle:hover {
  color: #999;
}

.signal-row.dark-mode .name-text {
  color: #e0e0e0;
}

.signal-row.dark-mode .modified-badge {
  color: #ffb74d;
}

.signal-row.dark-mode .name-input {
  background: #1e1e2e;
  border-color: #64B5F6;
  color: #e0e0e0;
}

.signal-row.dark-mode .delete-btn {
  color: #666;
}

.signal-row.dark-mode .delete-btn:hover {
  color: #f44336;
}

/* Dark mode derived signal styles */
.signal-row.dark-mode.derived {
  background: #3a2a35;
}

.signal-row.dark-mode.derived .signal-label {
  background: #352530;
}

.signal-row.dark-mode.derived.selected {
  background: #3d2a3a;
}
</style>
