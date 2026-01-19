<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNode, Signal } from '../types/waveform';
import SignalBrowserNode from './SignalBrowserNode.vue';

const props = withDefaults(defineProps<{
  availableSignals: Signal[];
  availableTree: TreeNode[];
  displayedSignals: Signal[];
  expanded: boolean;
  filter: string;
  isDarkMode?: boolean;
}>(), {
  isDarkMode: false,
});

const emit = defineEmits<{
  (e: 'update:expanded', value: boolean): void;
  (e: 'update:filter', value: string): void;
  (e: 'toggle-signal', signalId: string): void;
  (e: 'add-all'): void;
  (e: 'remove-all'): void;
  (e: 'add-all-in-group', groupId: string): void;
  (e: 'clear-available'): void;
}>();

// Create a set of displayed signal IDs for efficient lookup
const displayedSignalIds = computed(() => {
  return new Set(props.displayedSignals.map(s => s.id));
});

// Count displayed signals from available pool
const displayedFromAvailableCount = computed(() => {
  const availableIds = new Set(props.availableSignals.map(s => s.id));
  return props.displayedSignals.filter(s => availableIds.has(s.id)).length;
});

function handleAddAllInGroup(groupId: string) {
  emit('add-all-in-group', groupId);
}

function toggleExpanded() {
  emit('update:expanded', !props.expanded);
}

function handleFilterInput(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('update:filter', target.value);
}

function clearFilter() {
  emit('update:filter', '');
}
</script>

<template>
  <div v-if="availableSignals.length > 0" class="signal-browser" :class="{ 'dark-mode': isDarkMode }">
    <!-- Header -->
    <div class="browser-header" @click="toggleExpanded">
      <span class="expand-icon">{{ expanded ? '&#9660;' : '&#9654;' }}</span>
      <span class="header-title">
        Available Signals
        <span class="signal-count">
          ({{ displayedFromAvailableCount }}/{{ availableSignals.length }} displayed)
        </span>
      </span>
      <div class="header-actions" @click.stop>
        <button
          class="btn-browser btn-add-all"
          @click="emit('add-all')"
          title="Add all signals to viewer"
        >
          + Add All
        </button>
        <button
          class="btn-browser btn-remove-all"
          @click="emit('remove-all')"
          title="Remove all VCD signals from viewer"
          :disabled="displayedFromAvailableCount === 0"
        >
          - Remove All
        </button>
        <button
          class="btn-browser btn-clear"
          @click="emit('clear-available')"
          title="Clear available signals (close VCD)"
        >
          &#10005;
        </button>
      </div>
    </div>

    <!-- Content (when expanded) -->
    <div v-if="expanded" class="browser-content">
      <!-- Search/Filter -->
      <div class="filter-row">
        <input
          type="text"
          :value="filter"
          @input="handleFilterInput"
          placeholder="Filter signals..."
          class="filter-input"
        />
        <button
          v-if="filter"
          class="btn-clear-filter"
          @click="clearFilter"
          title="Clear filter"
        >
          &#10005;
        </button>
      </div>

      <!-- Signal Tree -->
      <div class="signal-tree">
        <SignalBrowserNode
          v-for="node in availableTree"
          :key="node.id"
          :node="node"
          :signals="availableSignals"
          :displayed-signal-ids="displayedSignalIds"
          :depth="0"
          :filter="filter"
          :is-dark-mode="isDarkMode"
          @toggle-signal="(id) => emit('toggle-signal', id)"
          @add-all-in-group="handleAddAllInGroup"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.signal-browser {
  margin-bottom: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
  overflow: hidden;
}

.browser-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #e3f2fd;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #bbdefb;
}

.browser-header:hover {
  background: #bbdefb;
}

.expand-icon {
  font-size: 10px;
  color: #1976D2;
}

.header-title {
  font-weight: 600;
  color: #1565C0;
  flex: 1;
}

.signal-count {
  font-weight: normal;
  color: #666;
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-browser {
  padding: 4px 10px;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.btn-add-all {
  background: #4CAF50;
  color: white;
}

.btn-add-all:hover {
  background: #388E3C;
}

.btn-remove-all {
  background: #ff9800;
  color: white;
}

.btn-remove-all:hover:not(:disabled) {
  background: #f57c00;
}

.btn-remove-all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-clear {
  background: #f44336;
  color: white;
  padding: 4px 8px;
}

.btn-clear:hover {
  background: #d32f2f;
}

.browser-content {
  max-height: 300px;
  overflow-y: auto;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #eee;
}

.filter-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
}

.filter-input:focus {
  outline: none;
  border-color: #2196F3;
  box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
}

.btn-clear-filter {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
}

.btn-clear-filter:hover {
  color: #f44336;
}

.signal-tree {
  padding: 8px 4px;
  background: #fff;
}

/* Dark mode styles */
.signal-browser.dark-mode {
  background: #1e1e2e;
  border-color: #444;
}

.signal-browser.dark-mode .browser-header {
  background: #1a237e;
  border-bottom-color: #303f9f;
}

.signal-browser.dark-mode .browser-header:hover {
  background: #283593;
}

.signal-browser.dark-mode .expand-icon {
  color: #90caf9;
}

.signal-browser.dark-mode .header-title {
  color: #90caf9;
}

.signal-browser.dark-mode .signal-count {
  color: #888;
}

.signal-browser.dark-mode .browser-content {
  background: #1e1e2e;
}

.signal-browser.dark-mode .filter-row {
  background: #2a2a3e;
  border-bottom-color: #444;
}

.signal-browser.dark-mode .filter-input {
  background: #1e1e2e;
  border-color: #444;
  color: #e0e0e0;
}

.signal-browser.dark-mode .filter-input:focus {
  border-color: #64B5F6;
  box-shadow: 0 0 0 2px rgba(100, 181, 246, 0.2);
}

.signal-browser.dark-mode .filter-input::placeholder {
  color: #666;
}

.signal-browser.dark-mode .btn-clear-filter {
  color: #666;
}

.signal-browser.dark-mode .btn-clear-filter:hover {
  color: #ef9a9a;
}

.signal-browser.dark-mode .signal-tree {
  background: #1e1e2e;
}
</style>
