import { validateGitBaseRef } from "../domain/gitBranchDiff";
import {
  parsePullRequestContext,
  parsePullRequestReceipt,
  validatePullRequestBody,
  validatePullRequestTitle,
  type CreatePullRequestRequest,
  type PullRequestContext,
  type PullRequestContextRequest,
  type PullRequestReceipt,
} from "../domain/pullRequest";
import { wireBoolean } from "../domain/wireValue";
import { validateGitSurfaceTargetRequest } from "./tauriGitSurfaceIpcContract";

export const GET_PULL_REQUEST_CONTEXT_IPC_COMMAND = "get_pull_request_context" as const;
export const CREATE_PULL_REQUEST_IPC_COMMAND = "create_pull_request" as const;

export type InvokePullRequestCommand = (
  command: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export function validatePullRequestContextRequest(
  request: PullRequestContextRequest,
): PullRequestContextRequest {
  return {
    ...validateGitSurfaceTargetRequest(request),
    base: request.base === null ? null : validateGitBaseRef(request.base),
  };
}

export function validateCreatePullRequestRequest(
  request: CreatePullRequestRequest,
): CreatePullRequestRequest {
  const target = validateGitSurfaceTargetRequest(request);
  const base = validateGitBaseRef(request.base);
  const title = validatePullRequestTitle(request.title);
  if (title.kind === "invalid") {
    throw new TypeError(title.reason);
  }
  const body = validatePullRequestBody(request.body);
  if (body.kind === "invalid") {
    throw new TypeError(body.reason);
  }
  return {
    ...target,
    base,
    title: title.title,
    body: body.body,
    draft: wireBoolean(request.draft, "request.draft"),
  };
}

export async function invokeGetPullRequestContextIpc(
  invoke: InvokePullRequestCommand,
  request: PullRequestContextRequest,
): Promise<PullRequestContext> {
  const validated = validatePullRequestContextRequest(request);
  return parsePullRequestContext(
    await invoke(GET_PULL_REQUEST_CONTEXT_IPC_COMMAND, { request: validated }),
  );
}

export async function invokeCreatePullRequestIpc(
  invoke: InvokePullRequestCommand,
  request: CreatePullRequestRequest,
): Promise<PullRequestReceipt> {
  const validated = validateCreatePullRequestRequest(request);
  return parsePullRequestReceipt(
    await invoke(CREATE_PULL_REQUEST_IPC_COMMAND, { request: validated }),
  );
}
