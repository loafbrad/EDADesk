<script setup lang="ts">
import { ref, computed } from 'vue';
import type { SignalGroup } from '../types/waveform';
import type { SieveState } from '../composables/useSieve';

const props = defineProps<{
  group: SignalGroup;
  depth: number;
  childCount: number;
  isDragOver?: boolean;
  dropPosition?: 'before' | 'after' | 'inside' | null;
  assignedSieves?: SieveState[];  // Sieves assigned to this group
  isSieveDragOver?: boolean;      // Whether a sieve is being dragged over
}>();

const emit = defineEmits<{
  (e: 'toggle-collapse'): void;
  (e: 'rename', name: string): void;
  (e: 'contextmenu', event: MouseEvent): void;
  (e: 'dragstart', groupId: string): void;
  (e: 'dragend'): void;
  (e: 'dragover', event: DragEvent): void;
  (e: 'dragleave'): void;
  (e: 'drop', event: DragEvent): void;
  (e: 'sieve-toggle', sieveId: string, enabled: boolean): void;
  (e: 'sieve-remove-from-group', sieveId: string, groupId: string): void;
  (e: 'sieve-drop', sieveId: string, groupId: string): void;
}>();

const isEditing = ref(false);
const editName = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

const indentStyle = computed(() => ({
  paddingLeft: `${props.depth * 20 + 8}px`,
}));

const borderStyle = computed(() => ({
  borderLeftColor: props.group.color,
}));

function startEditing() {
  editName.value = props.group.name;
  isEditing.value = true;
  setTimeout(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  }, 0);
}

function finishEditing() {
  const trimmedName = editName.value.trim();
  if (trimmedName && trimmedName !== props.group.name) {
    emit('rename', trimmedName);
  }
  isEditing.value = false;
}

function cancelEditing() {
  isEditing.value = false;
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    finishEditing();
  } else if (e.key === 'Escape') {
    cancelEditing();
  }
}

function handleDragStart(e: DragEvent) {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', props.group.id);
    e.dataTransfer.setData('application/x-tree-node', JSON.stringify({
      type: 'group',
      id: props.group.id,
    }));
  }
  emit('dragstart', props.group.id);
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault();
  emit('contextmenu', e);
}

function handleDrop(e: DragEvent) {
  // Check if this is a sieve drop
  const sieveData = e.dataTransfer?.getData('application/x-sieve');
  if (sieveData) {
    try {
      const { id: sieveId } = JSON.parse(sieveData);
      // Stop propagation to prevent parent groups from also receiving the drop
      e.stopPropagation();
      emit('sieve-drop', sieveId, props.group.id);
      return;
    } catch {
      // Not a valid sieve drop, continue with normal drop
    }
  }
  emit('drop', e);
}

</script>

<template>
  <div
    class="signal-group-header"
    :class="{
      'drag-over': isDragOver,
      'drop-before': dropPosition === 'before',
      'drop-after': dropPosition === 'after',
      'drop-inside': dropPosition === 'inside',
      'sieve-drag-over': isSieveDragOver,
    }"
    :style="{ ...indentStyle, ...borderStyle }"
    draggable="true"
    @dragstart="handleDragStart"
    @dragend="emit('dragend')"
    @dragover.prevent="emit('dragover', $event)"
    @dragleave="emit('dragleave')"
    @drop.prevent="handleDrop"
    @contextmenu="handleContextMenu"
  >
    <div class="group-main-row">
      <span class="drag-handle" title="Drag to reorder">&#9776;</span>

      <button
        class="collapse-btn"
        @click="emit('toggle-collapse')"
        :title="group.isCollapsed ? 'Expand' : 'Collapse'"
      >
        {{ group.isCollapsed ? '▶' : '▼' }}
      </button>

      <span class="group-icon" :style="{ color: group.color }">&#128193;</span>

      <span
        v-if="!isEditing"
        class="group-name"
        @dblclick="startEditing"
        title="Double-click to rename"
      >
        {{ group.name }}
      </span>
      <input
        v-else
        ref="inputRef"
        v-model="editName"
        class="name-input"
        @blur="finishEditing"
        @keydown="handleKeydown"
      />

      <span class="child-count" :title="`${childCount} item(s)`">
        ({{ childCount }})
      </span>
    </div>

    <!-- Assigned Sieves -->
    <div v-if="assignedSieves && assignedSieves.length > 0" class="assigned-sieves">
      <div
        v-for="sieve in assignedSieves"
        :key="sieve.id"
        class="sieve-badge"
        :class="{ disabled: !sieve.enabled, 'has-error': sieve.error }"
      >
        <label class="sieve-checkbox">
          <input
            type="checkbox"
            :checked="sieve.enabled"
            @change="emit('sieve-toggle', sieve.id, ($event.target as HTMLInputElement).checked)"
            @click.stop
          />
          <span class="sieve-icon">&#128269;</span>
          <span class="sieve-name">{{ sieve.name }}</span>
        </label>
        <span v-if="sieve.enabled && !sieve.error" class="sieve-txn-count">
          ({{ sieve.transactions.length }} txn)
        </span>
        <span v-if="sieve.error" class="sieve-error-indicator" title="Sieve has error">!</span>
        <button
          class="sieve-remove-btn"
          @click.stop="emit('sieve-remove-from-group', sieve.id, group.id)"
          title="Remove sieve from group"
        >×</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.signal-group-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: #2a2a3e;
  border-left: 3px solid;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s;
  position: relative;
}

.group-main-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.signal-group-header:hover {
  background: #333348;
}

.signal-group-header.drag-over {
  background: #3a3a5e;
}

.signal-group-header.drop-before::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: #42a5f5;
}

.signal-group-header.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: #42a5f5;
}

.signal-group-header.drop-inside {
  outline: 2px dashed #42a5f5;
  outline-offset: -2px;
}

.drag-handle {
  cursor: grab;
  opacity: 0.5;
  font-size: 14px;
}

.drag-handle:hover {
  opacity: 1;
}

.collapse-btn {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 10px;
  line-height: 1;
}

.collapse-btn:hover {
  color: #fff;
}

.group-icon {
  font-size: 14px;
}

.group-name {
  flex: 1;
  font-weight: 500;
  color: #e0e0e0;
  cursor: text;
}

.name-input {
  flex: 1;
  background: #1a1a2e;
  border: 1px solid #42a5f5;
  color: #e0e0e0;
  padding: 2px 6px;
  font-size: inherit;
  font-family: inherit;
  border-radius: 3px;
}

.name-input:focus {
  outline: none;
}

.child-count {
  font-size: 12px;
  color: #888;
}

/* Sieve drag-over highlight */
.signal-group-header.sieve-drag-over {
  outline: 2px dashed #4CAF50;
  outline-offset: -2px;
  background: #2e3d2e;
}

/* Assigned sieves section */
.assigned-sieves {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 56px; /* Align with group name */
  margin-top: 2px;
}

.sieve-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: rgba(76, 175, 80, 0.2);
  border: 1px solid rgba(76, 175, 80, 0.4);
  border-radius: 4px;
  font-size: 11px;
}

.sieve-badge.disabled {
  opacity: 0.5;
  background: rgba(128, 128, 128, 0.2);
  border-color: rgba(128, 128, 128, 0.4);
}

.sieve-badge.has-error {
  background: rgba(244, 67, 54, 0.2);
  border-color: rgba(244, 67, 54, 0.4);
}

.sieve-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.sieve-checkbox input {
  cursor: pointer;
  margin: 0;
}

.sieve-icon {
  font-size: 10px;
}

.sieve-name {
  color: #a5d6a7;
  font-family: monospace;
  font-size: 11px;
}

.sieve-badge.disabled .sieve-name {
  color: #888;
}

.sieve-txn-count {
  color: #888;
  font-size: 10px;
}

.sieve-error-indicator {
  color: #ef5350;
  font-weight: bold;
}

.sieve-remove-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
}

.sieve-remove-btn:hover {
  color: #ef5350;
}
</style>
