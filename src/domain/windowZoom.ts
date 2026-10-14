export const MIN_WINDOW_ZOOM_LEVEL = -8;
export const MAX_WINDOW_ZOOM_LEVEL = 8;
export const DEFAULT_WINDOW_ZOOM_LEVEL = 0;

export type WindowZoomAction = "in" | "out" | "reset";

export function normalizeWindowZoomLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_WINDOW_ZOOM_LEVEL;
  return Math.min(MAX_WINDOW_ZOOM_LEVEL, Math.max(MIN_WINDOW_ZOOM_LEVEL, Math.trunc(value)));
}

export function windowZoomFactor(level: number): number {
  return 1.2 ** normalizeWindowZoomLevel(level);
}

export function transitionWindowZoomLevel(level: number, action: WindowZoomAction): number {
  if (action === "reset") return DEFAULT_WINDOW_ZOOM_LEVEL;
  return normalizeWindowZoomLevel(normalizeWindowZoomLevel(level) + (action === "in" ? 1 : -1));
}
