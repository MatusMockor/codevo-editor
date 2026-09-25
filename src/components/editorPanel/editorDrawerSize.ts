export const DEFAULT_EDITOR_DRAWER_HEIGHT = 224;
export const DEBUG_EDITOR_DRAWER_HEIGHT = 236;
export const MIN_EDITOR_DRAWER_HEIGHT = 120;
export const MAX_EDITOR_DRAWER_HEIGHT = 640;

export function clampEditorDrawerHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_EDITOR_DRAWER_HEIGHT;
  return Math.round(Math.min(Math.max(height, MIN_EDITOR_DRAWER_HEIGHT), MAX_EDITOR_DRAWER_HEIGHT));
}
