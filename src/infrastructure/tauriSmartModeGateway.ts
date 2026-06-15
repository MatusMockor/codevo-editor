import { invoke } from "@tauri-apps/api/core";
import type { SmartModeGateway, SmartModeState } from "../domain/intelligence";
import type { IntelligenceMode } from "../domain/workspace";

export class TauriSmartModeGateway implements SmartModeGateway {
  getState(): Promise<SmartModeState> {
    return invoke<SmartModeState>("get_smart_mode_state");
  }

  setMode(mode: IntelligenceMode): Promise<SmartModeState> {
    return invoke<SmartModeState>("set_smart_mode", { mode });
  }
}
