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
