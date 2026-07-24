import { invoke } from "@tauri-apps/api/core";
import type { DebugRuntimeStatus } from "../domain/debug";
import {
  invokeNodeDebugAttachCandidateStartIpc,
  type InvokeNodeDebugAttachStartCommand,
  type NodeDebugAttachCandidateStartRequest,
} from "./tauriNodeDebugAttachStartIpcContract";

const invokeNodeDebugAttachStartCommand: InvokeNodeDebugAttachStartCommand = (command, args) =>
  invoke(command, args);

export class TauriNodeDebugAttachStartGateway {
  constructor(
    private readonly invokeCommand: InvokeNodeDebugAttachStartCommand = invokeNodeDebugAttachStartCommand,
  ) {}

  async start(request: NodeDebugAttachCandidateStartRequest): Promise<DebugRuntimeStatus> {
    const response = await invokeNodeDebugAttachCandidateStartIpc(this.invokeCommand, request);
    if (response.status === "ok") return { kind: "ok", sessionId: response.sessionId };
    return { kind: response.status, message: response.message };
  }
}
