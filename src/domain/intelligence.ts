import type { IntelligenceMode } from "./workspace";

export type SmartModeStatus = "off" | "ready";

export interface SmartModeState {
  mode: IntelligenceMode;
  status: SmartModeStatus;
  message: string;
}

export interface SmartModeGateway {
  getState(rootPath: string): Promise<SmartModeState>;
  setMode(rootPath: string, mode: IntelligenceMode): Promise<SmartModeState>;
}

export function shouldIndexWorkspace(mode: IntelligenceMode): boolean {
  return mode === "lightSmart" || mode === "fullSmart";
}

export function shouldStartLanguageServer(mode: IntelligenceMode): boolean {
  return mode === "fullSmart";
}
