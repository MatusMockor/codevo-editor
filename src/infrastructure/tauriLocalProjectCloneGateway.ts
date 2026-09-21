import { invoke } from "@tauri-apps/api/core";
import type { LocalProjectCloneGateway } from "../application/ports/localProjectCloneGateway";
import {
  parseLocalProjectCloneJobRequest,
  parseLocalProjectCloneRequest,
  parseLocalProjectCloneSnapshot,
  type LocalProjectCloneJobRequest,
  type LocalProjectCloneRequest,
  type LocalProjectCloneSnapshot,
} from "../domain/localProjectClone";

export type LocalProjectCloneCommand = (
  command: string,
  args: { readonly request: LocalProjectCloneRequest | LocalProjectCloneJobRequest },
) => Promise<unknown>;

export class TauriLocalProjectCloneGateway implements LocalProjectCloneGateway {
  constructor(private readonly invokeCommand: LocalProjectCloneCommand = invoke) {}

  async start(request: LocalProjectCloneRequest): Promise<LocalProjectCloneSnapshot> {
    const parsed = parseLocalProjectCloneRequest(request);
    return this.call("local_clone_project", parsed, parsed.idempotencyKey);
  }

  async get(request: LocalProjectCloneJobRequest): Promise<LocalProjectCloneSnapshot> {
    const parsed = parseLocalProjectCloneJobRequest(request);
    return this.call("local_get_project_clone", parsed, parsed.cloneId);
  }

  async cancel(request: LocalProjectCloneJobRequest): Promise<LocalProjectCloneSnapshot> {
    const parsed = parseLocalProjectCloneJobRequest(request);
    return this.call("local_cancel_project_clone", parsed, parsed.cloneId);
  }

  private async call(
    command: string,
    request: LocalProjectCloneRequest | LocalProjectCloneJobRequest,
    expectedId: string,
  ): Promise<LocalProjectCloneSnapshot> {
    const result = parseLocalProjectCloneSnapshot(await this.invokeCommand(command, { request }));
    if (result.cloneId !== expectedId)
      throw new Error("Local clone response belongs to another job.");
    return result;
  }
}
