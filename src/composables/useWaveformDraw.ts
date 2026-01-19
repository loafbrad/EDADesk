import type { WavePoint, GridConfig, DisplayFormat, Marker, SieveRegion } from '../types/waveform';
import { WaveValue } from '../types/WaveValue';
import { useGridSnap } from './useGridSnap';

// Format a value based on display format and bit width
// Supports arbitrary bit widths using WaveValue with BigInt
export function formatValue(value: number | bigint, width: number, format: DisplayFormat): string {
  const waveValue = new WaveValue(value);
  const clamped = waveValue.clamp(width);
  return clamped.format(format, width);
}

export function useWaveformDraw(
  canvas: HTMLCanvasElement,
  gridConfig: GridConfig,
  isDarkMode: boolean = false,
  isEditMode: boolean = true
) {
  const ctx = canvas.getContext('2d')!;
  const { gridToPixelX, levelToPixelY } = useGridSnap(gridConfig);
  const padding = 2;

  // Colors based on dark mode
  const colors = {
    gridLine: isDarkMode ? '#3a3a4e' : '#e0e0e0',
    gridLineDashed: isDarkMode ? '#3a3a4e' : '#d0d0d0',
    background: isDarkMode ? '#1e1e2e' : 'transparent',
  };

  function clear() {
    if (isDarkMode) {
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawGrid() {
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;

    // Vertical grid lines (time divisions)
    for (let i = 0; i <= gridConfig.columns; i++) {
      const x = gridToPixelX(i);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    // Horizontal lines for high and low levels (only in edit mode)
    if (isEditMode) {
      ctx.strokeStyle = colors.gridLineDashed;
      ctx.setLineDash([5, 5]);

      const highY = levelToPixelY(1, canvas.height, padding);
      const lowY = levelToPixelY(0, canvas.height, padding);

      ctx.beginPath();
      ctx.moveTo(0, highY);
      ctx.lineTo(canvas.width, highY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, lowY);
      ctx.lineTo(canvas.width, lowY);
      ctx.stroke();

      ctx.setLineDash([]);
    }
  }

  function drawWaveform(points: WavePoint[], color: string = '#2196F3') {
    if (points.length === 0) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    // Sort points by x position
    const sortedPoints = [...points].sort((a, b) => a.x - b.x);

    ctx.beginPath();

    // Start from the first point
    const firstPoint = sortedPoints[0]!;
    let currentX = gridToPixelX(firstPoint.x);
    let currentY = levelToPixelY(firstPoint.level, canvas.height, padding);
    ctx.moveTo(currentX, currentY);

    // Draw each segment
    for (let i = 1; i < sortedPoints.length; i++) {
      const point = sortedPoints[i]!;
      const nextX = gridToPixelX(point.x);
      const nextY = levelToPixelY(point.level, canvas.height, padding);

      // Horizontal line to the x position of next point
      ctx.lineTo(nextX, currentY);

      // Vertical transition to new level
      ctx.lineTo(nextX, nextY);

      currentX = nextX;
      currentY = nextY;
    }

    // Extend to the end of the canvas
    ctx.lineTo(canvas.width, currentY);

    ctx.stroke();
  }

  function render(points: WavePoint[], color: string = '#2196F3') {
    clear();
    drawGrid();
    drawWaveform(points, color);
  }

  // Draw a hover preview showing what the waveform would look like with a new point
  // blockLength > 1 extends the same level for the entire segment (removes intermediate points)
  function drawHoverPreview(
    points: WavePoint[],
    hoverX: number,
    hoverLevel: number,
    color: string = '#2196F3',
    blockLength: number = 1
  ) {
    // Create a preview point array with the hover point added/updated
    const previewPoints = [...points];
    const endX = hoverX + blockLength;

    // Add/update the starting point
    const existingIndex = previewPoints.findIndex(p => p.x === hoverX);
    if (existingIndex !== -1) {
      previewPoints[existingIndex] = { x: hoverX, level: hoverLevel };
    } else {
      previewPoints.push({ x: hoverX, level: hoverLevel });
    }

    // If block length > 1, remove any points within the range to extend the level
    if (blockLength > 1) {
      // Remove points strictly between hoverX and endX
      for (let i = previewPoints.length - 1; i >= 0; i--) {
        const p = previewPoints[i];
        if (p && p.x > hoverX && p.x < endX) {
          previewPoints.splice(i, 1);
        }
      }
    }

    // Sort by x position
    const sortedPoints = previewPoints.sort((a, b) => a.x - b.x);

    if (sortedPoints.length === 0) return;

    // Draw the preview waveform with transparency
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.setLineDash([4, 4]);

    ctx.beginPath();

    const firstPoint = sortedPoints[0]!;
    let currentX = gridToPixelX(firstPoint.x);
    let currentY = levelToPixelY(firstPoint.level, canvas.height, padding);
    ctx.moveTo(currentX, currentY);

    for (let i = 1; i < sortedPoints.length; i++) {
      const point = sortedPoints[i]!;
      const nextX = gridToPixelX(point.x);
      const nextY = levelToPixelY(point.level, canvas.height, padding);

      ctx.lineTo(nextX, currentY);
      ctx.lineTo(nextX, nextY);

      currentX = nextX;
      currentY = nextY;
    }

    ctx.lineTo(canvas.width, currentY);
    ctx.stroke();

    // Draw circle at the start point
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([]);
    ctx.fillStyle = color;

    const hoverPixelX = gridToPixelX(hoverX);
    const hoverPixelY = levelToPixelY(hoverLevel, canvas.height, padding);
    ctx.beginPath();
    ctx.arc(hoverPixelX, hoverPixelY, 5, 0, Math.PI * 2);
    ctx.fill();

    // If block length > 1, draw end marker and length indicator
    if (blockLength > 1) {
      const endPixelX = gridToPixelX(endX);

      // Draw vertical end marker line
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(endPixelX, padding);
      ctx.lineTo(endPixelX, canvas.height - padding);
      ctx.stroke();

      // Draw a small circle at the end on the same level
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(endPixelX, hoverPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw block length indicator text (centered in canvas)
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = isDarkMode ? '#fff' : '#333';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const midX = (hoverPixelX + endPixelX) / 2;
      const midY = canvas.height / 2;
      ctx.fillText(`${blockLength}`, midX, midY);
    }

    ctx.restore();
  }

  // Draw bus-style waveform for vector signals
  function drawBusWaveform(
    points: WavePoint[],
    color: string,
    width: number,
    displayFormat: DisplayFormat
  ) {
    if (points.length === 0) return;

    const sortedPoints = [...points].sort((a, b) => a.x - b.x);
    const topY = padding;
    const bottomY = canvas.height - padding;
    const midY = (topY + bottomY) / 2;
    const transitionWidth = 6; // Width of the angled transition

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw each segment
    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i]!;
      const startX = gridToPixelX(point.x);
      const nextPoint = sortedPoints[i + 1];
      const endX = nextPoint !== undefined
        ? gridToPixelX(nextPoint.x)
        : canvas.width;

      // Draw the bus segment (box style with angled transitions)
      ctx.beginPath();

      if (i === 0) {
        // First segment: start with straight edge
        ctx.moveTo(startX, topY);
        ctx.lineTo(endX - transitionWidth / 2, topY);
        ctx.lineTo(endX, midY);
        ctx.lineTo(endX - transitionWidth / 2, bottomY);
        ctx.lineTo(startX, bottomY);
        ctx.lineTo(startX, topY);
      } else if (i === sortedPoints.length - 1) {
        // Last segment: end with straight edge
        ctx.moveTo(startX, midY);
        ctx.lineTo(startX + transitionWidth / 2, topY);
        ctx.lineTo(endX, topY);
        ctx.lineTo(endX, bottomY);
        ctx.lineTo(startX + transitionWidth / 2, bottomY);
        ctx.lineTo(startX, midY);
      } else {
        // Middle segments: angled on both ends
        ctx.moveTo(startX, midY);
        ctx.lineTo(startX + transitionWidth / 2, topY);
        ctx.lineTo(endX - transitionWidth / 2, topY);
        ctx.lineTo(endX, midY);
        ctx.lineTo(endX - transitionWidth / 2, bottomY);
        ctx.lineTo(startX + transitionWidth / 2, bottomY);
        ctx.lineTo(startX, midY);
      }

      ctx.stroke();

      // Draw the value text centered in the segment
      const segmentWidth = endX - startX;
      if (segmentWidth > 30) { // Only draw text if segment is wide enough
        const valueText = formatValue(point.level, width, displayFormat);
        ctx.font = '12px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textX = startX + segmentWidth / 2;
        ctx.fillText(valueText, textX, midY);
      }
    }
  }

  // Draw grid suitable for bus signals (no high/low lines)
  function drawBusGrid() {
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;

    // Vertical grid lines (time divisions)
    for (let i = 0; i <= gridConfig.columns; i++) {
      const x = gridToPixelX(i);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
  }

  function renderBus(
    points: WavePoint[],
    color: string,
    width: number,
    displayFormat: DisplayFormat
  ) {
    clear();
    drawBusGrid();
    drawBusWaveform(points, color, width, displayFormat);
  }

  // Draw markers as vertical dashed lines
  function drawMarkers(markers: Marker[]) {
    if (markers.length === 0) return;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;

    for (const marker of markers) {
      const x = gridToPixelX(marker.x);

      // Draw the vertical line
      ctx.strokeStyle = marker.color;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      // Draw a small triangle at the top
      ctx.fillStyle = marker.color;
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 8);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  // Draw a preview marker showing where the marker will be placed
  function drawMarkerPreview(markerX: number, color: string = '#FF9800') {
    const x = gridToPixelX(markerX);

    ctx.save();
    ctx.globalAlpha = 0.5;

    // Draw the vertical dashed line
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();

    // Draw a small triangle at the top
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Draw sieve regions as translucent rectangles
  // signalId takes precedence over signalName for filtering
  function drawRegions(regions: SieveRegion[], signalName?: string, signalId?: string) {
    if (regions.length === 0) return;

    ctx.save();

    for (const region of regions) {
      // Filter by signalId first (more precise), then by signalName
      if (signalId) {
        // If the current signal has an ID, only show regions matching this ID
        // or regions that have no specific signal (global regions)
        if (region.signalId && region.signalId !== signalId) {
          continue;
        }
        // If region has signalName but no signalId, also skip if name doesn't match
        if (!region.signalId && region.signalName && region.signalName !== signalName) {
          continue;
        }
      } else if (region.signalName && region.signalName !== signalName) {
        // Fallback to signalName filtering if no signalId provided
        continue;
      }

      const startX = gridToPixelX(region.startX);
      const endX = gridToPixelX(region.endX);
      const width = endX - startX;

      // Draw the translucent rectangle
      ctx.fillStyle = region.color;
      ctx.fillRect(startX, 0, width, canvas.height);

      // Draw optional label
      if (region.label) {
        ctx.fillStyle = isDarkMode ? '#fff' : '#333';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(region.label, startX + width / 2, 2);
      }
    }

    ctx.restore();
  }

  // Render with markers
  function renderWithMarkers(points: WavePoint[], color: string, markers: Marker[]) {
    clear();
    drawGrid();
    drawWaveform(points, color);
    drawMarkers(markers);
  }

  // Render bus with markers
  function renderBusWithMarkers(
    points: WavePoint[],
    color: string,
    width: number,
    displayFormat: DisplayFormat,
    markers: Marker[]
  ) {
    clear();
    drawBusGrid();
    drawBusWaveform(points, color, width, displayFormat);
    drawMarkers(markers);
  }

  // Render with markers and regions
  function renderWithMarkersAndRegions(
    points: WavePoint[],
    color: string,
    markers: Marker[],
    regions: SieveRegion[],
    signalName?: string,
    signalId?: string
  ) {
    clear();
    drawRegions(regions, signalName, signalId); // Draw regions first (behind waveform)
    drawGrid();
    drawWaveform(points, color);
    drawMarkers(markers);
  }

  // Render bus with markers and regions
  function renderBusWithMarkersAndRegions(
    points: WavePoint[],
    color: string,
    width: number,
    displayFormat: DisplayFormat,
    markers: Marker[],
    regions: SieveRegion[],
    signalName?: string,
    signalId?: string
  ) {
    clear();
    drawRegions(regions, signalName, signalId); // Draw regions first (behind waveform)
    drawBusGrid();
    drawBusWaveform(points, color, width, displayFormat);
    drawMarkers(markers);
  }

  // Render with markers, regions, and hover preview (for single-bit signals)
  function renderWithPreview(
    points: WavePoint[],
    color: string,
    markers: Marker[],
    regions: SieveRegion[],
    signalName: string | undefined,
    signalId: string | undefined,
    hoverX: number | null,
    hoverLevel: number | null,
    blockLength: number = 1
  ) {
    clear();
    drawRegions(regions, signalName, signalId);
    drawGrid();
    // Draw the preview first (behind the actual waveform)
    if (hoverX !== null && hoverLevel !== null) {
      drawHoverPreview(points, hoverX, hoverLevel, color, blockLength);
    }
    drawWaveform(points, color);
    drawMarkers(markers);
  }

  // Render with marker placement preview (for single-bit signals)
  function renderWithMarkerPreview(
    points: WavePoint[],
    color: string,
    markers: Marker[],
    regions: SieveRegion[],
    signalName: string | undefined,
    signalId: string | undefined,
    markerPreviewX: number | null,
    markerColor: string = '#FF9800'
  ) {
    clear();
    drawRegions(regions, signalName, signalId);
    drawGrid();
    drawWaveform(points, color);
    drawMarkers(markers);
    // Draw marker preview on top
    if (markerPreviewX !== null) {
      drawMarkerPreview(markerPreviewX, markerColor);
    }
  }

  // Render bus with marker placement preview
  function renderBusWithMarkerPreview(
    points: WavePoint[],
    color: string,
    width: number,
    displayFormat: DisplayFormat,
    markers: Marker[],
    regions: SieveRegion[],
    signalName: string | undefined,
    signalId: string | undefined,
    markerPreviewX: number | null,
    markerColor: string = '#FF9800'
  ) {
    clear();
    drawRegions(regions, signalName, signalId);
    drawBusGrid();
    drawBusWaveform(points, color, width, displayFormat);
    drawMarkers(markers);
    // Draw marker preview on top
    if (markerPreviewX !== null) {
      drawMarkerPreview(markerPreviewX, markerColor);
    }
  }

  // Draw a hover preview for bus/vector signals showing where a transition will be added
  function drawBusHoverPreview(hoverX: number, color: string) {
    const topY = padding;
    const bottomY = canvas.height - padding;
    const pixelX = gridToPixelX(hoverX);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    // Draw vertical dashed line at hover position
    ctx.beginPath();
    ctx.moveTo(pixelX, topY);
    ctx.lineTo(pixelX, bottomY);
    ctx.stroke();

    // Draw a small indicator at the bottom
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pixelX - 6, bottomY + 2);
    ctx.lineTo(pixelX + 6, bottomY + 2);
    ctx.lineTo(pixelX, bottomY - 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Render bus with markers, regions, and hover preview
  function renderBusWithPreview(
    points: WavePoint[],
    color: string,
    width: number,
    displayFormat: DisplayFormat,
    markers: Marker[],
    regions: SieveRegion[],
    signalName: string | undefined,
    signalId: string | undefined,
    hoverX: number | null,
    showHoverPreview: boolean
  ) {
    clear();
    drawRegions(regions, signalName, signalId);
    drawBusGrid();
    drawBusWaveform(points, color, width, displayFormat);
    // Draw hover preview after waveform so it's visible
    if (hoverX !== null && showHoverPreview) {
      drawBusHoverPreview(hoverX, color);
    }
    drawMarkers(markers);
  }

  return {
    clear,
    drawGrid,
    drawBusGrid,
    drawWaveform,
    drawBusWaveform,
    drawMarkers,
    drawMarkerPreview,
    drawRegions,
    drawHoverPreview,
    drawBusHoverPreview,
    render,
    renderBus,
    renderWithMarkers,
    renderBusWithMarkers,
    renderWithMarkersAndRegions,
    renderBusWithMarkersAndRegions,
    renderWithPreview,
    renderWithMarkerPreview,
    renderBusWithPreview,
    renderBusWithMarkerPreview,
  };
}
