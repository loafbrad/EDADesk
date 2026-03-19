<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNode, Signal, SignalGroup, GridConfig, Marker, MarkerPlacementMode, SieveRegion, WavePoint } from '../types/waveform';
import type { ViewportBounds } from '../composables/useViewport';
import { isSignalReference, isSignalGroup } from '../types/waveform';
import type { SieveState } from '../composables/useSieve';
import SignalGroupHeader from './SignalGroupHeader.vue';
import SignalRow from './SignalRow.vue';
import VectorSignalRow from './VectorSignalRow.vue';

const props = withDefaults(defineProps<{
  node: TreeNode;
  depth: number;
  signals: Signal[];
  gridConfig: GridConfig;
  selectedSignalId: string | null;
  allGroups: SignalGroup[];
  dragOverNodeId: string | null;
  dropPosition: 'before' | 'after' | 'inside' | null;
  markers: Marker[];
  markerPlacementMode?: MarkerPlacementMode;
  isDarkMode?: boolean;
  waveformHeight?: number;
  regions?: SieveRegion[];
  isEditMode?: boolean;
  editTool?: 'draw' | 'select';
  getSievesForGroup?: (groupId: string) => SieveState[];
  isSieveDragging?: boolean;
  getEffectivePoints?: (signal: Signal, showOriginal?: boolean) => WavePoint[];
  isSignalModified?: (signalId: string) => boolean;
  showOriginalData?: boolean;
  isSelectionDragging?: boolean;
  selectionDragStartX?: number | null;
  selectionDragCurrentX?: number | null;
  selectionDragSignals?: string[];
  viewportBounds?: ViewportBounds;
  scrollLeft?: number;
}>(), {
  markerPlacementMode: 'off',
  isDarkMode: false,
  waveformHeight: 40,
  regions: () => [],
  isEditMode: true,
  editTool: 'draw',
  isSieveDragging: false,
  showOriginalData: false,
  isSelectionDragging: false,
  selectionDragStartX: null,
  selectionDragCurrentX: null,
  selectionDragSignals: () => [],
  viewportBounds: undefined,
  scrollLeft: 0,
});

const emit = defineEmits<{
  (e: 'toggle-collapse', groupId: string): void;
  (e: 'rename-group', groupId: string, name: string): void;
  (e: 'select-signal', signalId: string): void;
  (e: 'update-points', signalId: string, points: any[]): void;
  (e: 'rename-signal', signalId: string, name: string): void;
  (e: 'delete-signal', signalId: string): void;
  (e: 'update-display-format', signalId: string, format: 'hex' | 'decimal' | 'binary'): void;
  (e: 'contextmenu', event: MouseEvent, nodeId: string, nodeType: 'signal' | 'group', signalId?: string): void;
  (e: 'dragstart', nodeId: string, nodeType: 'signal' | 'group'): void;
  (e: 'dragend'): void;
  (e: 'dragover', event: DragEvent, nodeId: string): void;
  (e: 'dragleave', nodeId: string): void;
  (e: 'drop', event: DragEvent, nodeId: string): void;
  (e: 'place-marker', x: number): void;
  (e: 'selection-start', startX: number, signalId: string): void;
  (e: 'selection-move', currentX: number, signalId: string): void;
  (e: 'selection-end', endX: number): void;
  (e: 'sieve-toggle', sieveId: string, enabled: boolean): void;
  (e: 'sieve-remove-from-group', sieveId: string, groupId: string): void;
  (e: 'sieve-drop', sieveId: string, groupId: string): void;
}>();

// Get the signal for a signal reference
const signal = computed(() => {
  if (isSignalReference(props.node)) {
    const ref = props.node;
    return props.signals.find(s => s.id === ref.signalId);
  }
  return null;
});

// Get effective points for the signal (with sieve modifications applied)
const effectivePoints = computed(() => {
  if (!signal.value || !props.getEffectivePoints) return undefined;
  return props.getEffectivePoints(signal.value, props.showOriginalData);
});

// Check if the signal is modified by sieves
const isModified = computed(() => {
  if (!signal.value || !props.isSignalModified) return false;
  return props.isSignalModified(signal.value.id);
});

// Get child count for groups
const childCount = computed(() => {
  if (isSignalGroup(props.node)) {
    return countChildren(props.node.children);
  }
  return 0;
});

function countChildren(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (isSignalGroup(node)) {
      count += countChildren(node.children);
    }
  }
  return count;
}

// Check if this node is being dragged over
const isDragOver = computed(() => props.dragOverNodeId === props.node.id);
const currentDropPosition = computed(() => isDragOver.value ? props.dropPosition : null);

// Get sieves assigned to this group
const assignedSieves = computed(() => {
  if (isSignalGroup(props.node) && props.getSievesForGroup) {
    return props.getSievesForGroup(props.node.id);
  }
  return [];
});

// Check if a sieve is being dragged over this group
const isSieveDragOver = computed(() =>
  isSignalGroup(props.node) && props.isSieveDragging && isDragOver.value
);

// Group-specific handlers
function handleGroupToggle() {
  emit('toggle-collapse', props.node.id);
}

function handleGroupRename(name: string) {
  emit('rename-group', props.node.id, name);
}

function handleGroupContextMenu(event: MouseEvent) {
  emit('contextmenu', event, props.node.id, 'group');
}

function handleGroupDragStart() {
  emit('dragstart', props.node.id, 'group');
}

// Signal-specific handlers
function handleSignalSelect() {
  if (signal.value) {
    emit('select-signal', signal.value.id);
  }
}

function handleSignalUpdatePoints(points: any[]) {
  if (signal.value) {
    emit('update-points', signal.value.id, points);
  }
}

function handleSignalRename(name: string) {
  if (signal.value) {
    emit('rename-signal', signal.value.id, name);
  }
}

function handleSignalDelete() {
  if (signal.value) {
    emit('delete-signal', signal.value.id);
  }
}

function handleSignalDisplayFormat(format: 'hex' | 'decimal' | 'binary') {
  if (signal.value) {
    emit('update-display-format', signal.value.id, format);
  }
}

function handleSignalContextMenu(event: MouseEvent) {
  if (signal.value) {
    emit('contextmenu', event, props.node.id, 'signal', signal.value.id);
  }
}

function handleSignalDragStart() {
  emit('dragstart', props.node.id, 'signal');
}

// Common drag handlers
function handleDragOver(event: DragEvent) {
  emit('dragover', event, props.node.id);
}

function handleDragLeave() {
  emit('dragleave', props.node.id);
}

function handleDrop(event: DragEvent) {
  emit('drop', event, props.node.id);
}
</script>

<template>
  <!-- Group Node -->
  <template v-if="isSignalGroup(node)">
    <SignalGroupHeader
      :group="node"
      :depth="depth"
      :child-count="childCount"
      :is-drag-over="isDragOver"
      :drop-position="currentDropPosition"
      :assigned-sieves="assignedSieves"
      :is-sieve-drag-over="isSieveDragOver"
      @toggle-collapse="handleGroupToggle"
      @rename="handleGroupRename"
      @contextmenu="handleGroupContextMenu"
      @dragstart="handleGroupDragStart"
      @dragend="emit('dragend')"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @sieve-toggle="(id, enabled) => emit('sieve-toggle', id, enabled)"
      @sieve-remove-from-group="(sieveId, groupId) => emit('sieve-remove-from-group', sieveId, groupId)"
      @sieve-drop="(sieveId, groupId) => emit('sieve-drop', sieveId, groupId)"
    />

    <!-- Render children if not collapsed -->
    <template v-if="!node.isCollapsed">
      <SignalTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :signals="signals"
        :grid-config="gridConfig"
        :selected-signal-id="selectedSignalId"
        :all-groups="allGroups"
        :drag-over-node-id="dragOverNodeId"
        :drop-position="dropPosition"
        :markers="markers"
        :marker-placement-mode="markerPlacementMode"
        :is-dark-mode="isDarkMode"
        :waveform-height="waveformHeight"
        :regions="regions"
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
        @toggle-collapse="(id) => emit('toggle-collapse', id)"
        @rename-group="(id, name) => emit('rename-group', id, name)"
        @select-signal="(id) => emit('select-signal', id)"
        @update-points="(id, pts) => emit('update-points', id, pts)"
        @rename-signal="(id, name) => emit('rename-signal', id, name)"
        @delete-signal="(id) => emit('delete-signal', id)"
        @update-display-format="(id, fmt) => emit('update-display-format', id, fmt)"
        @contextmenu="(e, nid, t, sid) => emit('contextmenu', e, nid, t, sid)"
        @dragstart="(id, t) => emit('dragstart', id, t)"
        @dragend="emit('dragend')"
        @dragover="(e, id) => emit('dragover', e, id)"
        @dragleave="(id) => emit('dragleave', id)"
        @drop="(e, id) => emit('drop', e, id)"
        @place-marker="(x) => emit('place-marker', x)"
        @selection-start="(startX, signalId) => emit('selection-start', startX, signalId)"
        @selection-move="(currentX, signalId) => emit('selection-move', currentX, signalId)"
        @selection-end="(endX) => emit('selection-end', endX)"
        @sieve-toggle="(id, enabled) => emit('sieve-toggle', id, enabled)"
        @sieve-remove-from-group="(sieveId, groupId) => emit('sieve-remove-from-group', sieveId, groupId)"
        @sieve-drop="(sieveId, groupId) => emit('sieve-drop', sieveId, groupId)"
      />
    </template>
  </template>

  <!-- Signal Reference Node -->
  <template v-else-if="isSignalReference(node) && signal">
    <!-- Single-bit signal -->
    <SignalRow
      v-if="signal.width === 1"
      :signal="signal"
      :grid-config="gridConfig"
      :is-selected="selectedSignalId === signal.id"
      :depth="depth"
      :is-drag-over="isDragOver"
      :drop-position="currentDropPosition"
      :markers="markers"
      :marker-placement-mode="markerPlacementMode"
      :is-dark-mode="isDarkMode"
      :waveform-height="waveformHeight"
      :regions="regions"
      :is-edit-mode="isEditMode && !signal.isDerived"
      :edit-tool="editTool"
      :effective-points="effectivePoints"
      :is-modified="isModified"
      :is-selection-dragging="isSelectionDragging"
      :selection-drag-start-x="selectionDragStartX"
      :selection-drag-current-x="selectionDragCurrentX"
      :selection-drag-signals="selectionDragSignals"
      :viewport-bounds="viewportBounds"
      :scroll-left="scrollLeft"
      @update:points="handleSignalUpdatePoints"
      @select="handleSignalSelect"
      @rename="handleSignalRename"
      @delete="handleSignalDelete"
      @contextmenu="handleSignalContextMenu"
      @dragstart="handleSignalDragStart"
      @dragend="emit('dragend')"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @place-marker="(x) => emit('place-marker', x)"
      @selection-start="(startX) => emit('selection-start', startX, signal.id)"
      @selection-move="(currentX) => emit('selection-move', currentX, signal.id)"
      @selection-end="(endX) => emit('selection-end', endX)"
    />

    <!-- Vector signal -->
    <VectorSignalRow
      v-else
      :signal="signal"
      :grid-config="gridConfig"
      :is-selected="selectedSignalId === signal.id"
      :depth="depth"
      :is-drag-over="isDragOver"
      :drop-position="currentDropPosition"
      :markers="markers"
      :marker-placement-mode="markerPlacementMode"
      :is-dark-mode="isDarkMode"
      :waveform-height="waveformHeight"
      :regions="regions"
      :is-edit-mode="isEditMode && !signal.isDerived"
      :edit-tool="editTool"
      :effective-points="effectivePoints"
      :is-modified="isModified"
      :is-selection-dragging="isSelectionDragging"
      :selection-drag-start-x="selectionDragStartX"
      :selection-drag-current-x="selectionDragCurrentX"
      :selection-drag-signals="selectionDragSignals"
      :viewport-bounds="viewportBounds"
      :scroll-left="scrollLeft"
      @update:points="handleSignalUpdatePoints"
      @select="handleSignalSelect"
      @rename="handleSignalRename"
      @delete="handleSignalDelete"
      @update:displayFormat="handleSignalDisplayFormat"
      @contextmenu="handleSignalContextMenu"
      @dragstart="handleSignalDragStart"
      @dragend="emit('dragend')"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @place-marker="(x) => emit('place-marker', x)"
      @selection-start="(startX) => emit('selection-start', startX, signal.id)"
      @selection-move="(currentX) => emit('selection-move', currentX, signal.id)"
      @selection-end="(endX) => emit('selection-end', endX)"
    />
  </template>
</template>
