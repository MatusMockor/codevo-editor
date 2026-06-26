import type { IntelligenceMode } from "./workspace";

export type SmartModeStatus = "off" | "ready";

export interface SmartModeState {
  mode: IntelligenceMode;
  status: SmartModeStatus;
  message: string;
}

export interface SmartModeGateway {
  getState(): Promise<SmartModeState>;
  setMode(mode: IntelligenceMode): Promise<SmartModeState>;
}

export function shouldIndexWorkspace(mode: IntelligenceMode): boolean {
  return mode === "lightSmart" || mode === "fullSmart";
}

export function shouldStartLanguageServer(mode: IntelligenceMode): boolean {
  return mode === "fullSmart";
}

/**
 * Whether PHP / Laravel navigation (contextual go-to-definition, type-hint
 * resolution, indexed symbol search) may run for the given mode.
 *
 * Light (`basic`) mode is pure JS/TS - it targets VS Code parity and must NOT
 * perform any PHP/Laravel navigation or trigger project-wide file searches.
 * PHP intelligence is reserved for Smart Index (`lightSmart`) and IDE
 * (`fullSmart`) modes, where the workspace is indexed.
 */
export function shouldUsePhpIntelligence(mode: IntelligenceMode): boolean {
  return mode === "lightSmart" || mode === "fullSmart";
}
