import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ExternalSessionGateway } from "../application/agentThreadPorts";
import type {
  ExternalAgentSessionPreview,
  ExternalSessionListRequest,
  ExternalSessionListSnapshot,
  ExternalSessionPreviewRequest,
} from "../domain/externalAgentSession";
import {
  invokeListExternalAgentSessionsIpc,
  invokePreviewExternalAgentSessionIpc,
  validateExternalSessionListRequest,
  validateExternalSessionPreviewRequest,
  type InvokeExternalSessionCommand,
} from "./tauriExternalSessionIpcContract";

export const MAX_EXTERNAL_SESSION_ERROR_CHARS = 240;
export const EXTERNAL_SESSION_GENERIC_ERROR = "The external agent session request failed.";

export type ExternalSessionRuntimeDetector = () => boolean;

const invokeExternalSessionCommand: InvokeExternalSessionCommand = (command, args) =>
  invoke(command, args);

const EMPTY_SNAPSHOT: ExternalSessionListSnapshot = Object.freeze({
  sessions: Object.freeze([]),
  skipped: 0,
  truncated: false,
});

export class TauriExternalSessionGateway implements ExternalSessionGateway {
  constructor(
    private readonly invokeCommand: InvokeExternalSessionCommand = invokeExternalSessionCommand,
    private readonly isRuntimeAvailable: ExternalSessionRuntimeDetector = isTauri,
  ) {}

  async listExternalSessions(
    request: ExternalSessionListRequest,
  ): Promise<ExternalSessionListSnapshot> {
    const validated = validateExternalSessionListRequest(request);
    if (!this.isRuntimeAvailable()) return EMPTY_SNAPSHOT;
    try {
      return await invokeListExternalAgentSessionsIpc(this.invokeCommand, validated);
    } catch (error) {
      throw boundedExternalSessionError(error);
    }
  }

  async previewExternalSession(
    request: ExternalSessionPreviewRequest,
  ): Promise<ExternalAgentSessionPreview> {
    const validated = validateExternalSessionPreviewRequest(request);
    if (!this.isRuntimeAvailable()) return emptyExternalSessionPreview(validated);
    try {
      return await invokePreviewExternalAgentSessionIpc(this.invokeCommand, validated);
    } catch (error) {
      throw boundedExternalSessionError(error);
    }
  }
}

export function boundedExternalSessionError(error: unknown): Error {
  const message = externalSessionErrorMessage(error);
  if (message === "") return new Error(EXTERNAL_SESSION_GENERIC_ERROR);
  return new Error(message.slice(0, MAX_EXTERNAL_SESSION_ERROR_CHARS));
}

function externalSessionErrorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  return "";
}

function emptyExternalSessionPreview(
  request: ExternalSessionPreviewRequest,
): ExternalAgentSessionPreview {
  return {
    provider: request.provider,
    sessionId: request.sessionId,
    exchanges: [],
    exchangesTruncated: false,
    totalPreviewBytes: 0,
  };
}
