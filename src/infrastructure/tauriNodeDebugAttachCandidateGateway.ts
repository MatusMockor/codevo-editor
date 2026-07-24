import { invoke } from "@tauri-apps/api/core";
import type { NodeDebugAttachCandidateListResult } from "../domain/nodeDebugAttachCandidate";
import {
  invokeNodeDebugAttachCandidateListIpc,
  type InvokeNodeDebugAttachCandidateCommand,
} from "./tauriNodeDebugAttachCandidateIpcContract";

const invokeNodeDebugAttachCandidateCommand: InvokeNodeDebugAttachCandidateCommand = (
  command,
  args,
) => invoke(command, args);

export class TauriNodeDebugAttachCandidateGateway {
  constructor(
    private readonly invokeCommand: InvokeNodeDebugAttachCandidateCommand = invokeNodeDebugAttachCandidateCommand,
  ) {}

  list(rootPath: string): Promise<NodeDebugAttachCandidateListResult> {
    return invokeNodeDebugAttachCandidateListIpc(this.invokeCommand, { rootPath });
  }
}
