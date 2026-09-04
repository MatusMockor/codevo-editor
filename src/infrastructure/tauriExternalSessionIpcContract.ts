import type {
  ExternalAgentSessionHistory,
  ExternalSessionHistoryRequest,
  ExternalAgentSessionPreview,
  ExternalSessionListRequest,
  ExternalSessionListSnapshot,
  ExternalSessionPreviewRequest,
} from "../domain/externalAgentSession";
import {
  parseExternalAgentSessionHistory,
  isExternalSessionWithinRepository,
  parseExternalAgentSessionPreview,
  parseExternalSessionListSnapshot,
  validateExternalSessionId,
  validateExternalSessionProvider,
  validateExternalSessionRepositoryRoot,
} from "../domain/externalAgentSession";

export const LIST_EXTERNAL_AGENT_SESSIONS_IPC_COMMAND = "list_external_agent_sessions" as const;
export const PREVIEW_EXTERNAL_AGENT_SESSION_IPC_COMMAND = "preview_external_agent_session" as const;
export const READ_EXTERNAL_AGENT_SESSION_HISTORY_IPC_COMMAND =
  "read_external_agent_session_history" as const;

export function validateExternalSessionHistoryRequest(
  request: ExternalSessionHistoryRequest,
): ExternalSessionHistoryRequest {
  if (!Number.isSafeInteger(request.beforeEpochMs) || request.beforeEpochMs < 0) {
    throw new TypeError(
      "Invalid external agent session value at request.beforeEpochMs: expected a nonnegative safe integer.",
    );
  }
  const allowed = ["provider", "sessionId", "projectRoot", "repositoryRoot", "beforeEpochMs"];
  if (Object.keys(request).some((key) => !allowed.includes(key))) {
    throw new TypeError("Invalid external agent session history request: unexpected field.");
  }
  return {
    ...validateExternalSessionPreviewRequest(request),
    beforeEpochMs: request.beforeEpochMs,
  };
}

export async function invokeReadExternalAgentSessionHistoryIpc(
  invokeCommand: InvokeExternalSessionCommand,
  request: ExternalSessionHistoryRequest,
): Promise<ExternalAgentSessionHistory> {
  const validated = validateExternalSessionHistoryRequest(request);
  const history = parseExternalAgentSessionHistory(
    await invokeCommand(READ_EXTERNAL_AGENT_SESSION_HISTORY_IPC_COMMAND, { request: validated }),
    "result",
  );
  if (history.provider !== validated.provider || history.sessionId !== validated.sessionId) {
    throw new TypeError(
      "Invalid external agent session value at result: expected the requested session identity.",
    );
  }
  return history;
}

export type InvokeExternalSessionCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function validateExternalSessionListRequest(
  request: ExternalSessionListRequest,
): ExternalSessionListRequest {
  return {
    projectRoot: validateExternalSessionRepositoryRoot(request.projectRoot, "request.projectRoot"),
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
    projectRoot: validateExternalSessionRepositoryRoot(request.projectRoot, "request.projectRoot"),
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
