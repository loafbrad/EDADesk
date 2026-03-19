import { ref, computed, type Ref } from 'vue';
import type { GridConfig, WavePoint } from '../types/waveform';

export interface ViewportBounds {
  startColumn: number;
  endColumn: number;
  renderOffset: number;  // Pixel offset for canvas positioning
}

export function useViewport(gridConfig: Ref<GridConfig>) {
  const scrollLeft = ref(0);
  const viewportWidth = ref(800);  // Will be updated when container is mounted

  const viewportBounds = computed<ViewportBounds>(() => {
    const buffer = 4; // Extra columns to render on each side for smooth scrolling
    const cellWidth = gridConfig.value.cellWidth;
    const columns = gridConfig.value.columns;

    // Calculate which columns are visible
    const startCol = Math.floor(scrollLeft.value / cellWidth);
    const visibleCols = Math.ceil(viewportWidth.value / cellWidth);

    // Add buffer on both sides
    const bufferedStart = Math.max(0, startCol - buffer);
    const bufferedEnd = Math.min(columns, startCol + visibleCols + buffer);

    return {
      startColumn: bufferedStart,
      endColumn: bufferedEnd,
      renderOffset: bufferedStart * cellWidth,
    };
  });

  // Calculate canvas width - just enough to cover viewport plus buffer
  const canvasWidth = computed(() => {
    const { startColumn, endColumn } = viewportBounds.value;
    return (endColumn - startColumn) * gridConfig.value.cellWidth;
  });

  // Full scrollable width (for spacer div)
  const totalWidth = computed(() => {
    return gridConfig.value.cellWidth * gridConfig.value.columns;
  });

  // Handle scroll events from the container
  function handleScroll(event: Event) {
    const target = event.target as HTMLElement;
    scrollLeft.value = target.scrollLeft;
  }

  // Update viewport width when container size changes
  function updateViewportWidth(width: number) {
    viewportWidth.value = width;
  }

  // Binary search to find first point at or after a given x position
  function findFirstPointIndex(points: WavePoint[], targetX: number): number {
    let left = 0;
    let right = points.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (points[mid]!.x < targetX) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  // Get points visible in the current viewport
  // Includes one point before startColumn to draw entering line correctly
  function getVisiblePoints(points: WavePoint[], startCol: number, endCol: number): WavePoint[] {
    if (points.length === 0) return [];

    // Sort points by x position (should already be sorted, but ensure)
    const sortedPoints = [...points].sort((a, b) => a.x - b.x);

    // Find the first point that's at or after startCol
    let startIndex = findFirstPointIndex(sortedPoints, startCol);

    // Include one point before to draw entering line
    if (startIndex > 0) {
      startIndex--;
    }

    // Find all points up to endCol
    const visiblePoints: WavePoint[] = [];
    for (let i = startIndex; i < sortedPoints.length; i++) {
      const point = sortedPoints[i]!;
      visiblePoints.push(point);

      // Stop if we're past endCol (but include this point for exiting line)
      if (point.x > endCol) {
        break;
      }
    }

    return visiblePoints;
  }

  return {
    scrollLeft,
    viewportWidth,
    viewportBounds,
    canvasWidth,
    totalWidth,
    handleScroll,
    updateViewportWidth,
    getVisiblePoints,
  };
}
