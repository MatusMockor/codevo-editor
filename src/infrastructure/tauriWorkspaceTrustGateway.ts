import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceTrustGateway,
  WorkspaceTrustState,
} from "../domain/trust";

export class TauriWorkspaceTrustGateway implements WorkspaceTrustGateway {
  getTrust(rootPath: string): Promise<WorkspaceTrustState> {
    return invoke<WorkspaceTrustState>("get_workspace_trust", { rootPath });
  }

  setTrust(rootPath: string, trusted: boolean): Promise<WorkspaceTrustState> {
    return invoke<WorkspaceTrustState>("set_workspace_trust", {
      rootPath,
      trusted,
    });
  }
}
