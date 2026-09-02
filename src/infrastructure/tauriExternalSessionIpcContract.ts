import type {
  ExternalAgentSessionPreview,
  ExternalSessionListRequest,
  ExternalSessionListSnapshot,
  ExternalSessionPreviewRequest,
} from "../domain/externalAgentSession";
import {
  isExternalSessionWithinRepository,
  parseExternalAgentSessionPreview,
  parseExternalSessionListSnapshot,
  validateExternalSessionId,
  validateExternalSessionProvider,
  validateExternalSessionRepositoryRoot,
} from "../domain/externalAgentSession";

export const LIST_EXTERNAL_AGENT_SESSIONS_IPC_COMMAND = "list_external_agent_sessions" as const;
export const PREVIEW_EXTERNAL_AGENT_SESSION_IPC_COMMAND = "preview_external_agent_session" as const;

export type InvokeExternalSessionCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function validateExternalSessionListRequest(
  request: ExternalSessionListRequest,
): ExternalSessionListRequest {
  return {
    repositoryRoot: validateExternalSessionRepositoryRoot(
      request.repositoryRoot,
      "request.repositoryRoot",
    ),
  };
}

export function validateExternalSessionPreviewRequest(
  request: ExternalSessionPreviewRequest,
): ExternalSessionPreviewRequest {
  return {
    provider: validateExternalSessionProvider(request.provider, "request.provider"),
    sessionId: validateExternalSessionId(request.sessionId, "request.sessionId"),
    repositoryRoot: validateExternalSessionRepositoryRoot(
      request.repositoryRoot,
      "request.repositoryRoot",
    ),
  };
}

export async function invokeListExternalAgentSessionsIpc(
  invokeCommand: InvokeExternalSessionCommand,
  request: ExternalSessionListRequest,
): Promise<ExternalSessionListSnapshot> {
  const validated = validateExternalSessionListRequest(request);
  const snapshot = parseExternalSessionListSnapshot(
    await invokeCommand(LIST_EXTERNAL_AGENT_SESSIONS_IPC_COMMAND, { request: validated }),
    "result",
  );
  for (const session of snapshot.sessions) {
    if (!isExternalSessionWithinRepository(session.cwd, validated.repositoryRoot)) {
      throw new TypeError(
        "Invalid external agent session value at result.sessions: expected the requested repository scope.",
      );
    }
  }
  return snapshot;
}

export async function invokePreviewExternalAgentSessionIpc(
  invokeCommand: InvokeExternalSessionCommand,
  request: ExternalSessionPreviewRequest,
): Promise<ExternalAgentSessionPreview> {
  const validated = validateExternalSessionPreviewRequest(request);
  const preview = parseExternalAgentSessionPreview(
    await invokeCommand(PREVIEW_EXTERNAL_AGENT_SESSION_IPC_COMMAND, { request: validated }),
    "result",
  );
  if (preview.provider !== validated.provider || preview.sessionId !== validated.sessionId) {
    throw new TypeError(
      "Invalid external agent session value at result: expected the requested session identity.",
    );
  }
  return preview;
}
