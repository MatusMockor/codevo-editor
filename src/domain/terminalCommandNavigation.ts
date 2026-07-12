export type TerminalCommandNavigationDirection = "down" | "up";

export function nextCommandMarkerLine(
  sortedMarkerLines: readonly number[],
  viewportTopLine: number,
  direction: TerminalCommandNavigationDirection,
): number | null {
  if (direction === "down") {
    for (const markerLine of sortedMarkerLines) {
      if (markerLine > viewportTopLine) {
        return markerLine;
      }
    }

    return null;
  }

  for (let index = sortedMarkerLines.length - 1; index >= 0; index -= 1) {
    const markerLine = sortedMarkerLines[index];

    if (markerLine !== undefined && markerLine < viewportTopLine) {
      return markerLine;
    }
  }

  return null;
}
