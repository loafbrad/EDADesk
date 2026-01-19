import { ref, computed, type Ref } from 'vue';
import type { Signal, TreeNode, SignalReference, SignalGroup } from '../types/waveform';
import { isSignalReference, isSignalGroup } from '../types/waveform';

const groupColors = [
  '#5C6BC0', // Indigo
  '#26A69A', // Teal
  '#FF7043', // Deep Orange
  '#AB47BC', // Purple
  '#42A5F5', // Blue
  '#66BB6A', // Green
  '#FFA726', // Orange
  '#EC407A', // Pink
];

function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function useSignalTree(signals: Ref<Signal[]>) {
  const tree = ref<TreeNode[]>([]);

  // Initialize tree from signals (each signal becomes a root-level reference)
  function initializeTree() {
    tree.value = signals.value.map(signal => ({
      type: 'signal' as const,
      id: generateNodeId(),
      signalId: signal.id,
    }));
  }

  // Get all groups in the tree (flattened)
  const allGroups = computed(() => {
    const groups: SignalGroup[] = [];
    function collectGroups(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (isSignalGroup(node)) {
          groups.push(node);
          collectGroups(node.children);
        }
      }
    }
    collectGroups(tree.value);
    return groups;
  });

  // Find a node by ID in the tree
  function findNode(nodeId: string, nodes: TreeNode[] = tree.value): TreeNode | null {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      if (isSignalGroup(node)) {
        const found = findNode(nodeId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Find parent of a node
  function findParent(nodeId: string, nodes: TreeNode[] = tree.value, parent: SignalGroup | null = null): SignalGroup | null {
    for (const node of nodes) {
      if (node.id === nodeId) return parent;
      if (isSignalGroup(node)) {
        const found = findParent(nodeId, node.children, node);
        if (found !== undefined) return found;
      }
    }
    return null;
  }

  // Find parent array containing the node
  function findParentArray(nodeId: string, nodes: TreeNode[] = tree.value): TreeNode[] | null {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      if (node.id === nodeId) return nodes;
      if (isSignalGroup(node)) {
        const found = findParentArray(nodeId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Remove a node from the tree
  function removeNode(nodeId: string, nodes: TreeNode[] = tree.value): boolean {
    const index = nodes.findIndex(n => n.id === nodeId);
    if (index !== -1) {
      nodes.splice(index, 1);
      return true;
    }
    for (const node of nodes) {
      if (isSignalGroup(node)) {
        if (removeNode(nodeId, node.children)) return true;
      }
    }
    return false;
  }

  // Create a new group
  function createGroup(name: string = 'New Group'): SignalGroup {
    const colorIndex = allGroups.value.length % groupColors.length;
    return {
      type: 'group',
      id: generateGroupId(),
      name,
      color: groupColors[colorIndex] ?? '#5C6BC0',
      isCollapsed: false,
      children: [],
    };
  }

  // Add an empty group at root level
  function addGroup(name: string = 'New Group'): SignalGroup {
    const group = createGroup(name);
    tree.value.push(group);
    return group;
  }

  // Create a group from selected signal IDs
  function createGroupFromSignals(signalIds: string[], groupName: string = 'New Group'): SignalGroup | null {
    if (signalIds.length === 0) return null;

    const group = createGroup(groupName);

    // Find and move signal references to the new group
    const nodesToMove: TreeNode[] = [];

    function findSignalNodes(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (isSignalReference(node) && signalIds.includes(node.signalId)) {
          nodesToMove.push(node);
        } else if (isSignalGroup(node)) {
          findSignalNodes(node.children);
        }
      }
    }
    findSignalNodes(tree.value);

    // Remove nodes from their current locations
    for (const node of nodesToMove) {
      removeNode(node.id);
    }

    // Add nodes to the new group
    group.children = nodesToMove;

    // Add group to root
    tree.value.push(group);

    return group;
  }

  // Add a subgroup to an existing group
  function addSubgroup(parentGroupId: string, name: string = 'Subgroup'): SignalGroup | null {
    const parent = findNode(parentGroupId);
    if (!parent || !isSignalGroup(parent)) return null;

    const subgroup = createGroup(name);
    parent.children.push(subgroup);
    return subgroup;
  }

  // Toggle collapse state of a group
  function toggleCollapse(groupId: string) {
    const group = findNode(groupId);
    if (group && isSignalGroup(group)) {
      group.isCollapsed = !group.isCollapsed;
    }
  }

  // Rename a group
  function renameGroup(groupId: string, newName: string) {
    const group = findNode(groupId);
    if (group && isSignalGroup(group)) {
      group.name = newName;
    }
  }

  // Move a node to a new position
  function moveNode(
    sourceId: string,
    targetId: string | null,
    position: 'before' | 'after' | 'inside'
  ) {
    const sourceNode = findNode(sourceId);
    if (!sourceNode) return;

    // Prevent moving a group into itself or its descendants
    if (isSignalGroup(sourceNode) && targetId) {
      function isDescendant(groupId: string, checkId: string): boolean {
        const group = findNode(groupId);
        if (!group || !isSignalGroup(group)) return false;
        for (const child of group.children) {
          if (child.id === checkId) return true;
          if (isSignalGroup(child) && isDescendant(child.id, checkId)) return true;
        }
        return false;
      }
      if (targetId === sourceId || isDescendant(sourceId, targetId)) return;
    }

    // Remove from current location
    removeNode(sourceId);

    if (targetId === null) {
      // Move to root
      tree.value.push(sourceNode);
      return;
    }

    const targetNode = findNode(targetId);
    if (!targetNode) {
      tree.value.push(sourceNode);
      return;
    }

    if (position === 'inside' && isSignalGroup(targetNode)) {
      // Move inside a group
      targetNode.children.push(sourceNode);
    } else {
      // Move before or after
      const parentArray = findParentArray(targetId);
      if (!parentArray) return;

      const targetIndex = parentArray.findIndex(n => n.id === targetId);
      const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
      parentArray.splice(insertIndex, 0, sourceNode);
    }
  }

  // Move a node to root level
  function moveToRoot(nodeId: string) {
    moveNode(nodeId, null, 'after');
  }

  // Move a node inside a group
  function moveToGroup(nodeId: string, groupId: string) {
    moveNode(nodeId, groupId, 'inside');
  }

  // Ungroup: move all children to parent level and remove the group
  function ungroup(groupId: string) {
    const group = findNode(groupId);
    if (!group || !isSignalGroup(group)) return;

    const parentArray = findParentArray(groupId);
    if (!parentArray) return;

    const groupIndex = parentArray.findIndex(n => n.id === groupId);

    // Insert children at the group's position
    parentArray.splice(groupIndex, 1, ...group.children);
  }

  // Delete a group but keep its children (move to parent)
  function deleteGroupKeepChildren(groupId: string) {
    ungroup(groupId);
  }

  // Delete a group and all its signal references
  function deleteGroupAndSignals(groupId: string): string[] {
    const deletedSignalIds: string[] = [];
    const group = findNode(groupId);

    if (group && isSignalGroup(group)) {
      function collectSignalIds(nodes: TreeNode[]) {
        for (const node of nodes) {
          if (isSignalReference(node)) {
            deletedSignalIds.push(node.signalId);
          } else if (isSignalGroup(node)) {
            collectSignalIds(node.children);
          }
        }
      }
      collectSignalIds(group.children);
    }

    removeNode(groupId);
    return deletedSignalIds;
  }

  // Add a signal reference to the tree (at root or inside a group)
  function addSignalReference(signalId: string, targetGroupId?: string): SignalReference {
    const ref: SignalReference = {
      type: 'signal',
      id: generateNodeId(),
      signalId,
    };

    if (targetGroupId) {
      const group = findNode(targetGroupId);
      if (group && isSignalGroup(group)) {
        group.children.push(ref);
        return ref;
      }
    }

    tree.value.push(ref);
    return ref;
  }

  // Remove a signal reference by signal ID
  function removeSignalReference(signalId: string): boolean {
    function remove(nodes: TreeNode[]): boolean {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node) continue;
        if (isSignalReference(node) && node.signalId === signalId) {
          nodes.splice(i, 1);
          return true;
        }
        if (isSignalGroup(node)) {
          if (remove(node.children)) return true;
        }
      }
      return false;
    }
    return remove(tree.value);
  }

  // Get the depth of a node in the tree
  function getNodeDepth(nodeId: string, nodes: TreeNode[] = tree.value, depth: number = 0): number {
    for (const node of nodes) {
      if (node.id === nodeId) return depth;
      if (isSignalGroup(node)) {
        const foundDepth = getNodeDepth(nodeId, node.children, depth + 1);
        if (foundDepth !== -1) return foundDepth;
      }
    }
    return -1;
  }

  // Get flattened list of visible nodes (respecting collapse state)
  function getVisibleNodes(): Array<{ node: TreeNode; depth: number }> {
    const result: Array<{ node: TreeNode; depth: number }> = [];

    function traverse(nodes: TreeNode[], depth: number) {
      for (const node of nodes) {
        result.push({ node, depth });
        if (isSignalGroup(node) && !node.isCollapsed) {
          traverse(node.children, depth + 1);
        }
      }
    }

    traverse(tree.value, 0);
    return result;
  }

  // Count children (including nested) in a group
  function countGroupChildren(groupId: string): number {
    const group = findNode(groupId);
    if (!group || !isSignalGroup(group)) return 0;

    function count(nodes: TreeNode[]): number {
      let total = 0;
      for (const node of nodes) {
        total++;
        if (isSignalGroup(node)) {
          total += count(node.children);
        }
      }
      return total;
    }

    return count(group.children);
  }

  // Get signal count in a group (only direct signal references)
  function countGroupSignals(groupId: string): number {
    const group = findNode(groupId);
    if (!group || !isSignalGroup(group)) return 0;

    function count(nodes: TreeNode[]): number {
      let total = 0;
      for (const node of nodes) {
        if (isSignalReference(node)) {
          total++;
        } else if (isSignalGroup(node)) {
          total += count(node.children);
        }
      }
      return total;
    }

    return count(group.children);
  }

  return {
    tree,
    allGroups,
    initializeTree,
    findNode,
    findParent,
    createGroup,
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
    deleteGroupAndSignals,
    addSignalReference,
    removeSignalReference,
    getNodeDepth,
    getVisibleNodes,
    countGroupChildren,
    countGroupSignals,
  };
}
