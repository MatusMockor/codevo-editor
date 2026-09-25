import type { CSSProperties } from "react";
import { agentThreadTypeScale } from "../domain/agentSettings";

export const AGENT_TYPE_SCALE_VARIABLE = "--cv-type-scale";

export function appShellTypeScaleStyle(
  agentThreadFontSize: unknown,
  base: CSSProperties = {},
): CSSProperties {
  return {
    ...base,
    [AGENT_TYPE_SCALE_VARIABLE]: `${agentThreadTypeScale(agentThreadFontSize)}`,
  } as CSSProperties;
}
