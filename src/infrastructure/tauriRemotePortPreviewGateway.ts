import { invoke } from "@tauri-apps/api/core";
import {
  parseRemotePortListing,
  remotePortErrorMessage,
  type RemotePortPreviewPort,
} from "../domain/remotePortPreview";
import {
  isRemotePortCloseRequest,
  isRemotePortListRequest,
  isRemotePortOpenRequest,
  isRemotePortOpenResponse,
  isRemotePortReleaseOwnerRequest,
  type RemotePortCloseRequest,
  type RemotePortListing,
  type RemotePortListRequest,
  type RemotePortOpenRequest,
  type RemotePortOpenResponse,
  type RemotePortReleaseOwnerRequest,
} from "../domain/remotePortPreviewWire";
import type { WireCheck } from "../domain/remoteWireChecks";
import type { InvokeRemoteRunnerCommand } from "./tauriRemoteRunnerGateway";

export const REMOTE_PORT_PREVIEW_COMMANDS = Object.freeze({
  list: "remote_port_list",
  open: "remote_port_open",
  close: "remote_port_close",
  releaseOwner: "remote_port_release_owner",
});

const INVALID_REQUEST = "Invalid server port request.";
const INVALID_RESPONSE = "Invalid server port response.";

const isEmptyResponse: WireCheck = (value) => value === null || value === undefined;

export class TauriRemotePortPreviewGateway implements RemotePortPreviewPort {
  constructor(private readonly invokeCommand: InvokeRemoteRunnerCommand = invoke) {}

  private async call(
    command: string,
    request: unknown,
    isRequest: WireCheck,
    isResponse: WireCheck,
  ): Promise<unknown> {
    if (!isRequest(request)) throw new Error(INVALID_REQUEST);
    let result: unknown;
    try {
      result = await this.invokeCommand(command, { request });
    } catch (reason) {
      throw new Error(remotePortErrorMessage(reason));
    }
    if (!isResponse(result)) throw new Error(INVALID_RESPONSE);
    return result;
  }

  async list(request: RemotePortListRequest): Promise<RemotePortListing> {
    const result = await this.call(
      REMOTE_PORT_PREVIEW_COMMANDS.list,
      request,
      isRemotePortListRequest,
      () => true,
    );
    return parseRemotePortListing(result);
  }

  async open(request: RemotePortOpenRequest): Promise<RemotePortOpenResponse> {
    const result = await this.call(
      REMOTE_PORT_PREVIEW_COMMANDS.open,
      request,
      isRemotePortOpenRequest,
      isRemotePortOpenResponse,
    );
    return result as RemotePortOpenResponse;
  }

  async close(request: RemotePortCloseRequest): Promise<void> {
    await this.call(
      REMOTE_PORT_PREVIEW_COMMANDS.close,
      request,
      isRemotePortCloseRequest,
      isEmptyResponse,
    );
  }

  async releaseOwner(request: RemotePortReleaseOwnerRequest): Promise<void> {
    await this.call(
      REMOTE_PORT_PREVIEW_COMMANDS.releaseOwner,
      request,
      isRemotePortReleaseOwnerRequest,
      isEmptyResponse,
    );
  }
}
