import { invoke } from "@tauri-apps/api/core";
import type { GitSurfaceTarget } from "../domain/gitSurfaceStatus";
import type {
  GitAmendCandidate,
  GitAmendHeadRequest,
  GitAmendReceipt,
  GitDiscardFileRequest,
  GitDiscardPreparation,
  GitPrepareDiscardRequest,
  GitDiscardReceipt,
  GitWorkingTreeGateway,
} from "../domain/gitWorkingTree";
import type { InvokeGitSurfaceCommand } from "./tauriGitSurfaceIpcContract";
import {
  invokeAmendGitHeadIpc,
  invokeDiscardGitFileIpc,
  invokeGetGitAmendCandidateIpc,
  invokePrepareGitDiscardIpc,
} from "./tauriGitWorkingTreeIpcContract";

const invokeCommand: InvokeGitSurfaceCommand = (command, args) => invoke<unknown>(command, args);

export class TauriGitWorkingTreeGateway implements GitWorkingTreeGateway {
  constructor(private readonly invokeGit: InvokeGitSurfaceCommand = invokeCommand) {}

  getAmendCandidate(target: GitSurfaceTarget): Promise<GitAmendCandidate> {
    return invokeGetGitAmendCandidateIpc(this.invokeGit, target);
  }

  amendHead(request: GitAmendHeadRequest): Promise<GitAmendReceipt> {
    return invokeAmendGitHeadIpc(this.invokeGit, request);
  }

  prepareDiscard(request: GitPrepareDiscardRequest): Promise<GitDiscardPreparation> {
    return invokePrepareGitDiscardIpc(this.invokeGit, request);
  }

  discardFile(request: GitDiscardFileRequest): Promise<GitDiscardReceipt> {
    return invokeDiscardGitFileIpc(this.invokeGit, request);
  }
}
