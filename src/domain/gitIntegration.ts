export const MAX_GIT_INTEGRATION_CONFLICT_FILES = 200;
export const MAX_GIT_INTEGRATION_REMOTE_BYTES = 128;
export const MAX_GIT_INTEGRATION_URL_BYTES = 2_048;
export const MAX_GIT_INTEGRATION_BRANCH_BYTES = 512;
export const MAX_GIT_INTEGRATION_PATH_BYTES = 4_096;
export const MAX_GIT_INTEGRATION_MESSAGE_BYTES = 1_024;
export const MAX_GIT_INTEGRATION_CHANGE_COUNT = 10_000;
export const MAX_GIT_INTEGRATION_COUNT = 1_000_000;
export const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const GIT_REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const GIT_COMPARE_URL_HOSTS = ["github.com", "gitlab.com", "bitbucket.org"] as const;

export type GitCompareUrlHost = (typeof GIT_COMPARE_URL_HOSTS)[number];

const CONTROL_CHARACTERS = /\p{Cc}/u;
const MULTILINE_CONTROL_CHARACTERS = /[^\P{Cc}\n]/u;

export interface GitShipWorktreeStatus {
  readonly branch: string;
  readonly head: string;
  readonly dirty: boolean;
  readonly changeCount: number;
}

export interface GitShipPrimaryStatus {
  readonly branch: string | null;
  readonly head: string;
  readonly dirty: boolean;
}

export interface GitShipRelation {
  readonly aheadOfPrimary: number;
  readonly behindPrimary: number;
  readonly fastForwardable: boolean;
}

export interface GitShipUpstream {
  readonly ahead: number;
  readonly behind: number;
}

export interface GitShipRemote {
  readonly name: string;
  readonly upstream: GitShipUpstream | null;
  readonly compareUrl: string | null;
}

export interface GitShipStatus {
  readonly worktree: GitShipWorktreeStatus;
  readonly primary: GitShipPrimaryStatus;
  readonly relation: GitShipRelation;
  readonly remote: GitShipRemote | null;
}

export type GitIntegrationMode = "fastForward" | "merge";

export type GitIntegrationOutcome =
  | { readonly kind: "integrated"; readonly mergeSha: string; readonly intoBranch: string }
  | {
      readonly kind: "conflicted";
      readonly files: ReadonlyArray<string>;
      readonly truncated: boolean;
    }
  | { readonly kind: "primaryDirty" }
  | { readonly kind: "primaryDetached" }
  | { readonly kind: "staleExpectation" }
  | { readonly kind: "notFastForward" }
  | { readonly kind: "abortFailed"; readonly message: string };

export interface GitPushReceipt {
  readonly remote: string;
  readonly branch: string;
  readonly compareUrl: string | null;
}

export interface GitShipStatusRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export interface GitPushBranchRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export interface GitIntegrateBranchRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly mode: GitIntegrationMode;
  readonly expectedPrimaryBranch: string;
  readonly expectedPrimaryHead: string;
  readonly expectedBranchHead: string;
  readonly mergeMessage: string;
}

export interface GitIntegrationGateway {
  getShipStatus(request: GitShipStatusRequest): Promise<GitShipStatus>;
  pushBranchUpstream(request: GitPushBranchRequest): Promise<GitPushReceipt>;
  integrateWorktreeBranch(request: GitIntegrateBranchRequest): Promise<GitIntegrationOutcome>;
}

export function parseGitShipStatus(value: unknown, path = "shipStatus"): GitShipStatus {
  const status = record(value, path);
  exactKeys(status, ["worktree", "primary", "relation", "remote"], path);
  return {
    worktree: parseWorktreeStatus(status.worktree, `${path}.worktree`),
    primary: parsePrimaryStatus(status.primary, `${path}.primary`),
    relation: parseRelation(status.relation, `${path}.relation`),
    remote: parseRemote(status.remote, `${path}.remote`),
  };
}

export function parseGitPushReceipt(value: unknown, path = "pushReceipt"): GitPushReceipt {
  const receipt = record(value, path);
  exactKeys(receipt, ["remote", "branch", "compareUrl"], path);
  return {
    remote: remoteName(receipt.remote, `${path}.remote`),
    branch: branchName(receipt.branch, `${path}.branch`),
    compareUrl: nullableCompareUrl(receipt.compareUrl, `${path}.compareUrl`),
  };
}

export function parseGitIntegrationOutcome(
  value: unknown,
  path = "integrationOutcome",
): GitIntegrationOutcome {
  const outcome = record(value, path);
  const kind = outcomeKind(outcome.kind, `${path}.kind`);
  switch (kind) {
    case "integrated":
      exactKeys(outcome, ["kind", "mergeSha", "intoBranch"], path);
      return {
        kind,
        mergeSha: sha(outcome.mergeSha, `${path}.mergeSha`),
        intoBranch: branchName(outcome.intoBranch, `${path}.intoBranch`),
      };
    case "conflicted":
      exactKeys(outcome, ["kind", "files", "truncated"], path);
      return {
        kind,
        files: conflictFiles(outcome.files, `${path}.files`),
        truncated: boolean(outcome.truncated, `${path}.truncated`),
      };
    case "primaryDirty":
    case "primaryDetached":
    case "staleExpectation":
    case "notFastForward":
      exactKeys(outcome, ["kind"], path);
      return { kind };
    case "abortFailed":
      exactKeys(outcome, ["kind", "message"], path);
      return {
        kind,
        message: boundedMultilineText(
          outcome.message,
          `${path}.message`,
          MAX_GIT_INTEGRATION_MESSAGE_BYTES,
        ),
      };
    default:
      return unsupportedOutcomeKind(kind);
  }
}

export function validateGitIntegrationRepositoryRoot(value: unknown): string {
  return boundedPath(value, "repositoryRoot");
}

export function validateGitIntegrationWorktreePath(value: unknown): string {
  return boundedPath(value, "worktreePath");
}

export function validateOptionalGitIntegrationWorktreePath(value: unknown): string | null {
  if (value === null) return null;
  return boundedPath(value, "worktreePath");
}

export function validateGitIntegrationMode(value: unknown): GitIntegrationMode {
  if (value !== "fastForward" && value !== "merge") invalid("mode", "fastForward or merge");
  return value;
}

export function validateGitIntegrationBranch(value: unknown, path = "branch"): string {
  return branchName(value, path);
}

export function validateGitIntegrationSha(value: unknown, path = "sha"): string {
  return sha(value, path);
}

export function validateGitMergeMessage(value: unknown, path = "mergeMessage"): string {
  const message = boundedMultilineText(value, path, MAX_GIT_INTEGRATION_MESSAGE_BYTES);
  if (message.trim() === "") invalid(path, "a non-blank bounded merge message");
  return message;
}

function parseWorktreeStatus(value: unknown, path: string): GitShipWorktreeStatus {
  const worktree = record(value, path);
  exactKeys(worktree, ["branch", "head", "dirty", "changeCount"], path);
  return {
    branch: branchName(worktree.branch, `${path}.branch`),
    head: sha(worktree.head, `${path}.head`),
    dirty: boolean(worktree.dirty, `${path}.dirty`),
    changeCount: boundedCount(
      worktree.changeCount,
      `${path}.changeCount`,
      MAX_GIT_INTEGRATION_CHANGE_COUNT,
    ),
  };
}

function parsePrimaryStatus(value: unknown, path: string): GitShipPrimaryStatus {
  const primary = record(value, path);
  exactKeys(primary, ["branch", "head", "dirty"], path);
  return {
    branch: nullableBranchName(primary.branch, `${path}.branch`),
    head: sha(primary.head, `${path}.head`),
    dirty: boolean(primary.dirty, `${path}.dirty`),
  };
}

function parseRelation(value: unknown, path: string): GitShipRelation {
  const relation = record(value, path);
  exactKeys(relation, ["aheadOfPrimary", "behindPrimary", "fastForwardable"], path);
  return {
    aheadOfPrimary: boundedCount(
      relation.aheadOfPrimary,
      `${path}.aheadOfPrimary`,
      MAX_GIT_INTEGRATION_COUNT,
    ),
    behindPrimary: boundedCount(
      relation.behindPrimary,
      `${path}.behindPrimary`,
      MAX_GIT_INTEGRATION_COUNT,
    ),
    fastForwardable: boolean(relation.fastForwardable, `${path}.fastForwardable`),
  };
}

function parseRemote(value: unknown, path: string): GitShipRemote | null {
  if (value === null) return null;
  const remote = record(value, path);
  exactKeys(remote, ["name", "upstream", "compareUrl"], path);
  return {
    name: remoteName(remote.name, `${path}.name`),
    upstream: parseUpstream(remote.upstream, `${path}.upstream`),
    compareUrl: nullableCompareUrl(remote.compareUrl, `${path}.compareUrl`),
  };
}

function parseUpstream(value: unknown, path: string): GitShipUpstream | null {
  if (value === null) return null;
  const upstream = record(value, path);
  exactKeys(upstream, ["ahead", "behind"], path);
  return {
    ahead: boundedCount(upstream.ahead, `${path}.ahead`, MAX_GIT_INTEGRATION_COUNT),
    behind: boundedCount(upstream.behind, `${path}.behind`, MAX_GIT_INTEGRATION_COUNT),
  };
}

function conflictFiles(value: unknown, path: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > MAX_GIT_INTEGRATION_CONFLICT_FILES) {
    invalid(path, `an array of at most ${MAX_GIT_INTEGRATION_CONFLICT_FILES} paths`);
  }
  return value.map((entry, index) => boundedPath(entry, `${path}[${index}]`));
}

function outcomeKind(value: unknown, path: string): GitIntegrationOutcome["kind"] {
  if (
    value !== "integrated" &&
    value !== "conflicted" &&
    value !== "primaryDirty" &&
    value !== "primaryDetached" &&
    value !== "staleExpectation" &&
    value !== "notFastForward" &&
    value !== "abortFailed"
  ) {
    invalid(path, "a supported git integration outcome kind");
  }
  return value;
}

function nullableCompareUrl(value: unknown, path: string): string | null {
  if (value === null) return null;
  const candidate = boundedText(value, path, MAX_GIT_INTEGRATION_URL_BYTES);
  const url = parsedUrl(candidate, path);
  if (url.protocol !== "https:") invalid(path, "an https compare URL");
  if (url.username !== "" || url.password !== "") {
    invalid(path, "a compare URL without embedded credentials");
  }
  if (url.port !== "") invalid(path, "a compare URL without an explicit port");
  if (!isCompareUrlHost(url.hostname)) {
    invalid(path, `a compare URL hosted on ${GIT_COMPARE_URL_HOSTS.join(", ")}`);
  }
  return candidate;
}

function isCompareUrlHost(hostname: string): hostname is GitCompareUrlHost {
  return (GIT_COMPARE_URL_HOSTS as ReadonlyArray<string>).includes(hostname);
}

function parsedUrl(candidate: string, path: string): URL {
  try {
    return new URL(candidate);
  } catch {
    return invalid(path, "an absolute URL");
  }
}

function nullableBranchName(value: unknown, path: string): string | null {
  if (value === null) return null;
  return branchName(value, path);
}

function branchName(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_GIT_INTEGRATION_BRANCH_BYTES);
  if (candidate.trim() !== candidate || candidate === "") {
    invalid(path, "a trimmed non-empty branch name");
  }
  if (candidate.startsWith("-") || candidate.includes("@{") || candidate.includes("..")) {
    invalid(path, "a branch name without option or revision syntax");
  }
  return candidate;
}

function remoteName(value: unknown, path: string): string {
  if (typeof value !== "string" || !GIT_REMOTE_NAME_PATTERN.test(value)) {
    invalid(path, `a safe remote name of at most ${MAX_GIT_INTEGRATION_REMOTE_BYTES} bytes`);
  }
  return value;
}

function sha(value: unknown, path: string): string {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) {
    invalid(path, "a 40 character lowercase hexadecimal object id");
  }
  return value;
}

function boundedCount(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    invalid(path, `an integer between 0 and ${maximum}`);
  }
  return value as number;
}

function boundedPath(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_GIT_INTEGRATION_PATH_BYTES);
  if (candidate.trim() === "") invalid(path, "a non-blank bounded path");
  return candidate;
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    CONTROL_CHARACTERS.test(value) ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    invalid(path, `a non-empty control-free string of at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function boundedMultilineText(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    MULTILINE_CONTROL_CHARACTERS.test(value) ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    invalid(path, `a non-empty bounded string of at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function unsupportedOutcomeKind(kind: never): never {
  throw new TypeError(`Unsupported git integration outcome kind: ${String(kind)}.`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid Git integration value at ${path}: expected ${expectation}.`);
}
