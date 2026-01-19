import { ref } from 'vue';
import type { Signal, Marker, EdgeType } from '../types/waveform';

const markerColors = [
  '#E91E63', // Pink
  '#9C27B0', // Purple
  '#3F51B5', // Indigo
  '#009688', // Teal
  '#FF5722', // Deep Orange
  '#795548', // Brown
];

let markerIdCounter = 0;

function generateMarkerId(): string {
  return `marker_${++markerIdCounter}`;
}

export function useMarkers() {
  const markers = ref<Marker[]>([]);

  // Detect edges in a signal and return time positions
  function detectEdges(signal: Signal, edgeType: EdgeType): number[] {
    const edges: number[] = [];
    const sortedPoints = [...signal.points].sort((a, b) => a.x - b.x);

    if (sortedPoints.length < 2) return edges;

    for (let i = 1; i < sortedPoints.length; i++) {
      const prevPoint = sortedPoints[i - 1];
      const currPoint = sortedPoints[i];

      if (!prevPoint || !currPoint) continue;

      const prevLevel = prevPoint.level;
      const currLevel = currPoint.level;

      if (signal.width === 1) {
        // Single-bit signal: 0/1 transitions
        const isRising = prevLevel === 0 && currLevel === 1;
        const isFalling = prevLevel === 1 && currLevel === 0;

        if (edgeType === 'rising' && isRising) {
          edges.push(currPoint.x);
        } else if (edgeType === 'falling' && isFalling) {
          edges.push(currPoint.x);
        } else if (edgeType === 'any' && (isRising || isFalling)) {
          edges.push(currPoint.x);
        }
      } else {
        // Vector signal: value changes
        const isRising = currLevel > prevLevel;
        const isFalling = currLevel < prevLevel;
        const isChanged = currLevel !== prevLevel;

        if (edgeType === 'rising' && isRising) {
          edges.push(currPoint.x);
        } else if (edgeType === 'falling' && isFalling) {
          edges.push(currPoint.x);
        } else if (edgeType === 'any' && isChanged) {
          edges.push(currPoint.x);
        }
      }
    }

    return edges;
  }

  // Create markers from edge detection
  function createMarkersFromEdges(
    signal: Signal,
    edgeType: EdgeType,
    color?: string
  ): Marker[] {
    const edges = detectEdges(signal, edgeType);
    const colorIndex = markers.value.length % markerColors.length;
    const markerColor = color ?? markerColors[colorIndex] ?? '#E91E63';

    const edgeLabel = edgeType === 'rising' ? '↑' : edgeType === 'falling' ? '↓' : '⇅';

    const newMarkers: Marker[] = edges.map(x => ({
      id: generateMarkerId(),
      x,
      color: markerColor,
      label: `${signal.name} ${edgeLabel}`,
      sourceSignalId: signal.id,
    }));

    return newMarkers;
  }

  // Add markers from edge detection to the marker list
  function addMarkersFromEdges(
    signal: Signal,
    edgeType: EdgeType,
    color?: string
  ) {
    const newMarkers = createMarkersFromEdges(signal, edgeType, color);
    markers.value.push(...newMarkers);
    return newMarkers;
  }

  // Add a single marker at a specific position
  function addMarker(x: number, color?: string, label?: string): Marker {
    const colorIndex = markers.value.length % markerColors.length;
    const marker: Marker = {
      id: generateMarkerId(),
      x,
      color: color ?? markerColors[colorIndex] ?? '#E91E63',
      label,
    };
    markers.value.push(marker);
    return marker;
  }

  // Remove a marker by ID
  function removeMarker(markerId: string) {
    const index = markers.value.findIndex(m => m.id === markerId);
    if (index !== -1) {
      markers.value.splice(index, 1);
    }
  }

  // Remove all markers from a specific signal
  function removeMarkersFromSignal(signalId: string) {
    markers.value = markers.value.filter(m => m.sourceSignalId !== signalId);
  }

  // Clear all markers
  function clearAllMarkers() {
    markers.value = [];
  }

  // Get markers sorted by position
  function getSortedMarkers(): Marker[] {
    return [...markers.value].sort((a, b) => a.x - b.x);
  }

  // Find the nearest edge position in a signal to a given x position
  function findNearestEdge(signal: Signal, targetX: number, maxDistance: number = 2): number | null {
    const edges = detectEdges(signal, 'any');
    if (edges.length === 0) return null;

    let nearestEdge: number | null = null;
    let nearestDistance = Infinity;

    for (const edgeX of edges) {
      const distance = Math.abs(edgeX - targetX);
      if (distance < nearestDistance && distance <= maxDistance) {
        nearestDistance = distance;
        nearestEdge = edgeX;
      }
    }

    return nearestEdge;
  }

  // Get the next marker color
  function getNextMarkerColor(): string {
    const colorIndex = markers.value.length % markerColors.length;
    return markerColors[colorIndex] ?? '#E91E63';
  }

  return {
    markers,
    detectEdges,
    createMarkersFromEdges,
    addMarkersFromEdges,
    addMarker,
    removeMarker,
    removeMarkersFromSignal,
    clearAllMarkers,
    getSortedMarkers,
    findNearestEdge,
    getNextMarkerColor,
  };
}
