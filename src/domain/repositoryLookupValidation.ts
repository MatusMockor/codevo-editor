import { parseRepositoryCloneUrl } from "./repositoryCloneUrl";
import {
  isRepositoryHost,
  parseRepositoryPath,
  REPOSITORY_LOOKUP_LIMITS,
  REPOSITORY_PROVIDERS,
  type RepositoryHost,
  type RepositoryHostAuth,
  type RepositoryHostsFailureReason,
  type RepositoryHostsSnapshot,
  type RepositoryHostsState,
  type RepositoryInfo,
  type RepositoryLookupFailureReason,
  type RepositoryLookupOutcome,
  type RepositoryLookupRequest,
  type RepositoryProvider,
  type RepositoryVisibility,
} from "./repositoryLookup";

export const REPOSITORY_RETRY_AFTER_SECONDS_MAX = 86_400;
export const REPOSITORY_DEFAULT_BRANCH_CHARS = 255;

const HOSTS_FAILURE_REASONS = ["timedOut", "invalidOutput", "busy"] as const;
const LOOKUP_FAILURE_REASONS = [
  "network",
  "invalidOutput",
  "outputTooLarge",
  "busy",
  "unknown",
] as const;
const LOOKUP_PLAIN_STATUSES = [
  "notFound",
  "cliMissing",
  "notAuthenticated",
  "hostNotAllowed",
  "timedOut",
  "superseded",
] as const;
const REPOSITORY_VISIBILITIES = ["public", "private", "internal", "unknown"] as const;
const HOST_AUTH_VALUES = ["authenticated", "notAuthenticated"] as const;
const REPOSITORY_INFO_KEYS = [
  "provider",
  "host",
  "fullPath",
  "description",
  "visibility",
  "defaultBranch",
  "sshUrl",
  "httpsUrl",
] as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export function parseRepositoryHostsSnapshot(value: unknown): RepositoryHostsSnapshot {
  const snapshot = record(value, "hostsSnapshot");
  exactKeys(snapshot, REPOSITORY_PROVIDERS, "hostsSnapshot");
  return Object.freeze({
    github: hostsState(snapshot.github, "github"),
    gitlab: hostsState(snapshot.gitlab, "gitlab"),
  });
}

export function parseRepositoryLookupOutcome(value: unknown): RepositoryLookupOutcome {
  const outcome = record(value, "outcome");
  const status = outcome.status;
  if (status === "ok") {
    exactKeys(outcome, ["status", "repository"], "outcome");
    return Object.freeze({
      status: "ok",
      repository: repositoryInfo(outcome.repository, "outcome.repository"),
    });
  }
  if (isPlainStatus(status)) {
    exactKeys(outcome, ["status"], "outcome");
    return Object.freeze({ status });
  }
  if (status === "rateLimited") {
    exactKeys(outcome, ["status", "retryAfterSeconds"], "outcome");
    return Object.freeze({
      status: "rateLimited",
      retryAfterSeconds: retryAfterSeconds(outcome.retryAfterSeconds, "outcome.retryAfterSeconds"),
    });
  }
  if (status === "failed") {
    exactKeys(outcome, ["status", "reason"], "outcome");
    return Object.freeze({
      status: "failed",
      reason: choice<RepositoryLookupFailureReason>(
        outcome.reason,
        LOOKUP_FAILURE_REASONS,
        "outcome.reason",
      ),
    });
  }
  return invalid("outcome.status", "expected a known repository lookup status");
}

export function validateRepositoryLookupRequest(
  request: RepositoryLookupRequest,
): RepositoryLookupRequest {
  const value = record(request, "request");
  exactKeys(value, ["provider", "host", "path"], "request");
  const provider = choice<RepositoryProvider>(
    value.provider,
    REPOSITORY_PROVIDERS,
    "request.provider",
  );
  return Object.freeze({
    provider,
    host: host(value.host, "request.host"),
    path: normalizedPath(value.path, provider, "request.path"),
  });
}

function hostsState(value: unknown, provider: RepositoryProvider): RepositoryHostsState {
  const path = `hostsSnapshot.${provider}`;
  const state = record(value, path);
  const status = state.status;
  if (status === "ready") {
    exactKeys(state, ["status", "hosts", "truncated"], path);
    return Object.freeze({
      status: "ready",
      hosts: readyHosts(state.hosts, provider, `${path}.hosts`),
      truncated: boolean(state.truncated, `${path}.truncated`),
    });
  }
  if (status === "cliMissing") {
    exactKeys(state, ["status"], path);
    return Object.freeze({ status: "cliMissing" });
  }
  if (status === "failed") {
    exactKeys(state, ["status", "reason"], path);
    return Object.freeze({
      status: "failed",
      reason: choice<RepositoryHostsFailureReason>(
        state.reason,
        HOSTS_FAILURE_REASONS,
        `${path}.reason`,
      ),
    });
  }
  return invalid(`${path}.status`, "expected ready, cliMissing or failed");
}

function readyHosts(
  value: unknown,
  provider: RepositoryProvider,
  path: string,
): readonly RepositoryHost[] {
  if (!Array.isArray(value)) return invalid(path, "expected an array");
  if (value.length > REPOSITORY_LOOKUP_LIMITS.hostsPerProvider) {
    return invalid(path, `expected at most ${REPOSITORY_LOOKUP_LIMITS.hostsPerProvider} hosts`);
  }
  const hosts = value.map((item, index) => repositoryHost(item, provider, `${path}[${index}]`));
  if (new Set(hosts.map((item) => item.host)).size !== hosts.length) {
    return invalid(path, "expected unique hosts");
  }
  return Object.freeze(hosts);
}

function repositoryHost(
  value: unknown,
  provider: RepositoryProvider,
  path: string,
): RepositoryHost {
  const item = record(value, path);
  exactKeys(item, ["provider", "host", "auth"], path);
  if (item.provider !== provider) return invalid(`${path}.provider`, `expected ${provider}`);
  return Object.freeze({
    provider,
    host: host(item.host, `${path}.host`),
    auth: choice<RepositoryHostAuth>(item.auth, HOST_AUTH_VALUES, `${path}.auth`),
  });
}

function repositoryInfo(value: unknown, path: string): RepositoryInfo {
  const info = record(value, path);
  exactKeys(info, REPOSITORY_INFO_KEYS, path);
  const provider = choice<RepositoryProvider>(
    info.provider,
    REPOSITORY_PROVIDERS,
    `${path}.provider`,
  );
  return Object.freeze({
    provider,
    host: host(info.host, `${path}.host`),
    fullPath: normalizedPath(info.fullPath, provider, `${path}.fullPath`),
    description: description(info.description, `${path}.description`),
    visibility: choice<RepositoryVisibility>(
      info.visibility,
      REPOSITORY_VISIBILITIES,
      `${path}.visibility`,
    ),
    defaultBranch: defaultBranch(info.defaultBranch, `${path}.defaultBranch`),
    sshUrl: cloneUrl(info.sshUrl, "ssh", `${path}.sshUrl`),
    httpsUrl: cloneUrl(info.httpsUrl, "https", `${path}.httpsUrl`),
  });
}

function cloneUrl(value: unknown, protocol: "ssh" | "https", path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid(path, "expected a clone URL or null");
  if (parseRepositoryCloneUrl(value) === null) return invalid(path, "expected a valid clone URL");
  if (protocol === "https" && !value.startsWith("https://")) {
    return invalid(path, "expected an https clone URL");
  }
  if (protocol === "ssh" && value.startsWith("https://")) {
    return invalid(path, "expected an ssh clone URL");
  }
  return value;
}

function description(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid(path, "expected a description or null");
  if ([...value].length > REPOSITORY_LOOKUP_LIMITS.descriptionChars) {
    return invalid(
      path,
      `expected at most ${REPOSITORY_LOOKUP_LIMITS.descriptionChars} characters`,
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) return invalid(path, "expected printable characters");
  return value;
}

function defaultBranch(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid(path, "expected a branch name or null");
  if (value.length === 0 || value.length > REPOSITORY_DEFAULT_BRANCH_CHARS) {
    return invalid(path, `expected 1 to ${REPOSITORY_DEFAULT_BRANCH_CHARS} characters`);
  }
  if (/[\u0000- \u007f]/u.test(value)) return invalid(path, "expected no control characters");
  return value;
}

function normalizedPath(value: unknown, provider: RepositoryProvider, path: string): string {
  if (typeof value !== "string") return invalid(path, "expected a repository path string");
  const parsed = parseRepositoryPath(provider, value);
  if (parsed === null || parsed !== value) {
    return invalid(path, `expected a normalized ${provider} repository path`);
  }
  return parsed;
}

function host(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "expected a host string");
  if (!isRepositoryHost(value)) return invalid(path, "expected a bounded hostname");
  if (value !== value.toLowerCase()) return invalid(path, "expected a lowercase hostname");
  return value;
}

function retryAfterSeconds(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return invalid(path, "expected an integer or null");
  }
  if (value < 0 || value > REPOSITORY_RETRY_AFTER_SECONDS_MAX) {
    return invalid(path, `expected 0 to ${REPOSITORY_RETRY_AFTER_SECONDS_MAX}`);
  }
  return value;
}

function isPlainStatus(value: unknown): value is (typeof LOOKUP_PLAIN_STATUSES)[number] {
  return LOOKUP_PLAIN_STATUSES.some((status) => status === value);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "expected a boolean");
  return value;
}

function choice<T extends string>(value: unknown, values: readonly T[], path: string): T {
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) return invalid(path, `expected one of ${values.join(", ")}`);
  return match;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set<string>(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) invalid(`${path}.${key}`, "unexpected field");
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      invalid(`${path}.${key}`, "missing field");
  }
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid repository lookup value at ${path.slice(0, 120)}: ${expectation.slice(0, 120)}.`,
  );
}
