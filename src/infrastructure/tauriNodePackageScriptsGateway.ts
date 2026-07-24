import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  NodePackageDiscoveryLimits,
  NodePackageScriptsGateway,
  NodePackageScriptRunGateway,
  NodePackageScriptsResult,
  NodePackageTaskEvent,
  StartNodePackageTaskRequest,
  StartNodePackageTaskResult,
  StopNodePackageTaskRequest,
} from "../domain/nodePackageScripts";
import type {
  NodePackageTaskOutputEvent,
  NodePackageTaskProblemsEvent,
  NodePackageTaskProblemsGateway,
} from "../domain/nodePackageTaskProblems";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import {
  decodeNodePackageTaskEvent,
  decodeNodePackageTaskOutputEvent,
  decodeNodePackageTaskProblemsEvent,
  invokeAcknowledgeNodePackageTaskStartIpc,
  invokeNodePackageScriptsIpc,
  invokeStartNodePackageTaskIpc,
  invokeStopNodePackageTaskIpc,
  NODE_PACKAGE_TASK_STATUS_EVENT,
  NODE_PACKAGE_TASK_OUTPUT_EVENT,
  NODE_PACKAGE_TASK_PROBLEMS_EVENT,
  type InvokeNodePackageScriptsCommand,
} from "./tauriNodePackageScriptsIpcContract";

const invokeNodePackageScriptsCommand: InvokeNodePackageScriptsCommand = (command, args) =>
  invoke(command, args);
export type ListenToNodePackageTaskEvents = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;
const listenToNodePackageTaskEvents: ListenToNodePackageTaskEvents = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriNodePackageScriptsGateway
  implements NodePackageScriptsGateway, NodePackageScriptRunGateway, NodePackageTaskProblemsGateway
{
  constructor(
    private readonly identities: WorkspaceIdentityDescriptorResolver,
    private readonly invokeCommand: InvokeNodePackageScriptsCommand = invokeNodePackageScriptsCommand,
    private readonly listenToEvent: ListenToNodePackageTaskEvents = listenToNodePackageTaskEvents,
  ) {}

  listNodePackageScripts(
    workspaceRoot: string,
    limits: NodePackageDiscoveryLimits,
  ): Promise<NodePackageScriptsResult> {
    return invokeNodePackageScriptsIpc(this.invokeCommand, {
      workspaceId: this.workspaceId(workspaceRoot),
      ...limits,
    });
  }

  startNodePackageTask(request: StartNodePackageTaskRequest): Promise<StartNodePackageTaskResult> {
    return invokeStartNodePackageTaskIpc(this.invokeCommand, request);
  }

  acknowledgeNodePackageTaskStart(request: StopNodePackageTaskRequest): Promise<void> {
    return invokeAcknowledgeNodePackageTaskStartIpc(this.invokeCommand, request);
  }

  stopNodePackageTask(request: StopNodePackageTaskRequest): Promise<void> {
    return invokeStopNodePackageTaskIpc(this.invokeCommand, request);
  }

  async subscribeNodePackageTaskEvents(
    handler: (event: NodePackageTaskEvent) => void,
  ): Promise<() => void> {
    return this.listenToEvent(NODE_PACKAGE_TASK_STATUS_EVENT, (event) => {
      try {
        handler(decodeNodePackageTaskEvent(event.payload));
      } catch {
        // The backend event boundary is fail-closed: malformed payloads never reach application state.
      }
    });
  }

  async subscribeNodePackageTaskOutputEvents(
    handler: (event: NodePackageTaskOutputEvent) => void,
  ): Promise<() => void> {
    return this.subscribeDecoded(NODE_PACKAGE_TASK_OUTPUT_EVENT, decodeNodePackageTaskOutputEvent, handler);
  }

  async subscribeNodePackageTaskProblemsEvents(
    handler: (event: NodePackageTaskProblemsEvent) => void,
  ): Promise<() => void> {
    return this.subscribeDecoded(
      NODE_PACKAGE_TASK_PROBLEMS_EVENT,
      decodeNodePackageTaskProblemsEvent,
      handler,
    );
  }

  private async subscribeDecoded<T>(
    eventName: string,
    decode: (payload: unknown) => T,
    handler: (event: T) => void,
  ): Promise<() => void> {
    return this.listenToEvent(eventName, (event) => {
      try {
        handler(decode(event.payload));
      } catch {
        // Malformed backend payloads fail closed at the transport boundary.
      }
    });
  }

  private workspaceId(workspaceRoot: string): string {
    const match = this.identities.matchForPath?.(workspaceRoot);
    if (!match || match.relativePath !== "") {
      throw new Error("Node package script discovery requires an opened native workspace root.");
    }
    return match.descriptor.workspaceId;
  }
}
