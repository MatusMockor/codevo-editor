import {
  DEFAULT_AGENT_RAIL_WIDTH,
  MAX_AGENT_RAIL_WIDTH,
  MIN_AGENT_RAIL_WIDTH,
} from "../../domain/agentWorkbenchLayout";

export const AGENT_RAIL_RESIZE_LABEL = "Resize thread rail";
export const AGENT_RAIL_WIDTH_VARIABLE = "--agent-rail-width";
export const AGENT_RAIL_RESIZE_STEP = 16;

export function railWidthForKey(key: string, width: number): number | null {
  if (key === "ArrowLeft") return width - AGENT_RAIL_RESIZE_STEP;
  if (key === "ArrowRight") return width + AGENT_RAIL_RESIZE_STEP;
  if (key === "Home") return MIN_AGENT_RAIL_WIDTH;
  if (key === "End") return MAX_AGENT_RAIL_WIDTH;
  if (key === "Enter" || key === " ") return DEFAULT_AGENT_RAIL_WIDTH;
  return null;
}
