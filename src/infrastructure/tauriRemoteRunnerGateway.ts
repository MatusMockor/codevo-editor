import { invoke } from "@tauri-apps/api/core";
import type * as R from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

export type InvokeRemoteRunnerCommand = (
  command: string,
  args?: Readonly<{ request: unknown }>,
) => Promise<unknown>;
export const REMOTE_RUNNER_COMMANDS = {
  listServers: "remote_runner_list_servers",
  connectServer: "remote_runner_connect_server",
  disconnectServer: "remote_runner_disconnect_server",
  removeServer: "remote_runner_remove_server",
  getRunner: "remote_runner_get_runner",
  listProjects: "remote_runner_list_projects",
  cloneProject: "remote_runner_clone_project",
  getProjectClone: "remote_runner_get_project_clone",
  cancelProjectClone: "remote_runner_cancel_project_clone",
  listTasks: "remote_runner_list_tasks",
  createTask: "remote_runner_create_task",
  startTask: "remote_runner_start_task",
  getTask: "remote_runner_get_task",
  cancelTask: "remote_runner_cancel_task",
  getTaskResume: "remote_runner_get_task_resume",
  continueTask: "remote_runner_continue_task",
  listEvents: "remote_runner_list_events",
  getDiff: "remote_runner_get_diff",
  listTaskFiles: "remote_runner_list_task_files",
  getTaskFileDiff: "remote_runner_get_task_file_diff",
  getAttachment: "remote_runner_get_attachment",
  readAttachment: "remote_runner_read_attachment",
  uploadAttachment: "remote_runner_upload_attachment",
} as const;

/** Tokens and transport ownership never cross this IPC boundary. */
export class TauriRemoteRunnerGateway implements R.RemoteRunnerGateway {
  constructor(private readonly invokeCommand: InvokeRemoteRunnerCommand = invoke) {}

  private async call<K extends keyof R.RemoteRunnerGateway>(
    operation: K,
    request?: Parameters<NonNullable<R.RemoteRunnerGateway[K]>>[0],
  ): Promise<Awaited<ReturnType<NonNullable<R.RemoteRunnerGateway[K]>>>> {
    try {
      validateRemoteRunnerValue(operation, "request", request);
    } catch (error) {
      throw new RemoteRunnerRequestRejectedError(
        error instanceof Error ? error.message : "Invalid remote runner request.",
      );
    }
    let result: unknown;
    try {
      result = await this.invokeCommand(
        REMOTE_RUNNER_COMMANDS[operation],
        request === undefined ? undefined : { request },
      );
    } catch (error) {
      const message =
        typeof error === "string" ? error : error instanceof Error ? error.message : "";
      if (/^Runner request failed \(HTTP (400|404|409|413|422)\)\.$/.test(message))
        throw new RemoteRunnerRequestRejectedError(message);
      throw error;
    }
    validateRemoteRunnerValue(operation, "response", result);
    return result as Awaited<ReturnType<NonNullable<R.RemoteRunnerGateway[K]>>>;
  }
  listServers() {
    return this.call("listServers");
  }
  connectServer(request: R.RemoteRunnerServerInput) {
    return this.call("connectServer", request);
  }
  disconnectServer(request: R.RemoteRunnerServerRequest) {
    return this.call("disconnectServer", request);
  }
  removeServer(request: R.RemoteRunnerServerRequest) {
    return this.call("removeServer", request);
  }
  getRunner(request: R.RemoteRunnerServerRequest) {
    return this.call("getRunner", request);
  }
  listProjects(request: R.RemoteRunnerServerRequest) {
    return this.call("listProjects", request);
  }
  cloneProject(request: R.RemoteRunnerCloneRequest) {
    return this.call("cloneProject", request);
  }
  getProjectClone(request: R.RemoteRunnerCloneJobRequest) {
    return this.call("getProjectClone", request);
  }
  cancelProjectClone(request: R.RemoteRunnerCloneJobRequest) {
    return this.call("cancelProjectClone", request);
  }
  listTasks(request: R.RemoteRunnerServerRequest & Readonly<{ after: number }>) {
    return this.call("listTasks", request);
  }
  createTask(request: R.RemoteRunnerCreateTaskRequest) {
    return this.call("createTask", request);
  }
  startTask(request: R.RemoteRunnerTaskRequest & Readonly<{ projectId: string }>) {
    return this.call("startTask", request);
  }
  getTask(request: R.RemoteRunnerTaskRequest) {
    return this.call("getTask", request);
  }
  getTaskResume(request: R.RemoteRunnerTaskRequest) {
    return this.call("getTaskResume", request);
  }
  continueTask(request: R.RemoteRunnerContinueTaskRequest) {
    return this.call("continueTask", request);
  }
  cancelTask(request: R.RemoteRunnerTaskRequest) {
    return this.call("cancelTask", request);
  }
  listEvents(request: R.RemoteRunnerTaskRequest & Readonly<{ after: number }>) {
    return this.call("listEvents", request);
  }
  listTaskFiles(request: R.RemoteRunnerTaskRequest) {
    return this.call("listTaskFiles", request);
  }
  async getTaskFileDiff(request: R.RemoteRunnerTaskFileDiffRequest) {
    const response = await this.call("getTaskFileDiff", request);
    if (response.path !== request.path) throw new Error("Runner returned a different file diff.");
    return response;
  }
  getDiff(request: R.RemoteRunnerTaskRequest) {
    return this.call("getDiff", request);
  }
  getAttachment(request: R.RemoteRunnerAttachmentRequest) {
    return this.call("getAttachment", request);
  }
  readAttachment(request: R.RemoteRunnerAttachmentRequest) {
    return this.call("readAttachment", request);
  }
  uploadAttachment(request: R.RemoteRunnerUploadRequest) {
    return this.call("uploadAttachment", request);
  }
}
