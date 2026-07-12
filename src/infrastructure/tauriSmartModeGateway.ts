import { invoke } from "@tauri-apps/api/core";
import type { SmartModeGateway, SmartModeState } from "../domain/intelligence";
import type { IntelligenceMode } from "../domain/workspace";

export class TauriSmartModeGateway implements SmartModeGateway {
  getState(rootPath: string): Promise<SmartModeState> {
    return invoke<SmartModeState>("get_smart_mode_state", { rootPath });
  }

  setMode(rootPath: string, mode: IntelligenceMode): Promise<SmartModeState> {
    return invoke<SmartModeState>("set_smart_mode", { mode, rootPath });
  }
}
