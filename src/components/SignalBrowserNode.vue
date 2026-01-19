<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNode, Signal } from '../types/waveform';
import { isSignalReference, isSignalGroup } from '../types/waveform';

const props = withDefaults(defineProps<{
  node: TreeNode;
  signals: Signal[];
  displayedSignalIds: Set<string>;
  depth: number;
  filter: string;
  isDarkMode?: boolean;
}>(), {
  isDarkMode: false,
});

const emit = defineEmits<{
  (e: 'toggle-signal', signalId: string): void;
  (e: 'add-all-in-group', groupId: string): void;
}>();

// Get the signal data for a signal reference
const signal = computed(() => {
  const node = props.node;
  if (isSignalReference(node)) {
    return props.signals.find(s => s.id === node.signalId);
  }
  return null;
});

// Check if the signal is currently displayed
const isDisplayed = computed(() => {
  if (signal.value) {
    return props.displayedSignalIds.has(signal.value.id);
  }
  return false;
});

// Check if this node matches the filter
const matchesFilter = computed(() => {
  if (!props.filter) return true;
  const filterLower = props.filter.toLowerCase();

  if (isSignalReference(props.node) && signal.value) {
    return signal.value.name.toLowerCase().includes(filterLower);
  }

  if (isSignalGroup(props.node)) {
    // Group matches if its name matches or any child matches
    if (props.node.name.toLowerCase().includes(filterLower)) return true;
    return hasMatchingChildren(props.node.children, filterLower);
  }

  return false;
});

function hasMatchingChildren(nodes: TreeNode[], filter: string): boolean {
  for (const node of nodes) {
    if (isSignalReference(node)) {
      const sig = props.signals.find(s => s.id === node.signalId);
      if (sig && sig.name.toLowerCase().includes(filter)) return true;
    } else if (isSignalGroup(node)) {
      if (node.name.toLowerCase().includes(filter)) return true;
      if (hasMatchingChildren(node.children, filter)) return true;
    }
  }
  return false;
}

// Get child count for groups
const childCount = computed(() => {
  if (isSignalGroup(props.node)) {
    return countSignals(props.node.children);
  }
  return 0;
});

function countSignals(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (isSignalReference(node)) {
      count++;
    } else if (isSignalGroup(node)) {
      count += countSignals(node.children);
    }
  }
  return count;
}

// Check if group is expanded (stored locally for the browser)
const isExpanded = computed(() => {
  if (isSignalGroup(props.node)) {
    return !props.node.isCollapsed;
  }
  return false;
});

// Get signal width description
function getWidthLabel(width: number): string {
  if (width === 1) return '1-bit';
  return `${width}-bit`;
}

function handleToggle() {
  if (signal.value) {
    emit('toggle-signal', signal.value.id);
  }
}

function handleAddAllInGroup() {
  if (isSignalGroup(props.node)) {
    emit('add-all-in-group', props.node.id);
  }
}
</script>

<template>
  <div v-if="matchesFilter" class="browser-node" :class="{ 'dark-mode': isDarkMode }" :style="{ paddingLeft: `${depth * 16}px` }">
    <!-- Group Node -->
    <template v-if="isSignalGroup(node)">
      <div class="group-row">
        <span class="expand-icon">{{ isExpanded ? '&#9660;' : '&#9654;' }}</span>
        <span class="group-icon">&#128193;</span>
        <span class="group-name">{{ node.name }}</span>
        <span class="group-count">({{ childCount }})</span>
        <button
          class="btn-add-group"
          @click.stop="handleAddAllInGroup"
          title="Add all signals in this group"
        >
          + Add All
        </button>
      </div>

      <!-- Render children if expanded -->
      <template v-if="isExpanded">
        <SignalBrowserNode
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :signals="signals"
          :displayed-signal-ids="displayedSignalIds"
          :depth="depth + 1"
          :filter="filter"
          :is-dark-mode="isDarkMode"
          @toggle-signal="(id) => emit('toggle-signal', id)"
          @add-all-in-group="(id) => emit('add-all-in-group', id)"
        />
      </template>
    </template>

    <!-- Signal Reference Node -->
    <template v-else-if="isSignalReference(node) && signal">
      <div
        class="signal-row"
        :class="{ displayed: isDisplayed }"
        @click="handleToggle"
      >
        <span class="signal-checkbox">
          {{ isDisplayed ? '&#9745;' : '&#9744;' }}
        </span>
        <span class="signal-name">{{ signal.name }}</span>
        <span class="signal-width">{{ getWidthLabel(signal.width) }}</span>
        <span class="signal-points">({{ signal.points.length }} pts)</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.browser-node {
  font-size: 13px;
  user-select: none;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
}

.group-row:hover {
  background: rgba(0, 0, 0, 0.05);
}

.expand-icon {
  font-size: 10px;
  width: 12px;
  color: #666;
}

.group-icon {
  font-size: 14px;
}

.group-name {
  font-weight: 500;
  color: #5C6BC0;
}

.group-count {
  color: #888;
  font-size: 11px;
}

.btn-add-group {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 11px;
  background: #e8f5e9;
  border: 1px solid #c8e6c9;
  border-radius: 3px;
  cursor: pointer;
  color: #2e7d32;
}

.btn-add-group:hover {
  background: #c8e6c9;
}

.signal-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.15s;
}

.signal-row:hover {
  background: rgba(33, 150, 243, 0.1);
}

.signal-row.displayed {
  background: rgba(76, 175, 80, 0.15);
}

.signal-row.displayed:hover {
  background: rgba(76, 175, 80, 0.25);
}

.signal-checkbox {
  font-size: 16px;
  color: #666;
}

.signal-row.displayed .signal-checkbox {
  color: #4CAF50;
}

.signal-name {
  font-family: monospace;
  color: #333;
}

.signal-width {
  color: #888;
  font-size: 11px;
  padding: 1px 4px;
  background: #f0f0f0;
  border-radius: 3px;
}

.signal-points {
  color: #aaa;
  font-size: 11px;
  margin-left: auto;
}

/* Dark mode styles */
.browser-node.dark-mode .group-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.browser-node.dark-mode .expand-icon {
  color: #888;
}

.browser-node.dark-mode .group-name {
  color: #9fa8da;
}

.browser-node.dark-mode .group-count {
  color: #666;
}

.browser-node.dark-mode .btn-add-group {
  background: #1b3a1e;
  border-color: #2e5a32;
  color: #81c784;
}

.browser-node.dark-mode .btn-add-group:hover {
  background: #2e5a32;
}

.browser-node.dark-mode .signal-row:hover {
  background: rgba(33, 150, 243, 0.15);
}

.browser-node.dark-mode .signal-row.displayed {
  background: rgba(76, 175, 80, 0.2);
}

.browser-node.dark-mode .signal-row.displayed:hover {
  background: rgba(76, 175, 80, 0.3);
}

.browser-node.dark-mode .signal-checkbox {
  color: #888;
}

.browser-node.dark-mode .signal-row.displayed .signal-checkbox {
  color: #81c784;
}

.browser-node.dark-mode .signal-name {
  color: #e0e0e0;
}

.browser-node.dark-mode .signal-width {
  background: #2a2a3e;
  color: #aaa;
}

.browser-node.dark-mode .signal-points {
  color: #666;
}
</style>
