import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  GIT_COMPARE_URL_HOSTS,
  MAX_GIT_INTEGRATION_URL_BYTES,
  type GitIntegrateBranchRequest,
  type GitIntegrationGateway,
  type GitIntegrationOutcome,
  type GitPushBranchRequest,
  type GitPushReceipt,
  type GitShipStatus,
  type GitShipStatusRequest,
} from "../domain/gitIntegration";
import {
  GIT_INTEGRATION_FAILURE_PREFIXES,
  invokeGetGitShipStatusIpc,
  invokeIntegrateGitWorktreeBranchIpc,
  invokePushGitBranchUpstreamIpc,
  type GitIntegrationFailurePrefix,
  type InvokeGitIntegrationCommand,
} from "./tauriGitIntegrationIpcContract";

export const GIT_INTEGRATION_UNAVAILABLE_ERROR = "Git unavailable.";
export const GIT_PUSH_FAILURE_ERROR_NAME = "GitPushFailureError";
export const COMPARE_URL_OPEN_FAILED = "Unable to open the compare page.";
export const MAX_GIT_PUSH_FAILURE_MESSAGE_BYTES = 1_024;

export type GitPushFailureReason = "noRemote" | "rejected" | "authRequired" | "gitError";

export class GitPushFailureError extends Error {
  constructor(
    readonly reason: GitPushFailureReason,
    message: string,
  ) {
    super(message);
    this.name = GIT_PUSH_FAILURE_ERROR_NAME;
  }
}

export interface ExternalUrlOpener {
  openExternal(url: string): Promise<void>;
}

type RuntimeDetector = () => boolean;
type OpenUrl = (url: string) => Promise<void>;

const invokeGitIntegrationCommand: InvokeGitIntegrationCommand = (command, args) =>
  invoke(command, args);

const openWithTauri: OpenUrl = async (url) => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
};

export class TauriGitIntegrationGateway implements GitIntegrationGateway {
  constructor(
    private readonly invokeCommand: InvokeGitIntegrationCommand = invokeGitIntegrationCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async getShipStatus(request: GitShipStatusRequest): Promise<GitShipStatus> {
    this.ensureRuntime();
    return invokeGetGitShipStatusIpc(this.invokeCommand, request);
  }

  async pushBranchUpstream(request: GitPushBranchRequest): Promise<GitPushReceipt> {
    this.ensureRuntime();
    try {
      return await invokePushGitBranchUpstreamIpc(this.invokeCommand, request);
    } catch (error) {
      throw classifyPushFailure(error);
    }
  }

  async integrateWorktreeBranch(
    request: GitIntegrateBranchRequest,
  ): Promise<GitIntegrationOutcome> {
    this.ensureRuntime();
    return invokeIntegrateGitWorktreeBranchIpc(this.invokeCommand, request);
  }

  private ensureRuntime(): void {
    if (this.isRuntimeAvailable()) return;
    throw new Error(GIT_INTEGRATION_UNAVAILABLE_ERROR);
  }
}

export class TauriCompareUrlOpener implements ExternalUrlOpener {
  constructor(private readonly openUrl: OpenUrl = openWithTauri) {}

  async openExternal(url: string): Promise<void> {
    if (!isCompareUrl(url)) throw new Error(COMPARE_URL_OPEN_FAILED);
    try {
      await this.openUrl(url);
    } catch {
      throw new Error(COMPARE_URL_OPEN_FAILED);
    }
  }
}

export function classifyPushFailure(error: unknown): GitPushFailureError {
  if (error instanceof GitPushFailureError) return error;
  if (error instanceof TypeError)
    return new GitPushFailureError("gitError", boundedMessage(error.message));
  const raw = rawMessage(error);
  const prefix = GIT_INTEGRATION_FAILURE_PREFIXES.find((candidate) => raw.startsWith(candidate));
  if (prefix === undefined) return new GitPushFailureError("gitError", boundedMessage(raw));
  return new GitPushFailureError(
    reasonFor(prefix),
    boundedMessage(raw.slice(prefix.length).trim()),
  );
}

function reasonFor(prefix: GitIntegrationFailurePrefix): GitPushFailureReason {
  switch (prefix) {
    case "noRemote:":
      return "noRemote";
    case "rejected:":
      return "rejected";
    case "authRequired:":
      return "authRequired";
    case "gitError:":
      return "gitError";
    default:
      return unsupportedPrefix(prefix);
  }
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function boundedMessage(message: string): string {
  const sanitized = message.replace(/[^\P{Cc}\n]/gu, "").trim();
  const encoded = new TextEncoder().encode(sanitized);
  if (encoded.byteLength <= MAX_GIT_PUSH_FAILURE_MESSAGE_BYTES) return sanitized;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(encoded.subarray(0, MAX_GIT_PUSH_FAILURE_MESSAGE_BYTES))
    .replace(/�+$/u, "");
}

function isCompareUrl(url: string): boolean {
  if (new TextEncoder().encode(url).byteLength > MAX_GIT_INTEGRATION_URL_BYTES) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return false;
  return (GIT_COMPARE_URL_HOSTS as ReadonlyArray<string>).includes(parsed.hostname);
}

function unsupportedPrefix(prefix: never): never {
  throw new TypeError(`Unsupported git integration failure prefix: ${String(prefix)}.`);
}
