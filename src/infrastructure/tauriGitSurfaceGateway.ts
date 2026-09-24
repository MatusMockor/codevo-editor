import { invoke } from "@tauri-apps/api/core";
import type {
  GitBranchChanges,
  GitBranchChangesRequest,
  GitBranchDiffGateway,
  GitBranchFileSides,
  GitBranchFileSidesRequest,
} from "../domain/gitBranchDiff";
import type {
  GitSurfaceStatus,
  GitSurfaceStatusGateway,
  GitSurfaceTarget,
} from "../domain/gitSurfaceStatus";
import {
  invokeGetGitBranchChangesIpc,
  invokeGetGitBranchFileDiffIpc,
  invokeGetGitSurfaceStatusIpc,
  type InvokeGitSurfaceCommand,
} from "./tauriGitSurfaceIpcContract";

const invokeCommand: InvokeGitSurfaceCommand = (command, args) => invoke<unknown>(command, args);

export class TauriGitSurfaceGateway implements GitSurfaceStatusGateway, GitBranchDiffGateway {
  constructor(private readonly invokeGitSurface: InvokeGitSurfaceCommand = invokeCommand) {}

  getSurfaceStatus(target: GitSurfaceTarget): Promise<GitSurfaceStatus> {
    return invokeGetGitSurfaceStatusIpc(this.invokeGitSurface, target);
  }

  getBranchChanges(request: GitBranchChangesRequest): Promise<GitBranchChanges> {
    return invokeGetGitBranchChangesIpc(this.invokeGitSurface, request);
  }

  getBranchFileSides(request: GitBranchFileSidesRequest): Promise<GitBranchFileSides> {
    return invokeGetGitBranchFileDiffIpc(this.invokeGitSurface, request);
  }
}
