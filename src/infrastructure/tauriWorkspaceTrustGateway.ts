import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceTrustGateway,
  WorkspaceOpenedProjectIdentity,
  WorkspaceTrustState,
} from "../domain/trust";

export class TauriWorkspaceTrustGateway implements WorkspaceTrustGateway {
  async grantOpenedProject(identity: WorkspaceOpenedProjectIdentity): Promise<WorkspaceTrustState> {
    if (
      !identity.selectedPath.startsWith("/") ||
      !identity.canonicalRoot.startsWith("/") ||
      !Number.isSafeInteger(identity.admissionToken) ||
      (identity.admissionToken ?? 0) <= 0 ||
      [identity.workspaceId, identity.selectedPath, identity.canonicalRoot].some(
        (value) =>
          value.length === 0 ||
          value.length > 4096 ||
          new TextEncoder().encode(value).length > 4096 ||
          Array.from(value).some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ),
      )
    ) {
      throw new Error("Invalid opened project identity.");
    }
    const target = {
      workspaceId: identity.workspaceId,
      admissionToken: identity.admissionToken,
      selectedRootPath: identity.selectedPath,
      canonicalRootPath: identity.canonicalRoot,
    };
    const state = await invoke<WorkspaceTrustState>("grant_opened_project_trust", { target });
    if (
      !state ||
      Object.keys(state).length !== 2 ||
      state.rootPath !== target.canonicalRootPath ||
      state.trusted !== true
    ) {
      throw new Error("Opened project trust response does not match its identity.");
    }
    return state;
  }

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
