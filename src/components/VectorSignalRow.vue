<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import type { Signal, GridConfig, WavePoint, DisplayFormat, Marker, MarkerPlacementMode, SieveRegion } from '../types/waveform';
import type { ViewportBounds } from '../composables/useViewport';
import { WaveValue } from '../types/WaveValue';
import { useGridSnap } from '../composables/useGridSnap';
import { useWaveformDraw, formatValue } from '../composables/useWaveformDraw';
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
  editTool?: 'draw' | 'select';
  effectivePoints?: WavePoint[];
  isModified?: boolean;
  isSelectionDragging?: boolean;
  selectionDragStartX?: number | null;
  selectionDragCurrentX?: number | null;
  selectionDragSignals?: string[];
  viewportBounds?: ViewportBounds;
  scrollLeft?: number;
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
  viewportBounds: undefined,
  scrollLeft: 0,
});

// Use effectivePoints if provided, otherwise use signal.points
const displayPoints = computed(() => props.effectivePoints ?? props.signal.points);

const emit = defineEmits<{
  (e: 'update:points', points: WavePoint[]): void;
  (e: 'update:displayFormat', format: DisplayFormat): void;
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
  (e: 'selection-start', startX: number): void;
  (e: 'selection-move', currentX: number): void;
  (e: 'selection-end', endX: number): void;
}>();

// For edge snapping
const { findNearestEdge } = useMarkers();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const isEditing = ref(false);
const editName = ref(props.signal.name);
const valueInputRef = ref<HTMLInputElement | null>(null);
const isEditingValue = ref(false);
const editingPointX = ref<number | null>(null);
const editValue = ref('');
const editInputPosition = ref({ x: 0, y: 0 });
const isInAddTransitionZone = ref(false);

// Hover preview state
const hoverGridX = ref<number | null>(null);

// Marker placement preview state
const markerPreviewX = ref<number | null>(null);

// Selection dragging state
const isSelectDragging = ref(false);
const selectStartX = ref<number | null>(null);
const selectEndX = ref<number | null>(null);

// Tooltip state
const tooltipVisible = ref(false);
const tooltipText = ref('');
const tooltipPosition = ref({ x: 0, y: 0 });

// Full canvas width (for scrollbar/spacer)
const fullCanvasWidth = computed(() => props.gridConfig.cellWidth * props.gridConfig.columns);
const canvasHeight = computed(() => props.waveformHeight);
const addTransitionZoneHeight = computed(() => Math.max(10, props.waveformHeight * 0.3)); // Bottom 30% for "add transition" zone
const labelWidth = 120;

// Viewport-aware canvas sizing
const useViewportRendering = computed(() => props.viewportBounds !== undefined);
const renderOffset = computed(() => props.viewportBounds?.renderOffset ?? 0);
const visibleStartColumn = computed(() => props.viewportBounds?.startColumn ?? 0);
const visibleEndColumn = computed(() => props.viewportBounds?.endColumn ?? props.gridConfig.columns);

// Canvas width - use viewport-based sizing if available, otherwise full width
const canvasWidth = computed(() => {
  if (useViewportRendering.value && props.viewportBounds) {
    const { startColumn, endColumn } = props.viewportBounds;
    return (endColumn - startColumn) * props.gridConfig.cellWidth;
  }
  return fullCanvasWidth.value;
});

// Filter points to visible range for efficient rendering
const visiblePoints = computed(() => {
  const points = displayPoints.value;
  if (!useViewportRendering.value || points.length === 0) {
    return points;
  }

  // Sort points by x position
  const sortedPoints = [...points].sort((a, b) => a.x - b.x);

  // Find first point at or after visible start (include one before for entering line)
  let startIndex = 0;
  for (let i = 0; i < sortedPoints.length; i++) {
    if (sortedPoints[i]!.x >= visibleStartColumn.value) {
      startIndex = Math.max(0, i - 1);
      break;
    }
    startIndex = i;
  }

  // Find all points up to visible end (include one after for exiting line)
  const visiblePts: WavePoint[] = [];
  for (let i = startIndex; i < sortedPoints.length; i++) {
    const point = sortedPoints[i]!;
    visiblePts.push(point);
    if (point.x > visibleEndColumn.value) {
      break;
    }
  }

  return visiblePts;
});

const indentStyle = computed(() => ({
  paddingLeft: `${props.depth * 20 + 12}px`,
}));

const rowStyle = computed(() => ({
  minWidth: `${labelWidth + fullCanvasWidth.value + 4}px`, // +4 for border
}));

// Canvas transform for viewport positioning
const canvasStyle = computed(() => {
  if (useViewportRendering.value) {
    return {
      transform: `translateX(${renderOffset.value}px)`,
    };
  }
  return {};
});

const canvasCursor = computed(() => {
  if (!props.isEditMode) {
    return 'default';
  }
  if (props.markerPlacementMode !== 'off') {
    return 'copy';
  }
  if (props.editTool === 'select') {
    return 'text';  // Text cursor indicates selection
  }
  if (isInAddTransitionZone.value) {
    return 'cell'; // Shows a + cursor for adding
  }
  return 'pointer';
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
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode, renderOffset.value);
    render();
  }
});

watch(() => [displayPoints.value, props.signal.displayFormat, props.gridConfig, props.isSelected, props.markers, props.isDarkMode, props.regions, props.isEditMode, props.effectivePoints, props.isSelectionDragging, props.selectionDragCurrentX, props.selectionDragSignals, props.viewportBounds], () => {
  if (canvasRef.value) {
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode, renderOffset.value);
  }
  render();
}, { deep: true });

watch(canvasWidth, (newWidth) => {
  if (canvasRef.value) {
    canvasRef.value.width = newWidth;
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode, renderOffset.value);
    render();
  }
});

watch(canvasHeight, (newHeight) => {
  if (canvasRef.value) {
    canvasRef.value.height = newHeight;
    drawFunctions = useWaveformDraw(canvasRef.value, props.gridConfig, props.isDarkMode, props.isEditMode, renderOffset.value);
    render();
  }
});

function render() {
  if (drawFunctions) {
    // Use preview render when hovering in edit mode in the add transition zone (only in draw mode)
    const showTransitionPreview = props.isEditMode && props.markerPlacementMode === 'off' && props.editTool === 'draw' && isInAddTransitionZone.value;
    // Use marker preview when in marker placement mode
    const showMarkerPreview = props.isEditMode && props.markerPlacementMode !== 'off' && markerPreviewX.value !== null;

    // Include local selection preview region if we're dragging a selection in this row
    let regionsWithPreview = props.regions;
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

    // Use visiblePoints for efficient viewport rendering
    const pointsToRender = visiblePoints.value;

    if (showMarkerPreview) {
      drawFunctions.renderBusWithMarkerPreview(
        pointsToRender,
        props.signal.color,
        props.signal.width,
        props.signal.displayFormat,
        props.markers,
        regionsWithPreview,
        props.signal.name,
        props.signal.id,
        markerPreviewX.value
      );
    } else {
      drawFunctions.renderBusWithPreview(
        pointsToRender,
        props.signal.color,
        props.signal.width,
        props.signal.displayFormat,
        props.markers,
        regionsWithPreview,
        props.signal.name,
        props.signal.id,
        hoverGridX.value,
        showTransitionPreview
      );
    }
  }
}

function getCanvasPosition(e: MouseEvent): { x: number; y: number } {
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  // Add renderOffset to convert canvas-relative x to absolute x
  return {
    x: e.clientX - rect.left + renderOffset.value,
    y: e.clientY - rect.top,
  };
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

function handleCanvasMouseMove(e: MouseEvent) {
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

  const { snapX } = useGridSnap(props.gridConfig);

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

  // Check if mouse is in the bottom zone for adding transitions
  const wasInAddZone = isInAddTransitionZone.value;
  isInAddTransitionZone.value = y > (canvasHeight.value - addTransitionZoneHeight.value);

  // Update hover preview state (only in edit mode and not in marker placement mode and draw tool)
  if (props.isEditMode && props.markerPlacementMode === 'off' && props.editTool === 'draw') {
    const snappedX = snapX(x);

    // Re-render if hover position changed or zone changed
    if (hoverGridX.value !== snappedX || wasInAddZone !== isInAddTransitionZone.value) {
      hoverGridX.value = snappedX;
      render();
    }
  }
}

function handleCanvasMouseLeave() {
  isInAddTransitionZone.value = false;
  tooltipVisible.value = false;

  // Reset selection drag state
  isSelectDragging.value = false;
  selectStartX.value = null;
  selectEndX.value = null;

  // Clear hover previews
  const needsRender = hoverGridX.value !== null || markerPreviewX.value !== null;
  hoverGridX.value = null;
  markerPreviewX.value = null;
  if (needsRender) {
    render();
  }
}

function handleCanvasMouseDown(e: MouseEvent) {
  emit('select');

  // In view-only mode, only allow selection, not editing
  if (!props.isEditMode) {
    return;
  }

  // Handle select mode - emit to parent for global handling
  if (props.editTool === 'select') {
    const { x } = getCanvasPosition(e);
    const { snapX } = useGridSnap(props.gridConfig);
    const gridX = snapX(x);
    isSelectDragging.value = true;
    selectStartX.value = gridX;
    selectEndX.value = gridX;
    emit('selection-start', gridX);
    render();
    return;
  }
}

function handleCanvasMouseUp(e: MouseEvent) {
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
}

function handleCanvasClick(e: MouseEvent) {
  emit('select');

  // In view-only mode, only allow selection, not editing
  if (!props.isEditMode) {
    return;
  }

  // Skip normal click handling in select mode
  if (props.editTool === 'select') {
    return;
  }

  const { x, y } = getCanvasPosition(e);
  const { snapX } = useGridSnap(props.gridConfig);

  // Handle marker placement mode
  if (props.markerPlacementMode !== 'off') {
    let markerX: number;

    if (props.markerPlacementMode === 'snap-grid') {
      // Snap to grid
      markerX = snapX(x);
    } else if (props.markerPlacementMode === 'snap-edge') {
      // Snap to nearest edge (value change), fall back to grid if no edge nearby
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

  const gridX = snapX(x);
  const inAddZone = y > (canvasHeight.value - addTransitionZoneHeight.value);

  if (inAddZone) {
    // Add a new transition point at this position
    // Check if a point already exists at this exact position
    const existingPoint = props.signal.points.find(p => p.x === gridX);
    if (existingPoint) {
      // Edit the existing point's value
      startValueEdit(gridX, e);
    } else {
      // Create new point at this position with value 0, then prompt for value
      const newPoints = [...props.signal.points, { x: gridX, level: 0 }];
      emit('update:points', newPoints);
      // Start editing the new point (value to the RIGHT of the transition)
      setTimeout(() => startValueEdit(gridX, e), 50);
    }
  } else {
    // Click in upper area - edit the value of the segment we're in
    const sortedPoints = [...props.signal.points].sort((a, b) => a.x - b.x);
    let clickedPointX: number | null = null;

    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i]!;
      const startX = point.x;
      const nextPoint = sortedPoints[i + 1];
      const endX = nextPoint !== undefined
        ? nextPoint.x
        : props.gridConfig.columns;

      if (gridX >= startX && gridX < endX) {
        clickedPointX = point.x;
        break;
      }
    }

    if (clickedPointX !== null) {
      // Edit existing segment's value
      startValueEdit(clickedPointX, e);
    }
  }
}

function startValueEdit(pointX: number, e: MouseEvent) {
  editingPointX.value = pointX;
  const point = props.signal.points.find(p => p.x === pointX);
  editValue.value = point
    ? formatValue(point.level, props.signal.width, props.signal.displayFormat)
    : '0';
  isEditingValue.value = true;

  // Position the input near the click
  const canvas = canvasRef.value!;
  const canvasContainer = canvas.parentElement!;
  const containerRect = canvasContainer.getBoundingClientRect();

  editInputPosition.value = {
    x: e.clientX - containerRect.left - 40,
    y: canvasHeight.value / 2 - 12,
  };

  setTimeout(() => {
    valueInputRef.value?.focus();
    valueInputRef.value?.select();
  }, 10);
}

function parseInputValue(input: string): bigint {
  // Use WaveValue for parsing with format detection
  const waveValue = WaveValue.parse(input, props.signal.displayFormat);
  // Clamp to valid range for the bit width
  const clamped = waveValue.clamp(props.signal.width);
  return clamped.value;
}

function finishValueEdit() {
  if (editingPointX.value !== null) {
    const newValue = parseInputValue(editValue.value);
    const existingIndex = props.signal.points.findIndex(p => p.x === editingPointX.value);

    if (existingIndex !== -1) {
      const newPoints = [...props.signal.points];
      newPoints[existingIndex] = { x: editingPointX.value, level: newValue };
      emit('update:points', newPoints);
    }
  }

  isEditingValue.value = false;
  editingPointX.value = null;
}

function cancelValueEdit() {
  isEditingValue.value = false;
  editingPointX.value = null;
}

function handleValueKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    finishValueEdit();
  } else if (e.key === 'Escape') {
    cancelValueEdit();
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

function changeDisplayFormat(format: DisplayFormat) {
  emit('update:displayFormat', format);
}
</script>

<template>
  <div
    class="signal-row vector"
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
      <div class="label-top">
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
        />
        <span v-else @dblclick="startEditing" class="name-text">
          {{ signal.name }}
          <span v-if="isModified" class="modified-badge" title="Modified by sieve">&#9998;</span>
        </span>
        <button @click="$emit('delete')" class="delete-btn" title="Delete signal">
          &times;
        </button>
      </div>
      <div class="label-bottom">
        <span class="bit-width">[{{ signal.width - 1 }}:0]</span>
        <select
          :value="signal.displayFormat"
          @change="changeDisplayFormat(($event.target as HTMLSelectElement).value as DisplayFormat)"
          class="format-select"
          title="Display format"
        >
          <option value="hex">Hex</option>
          <option value="decimal">Dec</option>
          <option value="binary">Bin</option>
        </select>
      </div>
    </div>
    <div class="canvas-container" :style="{ width: fullCanvasWidth + 'px' }">
      <!-- Spacer div to maintain full scrollable width -->
      <div v-if="useViewportRendering" class="canvas-spacer" :style="{ width: fullCanvasWidth + 'px' }"></div>
      <canvas
        ref="canvasRef"
        @mousedown="handleCanvasMouseDown"
        @mouseup="handleCanvasMouseUp"
        @click="handleCanvasClick"
        @mousemove="handleCanvasMouseMove"
        @mouseleave="handleCanvasMouseLeave"
        class="waveform-canvas"
        :style="{ cursor: canvasCursor, ...canvasStyle }"
      />
      <input
        v-if="isEditingValue"
        ref="valueInputRef"
        v-model="editValue"
        @blur="finishValueEdit"
        @keydown="handleValueKeydown"
        class="value-input"
        :style="{
          left: editInputPosition.x + 'px',
          top: editInputPosition.y + 'px',
        }"
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

.signal-row.vector {
  background: #f5f8ff;
}

.signal-row.selected {
  border-color: #2196F3;
  background: #f0f7ff;
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

.signal-label {
  width: 120px;
  min-width: 120px;
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #e8eef8;
  border-right: 1px solid #ddd;
  position: sticky;
  left: 0;
  z-index: 1;
  font-size: 12px;
}

.label-top {
  display: flex;
  align-items: center;
}

.label-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.bit-width {
  font-size: 10px;
  color: #666;
  font-family: monospace;
}

.format-select {
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: white;
  cursor: pointer;
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
  width: 60px;
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
  position: absolute;
  top: 0;
  left: 0;
}

.canvas-spacer {
  height: 1px;
  visibility: hidden;
}

.value-input {
  position: absolute;
  width: 80px;
  padding: 4px 8px;
  font-family: monospace;
  font-size: 12px;
  border: 2px solid #2196F3;
  border-radius: 4px;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
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

.signal-row.vector.dark-mode {
  background: #2a3040;
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

.signal-row.dark-mode .bit-width {
  color: #999;
}

.signal-row.dark-mode .format-select {
  background: #1e1e2e;
  border-color: #444;
  color: #e0e0e0;
}

.signal-row.dark-mode .value-input {
  background: #1e1e2e;
  border-color: #64B5F6;
  color: #e0e0e0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

/* Derived signal styles */
.signal-row.vector.derived {
  background: #fff0f3;
}

.signal-row.vector.derived .signal-label {
  background: #ffe0e6;
}

.signal-row.vector.derived.selected {
  background: #ffe8ec;
}

/* Dark mode derived signal styles */
.signal-row.vector.dark-mode.derived {
  background: #3a2a35;
}

.signal-row.vector.dark-mode.derived .signal-label {
  background: #352530;
}

.signal-row.vector.dark-mode.derived.selected {
  background: #3d2a3a;
}
</style>
