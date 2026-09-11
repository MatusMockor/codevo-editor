export const AGENT_MINIMAP_COLUMN_WIDTH = 768;
export const AGENT_MINIMAP_PERSISTENT_GUTTER = 48;
export const AGENT_MINIMAP_RAIL_INSET = 12;
export const AGENT_MINIMAP_HIT_STRIP_MAX = 40;

export function agentMinimapSideGutter(sessionWidth: number): number {
  if (!Number.isFinite(sessionWidth) || sessionWidth <= 0) return 0;
  const column = Math.min(sessionWidth, AGENT_MINIMAP_COLUMN_WIDTH);

  return Math.max(0, (sessionWidth - column) / 2);
}

export function agentMinimapHasPersistentGutter(sessionWidth: number): boolean {
  return agentMinimapSideGutter(sessionWidth) >= AGENT_MINIMAP_PERSISTENT_GUTTER;
}

export function agentMinimapHitStripWidth(sessionWidth: number): number {
  const gutter = Math.floor(agentMinimapSideGutter(sessionWidth));

  return Math.max(0, Math.min(AGENT_MINIMAP_HIT_STRIP_MAX, gutter - AGENT_MINIMAP_RAIL_INSET));
}
