<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

export interface MenuItem {
  label: string;
  action?: () => void;
  divider?: boolean;
  submenu?: MenuItem[];
  disabled?: boolean;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const activeSubmenuIndex = ref<number | null>(null);
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);

// Adjust menu position to stay within viewport
watch(() => [props.visible, props.x, props.y], async () => {
  if (props.visible) {
    // First set to the click position
    adjustedX.value = props.x;
    adjustedY.value = props.y;

    // Wait for the DOM to update so we can measure the menu
    await nextTick();

    if (menuRef.value) {
      const rect = menuRef.value.getBoundingClientRect();
      const padding = 10;

      // Adjust if menu would go off the right edge
      if (props.x + rect.width + padding > window.innerWidth) {
        adjustedX.value = Math.max(padding, window.innerWidth - rect.width - padding);
      }

      // Adjust if menu would go off the bottom edge
      if (props.y + rect.height + padding > window.innerHeight) {
        adjustedY.value = Math.max(padding, window.innerHeight - rect.height - padding);
      }
    }
  }
}, { immediate: true });

function handleItemClick(item: MenuItem) {
  if (item.disabled || item.divider) return;
  if (item.action) {
    item.action();
    emit('close');
  }
}

function handleMouseEnter(index: number, item: MenuItem) {
  if (item.submenu) {
    activeSubmenuIndex.value = index;
  } else {
    activeSubmenuIndex.value = null;
  }
}

function handleSubmenuItemClick(subItem: MenuItem) {
  if (subItem.disabled || subItem.divider) return;
  if (subItem.action) {
    subItem.action();
    emit('close');
  }
}

function handleClickOutside(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close');
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      :style="{ left: `${adjustedX}px`, top: `${adjustedY}px` }"
    >
      <template v-for="(item, index) in items" :key="index">
        <div v-if="item.divider" class="divider" />
        <div
          v-else
          class="menu-item"
          :class="{ disabled: item.disabled, 'has-submenu': item.submenu }"
          @click="handleItemClick(item)"
          @mouseenter="handleMouseEnter(index, item)"
        >
          <span class="label">{{ item.label }}</span>
          <span v-if="item.submenu" class="arrow">▶</span>

          <!-- Submenu -->
          <div
            v-if="item.submenu && activeSubmenuIndex === index"
            class="submenu"
          >
            <template v-for="(subItem, subIndex) in item.submenu" :key="subIndex">
              <div v-if="subItem.divider" class="divider" />
              <div
                v-else
                class="menu-item"
                :class="{ disabled: subItem.disabled }"
                @click.stop="handleSubmenuItemClick(subItem)"
              >
                <span class="label">{{ subItem.label }}</span>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  padding: 4px 0;
  font-size: 13px;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  color: #e0e0e0;
  position: relative;
  transition: background-color 0.1s;
}

.menu-item:hover {
  background: #3a3a5e;
}

.menu-item.disabled {
  color: #666;
  cursor: not-allowed;
}

.menu-item.disabled:hover {
  background: transparent;
}

.label {
  flex: 1;
}

.arrow {
  font-size: 10px;
  margin-left: 8px;
  color: #888;
}

.divider {
  height: 1px;
  background: #444;
  margin: 4px 8px;
}

.submenu {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 160px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  padding: 4px 0;
}

.submenu .menu-item {
  padding: 6px 12px;
}

.has-submenu {
  /* Ensure submenu indicator is visible */
}
</style>
