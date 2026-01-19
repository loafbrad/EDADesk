import type { GridConfig } from '../types/waveform';

export function useGridSnap(gridConfig: GridConfig) {
  // Snap X coordinate to nearest grid column
  function snapX(pixelX: number): number {
    const gridX = Math.round(pixelX / gridConfig.cellWidth);
    return Math.max(0, Math.min(gridX, gridConfig.columns));
  }

  // Snap Y coordinate to high (1) or low (0) based on position (for single-bit signals)
  function snapLevel(pixelY: number, canvasHeight: number): number {
    const midpoint = canvasHeight / 2;
    return pixelY < midpoint ? 1 : 0;
  }

  // Convert grid X to pixel X
  function gridToPixelX(gridX: number): number {
    return gridX * gridConfig.cellWidth;
  }

  // Convert level to pixel Y (for single-bit signals: 0 or 1)
  // Accepts number | bigint for compatibility with WavePoint.level type
  function levelToPixelY(level: number | bigint, canvasHeight: number, padding: number = 10): number {
    const drawHeight = canvasHeight - padding * 2;
    // For single-bit signals, level should be 0 or 1
    return level === 1 || level === 1n ? padding : padding + drawHeight;
  }

  return {
    snapX,
    snapLevel,
    gridToPixelX,
    levelToPixelY,
  };
}
