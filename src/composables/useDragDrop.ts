import { ref } from 'vue';

export type DropPosition = 'before' | 'after' | 'inside' | null;

export interface DragState {
  isDragging: boolean;
  draggedNodeId: string | null;
  draggedNodeType: 'signal' | 'group' | 'sieve' | null;
  dragOverNodeId: string | null;
  dropPosition: DropPosition;
}

export function useDragDrop() {
  const state = ref<DragState>({
    isDragging: false,
    draggedNodeId: null,
    draggedNodeType: null,
    dragOverNodeId: null,
    dropPosition: null,
  });

  function startDrag(nodeId: string, nodeType: 'signal' | 'group' | 'sieve') {
    state.value.isDragging = true;
    state.value.draggedNodeId = nodeId;
    state.value.draggedNodeType = nodeType;
  }

  function endDrag() {
    state.value.isDragging = false;
    state.value.draggedNodeId = null;
    state.value.draggedNodeType = null;
    state.value.dragOverNodeId = null;
    state.value.dropPosition = null;
  }

  function calculateDropPosition(
    event: DragEvent,
    targetElement: HTMLElement,
    targetIsGroup: boolean
  ): DropPosition {
    const rect = targetElement.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const height = rect.height;

    // For groups, allow dropping inside (middle zone)
    if (targetIsGroup) {
      const topZone = height * 0.25;
      const bottomZone = height * 0.75;

      if (y < topZone) {
        return 'before';
      } else if (y > bottomZone) {
        return 'after';
      } else {
        return 'inside';
      }
    }

    // For signals, only before/after
    return y < height / 2 ? 'before' : 'after';
  }

  function handleDragOver(
    event: DragEvent,
    targetNodeId: string,
    targetIsGroup: boolean
  ) {
    // Don't allow dropping on itself
    if (targetNodeId === state.value.draggedNodeId) {
      state.value.dragOverNodeId = null;
      state.value.dropPosition = null;
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const position = calculateDropPosition(event, target, targetIsGroup);

    state.value.dragOverNodeId = targetNodeId;
    state.value.dropPosition = position;
  }

  function handleDragLeave(targetNodeId: string) {
    if (state.value.dragOverNodeId === targetNodeId) {
      state.value.dragOverNodeId = null;
      state.value.dropPosition = null;
    }
  }

  function getDropInfo(): { targetId: string; position: DropPosition } | null {
    if (!state.value.draggedNodeId || !state.value.dragOverNodeId) {
      return null;
    }

    return {
      targetId: state.value.dragOverNodeId,
      position: state.value.dropPosition,
    };
  }

  return {
    state,
    startDrag,
    endDrag,
    handleDragOver,
    handleDragLeave,
    getDropInfo,
  };
}
