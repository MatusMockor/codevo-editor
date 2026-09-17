import { invoke } from "@tauri-apps/api/core";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceRequests,
  RemoteSurfaceResponses,
} from "../domain/remoteRunnerSurfaces";
import { validateRemoteSurface } from "../domain/remoteRunnerSurfaceValidation";
import type { InvokeRemoteRunnerCommand } from "./tauriRemoteRunnerGateway";
export class TauriRemoteRunnerSurfacesGateway implements RemoteRunnerSurfacesGateway {
  constructor(private readonly invokeCommand: InvokeRemoteRunnerCommand = invoke) {}
  private async call<K extends keyof RemoteSurfaceRequests>(
    operation: K,
    request: RemoteSurfaceRequests[K],
  ): Promise<RemoteSurfaceResponses[K]> {
    validateRemoteSurface(operation, "request", request);
    let result: unknown;
    try {
      result = await this.invokeCommand("remote_runner_surface", {
        request: { operation, ...request },
      });
    } catch (reason) {
      const message =
        typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "";
      if (operation === "writeFile" && message === "Runner request failed (HTTP 409).") {
        throw new Error(
          "The file or workspace changed on the server. Your edits are preserved. Compare with server before saving again.",
        );
      }
      throw new Error(
        message.length > 0 && message.length <= 1000
          ? message
          : "The server could not complete this operation.",
      );
    }
    validateRemoteSurface(operation, "response", result);
    const response = result as Readonly<Record<string, unknown>>;
    if (
      (operation === "openTerminal" ||
        operation === "pollTerminal" ||
        operation === "resizeTerminal") &&
      (response.projectId !== request.projectId ||
        response.taskId !== (request.taskId ?? null) ||
        ("terminalId" in request && response.id !== request.terminalId))
    ) {
      throw new Error("Remote terminal ownership changed.");
    }
    if (
      (operation === "readFile" || operation === "writeFile" || operation === "commitDiff") &&
      "path" in request &&
      response.path !== request.path
    ) {
      throw new Error("Remote file ownership changed.");
    }

    return result as RemoteSurfaceResponses[K];
  }
  capabilities(request: RemoteSurfaceRequests["capabilities"]) {
    return this.call("capabilities", request);
  }
  listDirectory(request: RemoteSurfaceRequests["listDirectory"]) {
    return this.call("listDirectory", request);
  }
  readFile(request: RemoteSurfaceRequests["readFile"]) {
    return this.call("readFile", request);
  }
  writeFile(request: RemoteSurfaceRequests["writeFile"]) {
    return this.call("writeFile", request);
  }
  history(request: RemoteSurfaceRequests["history"]) {
    return this.call("history", request);
  }
  commitFiles(request: RemoteSurfaceRequests["commitFiles"]) {
    return this.call("commitFiles", request);
  }
  commitDiff(request: RemoteSurfaceRequests["commitDiff"]) {
    return this.call("commitDiff", request);
  }
  openTerminal(request: RemoteSurfaceRequests["openTerminal"]) {
    return this.call("openTerminal", request);
  }
  pollTerminal(request: RemoteSurfaceRequests["pollTerminal"]) {
    return this.call("pollTerminal", request);
  }
  writeTerminal(request: RemoteSurfaceRequests["writeTerminal"]) {
    return this.call("writeTerminal", request);
  }
  resizeTerminal(request: RemoteSurfaceRequests["resizeTerminal"]) {
    return this.call("resizeTerminal", request);
  }
  closeTerminal(request: RemoteSurfaceRequests["closeTerminal"]) {
    return this.call("closeTerminal", request);
  }
}
