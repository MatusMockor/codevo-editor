import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceTrustGateway,
  WorkspaceOpenedProjectIdentity,
  WorkspaceOpenedProjectRevocation,
  WorkspaceTrustState,
} from "../domain/trust";

function assertOpenedProjectIdentity(
  admissionToken: number | undefined,
  workspaceId: string,
  roots: readonly string[],
): void {
  if (
    roots.some((root) => !root.startsWith("/")) ||
    !Number.isSafeInteger(admissionToken) ||
    (admissionToken ?? 0) <= 0 ||
    [workspaceId, ...roots].some(
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
}

function assertOpenedProjectTrustState(
  state: WorkspaceTrustState,
  canonicalRootPath: string,
  trusted: boolean,
): void {
  if (
    !state ||
    Object.keys(state).length !== 2 ||
    state.rootPath !== canonicalRootPath ||
    state.trusted !== trusted
  ) {
    throw new Error("Opened project trust response does not match its identity.");
  }
}

export class TauriWorkspaceTrustGateway implements WorkspaceTrustGateway {
  async grantOpenedProject(identity: WorkspaceOpenedProjectIdentity): Promise<WorkspaceTrustState> {
    assertOpenedProjectIdentity(identity.admissionToken, identity.workspaceId, [
      identity.selectedPath,
      identity.canonicalRoot,
    ]);
    const target = {
      workspaceId: identity.workspaceId,
      admissionToken: identity.admissionToken,
      selectedRootPath: identity.selectedPath,
      canonicalRootPath: identity.canonicalRoot,
    };
    const state = await invoke<WorkspaceTrustState>("grant_opened_project_trust", { target });
    assertOpenedProjectTrustState(state, target.canonicalRootPath, true);
    return state;
  }

  async revokeOpenedProject(
    identity: WorkspaceOpenedProjectRevocation,
  ): Promise<WorkspaceTrustState> {
    assertOpenedProjectIdentity(identity.admissionToken, identity.workspaceId, [
      identity.canonicalRoot,
    ]);
    const target = {
      workspaceId: identity.workspaceId,
      admissionToken: identity.admissionToken,
      canonicalRootPath: identity.canonicalRoot,
    };
    const state = await invoke<WorkspaceTrustState>("revoke_opened_project_trust", { target });
    assertOpenedProjectTrustState(state, target.canonicalRootPath, false);
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
