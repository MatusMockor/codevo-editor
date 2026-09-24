import { MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES } from "./agentShip";
import type { GitChangeStatus } from "./git";

export interface CommitMessageFile {
  readonly relativePath: string;
  readonly status: GitChangeStatus;
}

export interface CommitMessageInput {
  readonly files: ReadonlyArray<CommitMessageFile>;
  readonly threadTitle: string | null;
}

export type CommitMessageValidation =
  | { readonly kind: "ok"; readonly message: string }
  | { readonly kind: "invalid"; readonly reason: string };

export const COMMIT_MESSAGE_INVALID_REASON = `Enter a commit message of at most ${MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES} bytes.`;

const MAX_SUBJECT_CHARACTERS = 72;
const SOURCE_ROOTS = new Set(["src", "lib", "app", "test", "tests", "__tests__", "spec"]);
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const DOC_FILE = /(^|\/)docs\/|\.(md|mdx|txt|rst)$/i;
const CONFIG_FILE =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|\.github\/.*|[^/]*\.config\.[cm]?[jt]s|\.env[^/]*)$/;

export function generateCommitMessage(input: CommitMessageInput): string {
  const type = commitType(input.files);
  const scope = commitScope(input.files);
  const subject = commitSubject(input.files, input.threadTitle);
  if (scope === null) return `${type}: ${subject}`;
  return `${type}(${scope}): ${subject}`;
}

export function validateCommitMessage(message: string): CommitMessageValidation {
  const trimmed = message.trim();
  const invalid =
    trimmed.length === 0 ||
    trimmed.includes("\u0000") ||
    new TextEncoder().encode(trimmed).byteLength > MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES;
  if (invalid) return { kind: "invalid", reason: COMMIT_MESSAGE_INVALID_REASON };
  return { kind: "ok", message: trimmed };
}

function commitType(files: ReadonlyArray<CommitMessageFile>): string {
  const every = (pattern: RegExp) =>
    files.length > 0 && files.every((file) => pattern.test(file.relativePath));
  if (every(TEST_FILE)) return "test";
  if (every(DOC_FILE)) return "docs";
  if (every(CONFIG_FILE)) return "chore";
  if (files.some((file) => file.status === "added" || file.status === "untracked")) return "feat";
  return "fix";
}

function commitScope(files: ReadonlyArray<CommitMessageFile>): string | null {
  const scopes = new Set(files.map((file) => fileScope(file.relativePath)));
  if (scopes.size !== 1) return null;
  const [scope] = [...scopes];
  if (scope === undefined || scope.length === 0) return null;
  return scope;
}

function fileScope(relativePath: string): string {
  const segments = relativePath.split("/");
  const meaningful = segments.slice(0, -1).filter((segment) => !SOURCE_ROOTS.has(segment));
  if (meaningful.length > 0) return sanitizeScope(meaningful[0] ?? "");
  if (DOC_FILE.test(relativePath) || CONFIG_FILE.test(relativePath)) return "";
  const name = segments[segments.length - 1] ?? "";
  return sanitizeScope(name.replace(/\.(test|spec)(?=\.)/, "").replace(/\.[^.]+$/, ""));
}

function sanitizeScope(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function commitSubject(
  files: ReadonlyArray<CommitMessageFile>,
  threadTitle: string | null,
): string {
  const title = (threadTitle ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/, "");
  if (title.length > 0) return clipSubject(title.charAt(0).toLowerCase() + title.slice(1));
  if (files.length === 1) {
    const name = files[0]?.relativePath.split("/").pop() ?? "file";
    return clipSubject(`update ${name}`);
  }
  return `update ${files.length} files`;
}

function clipSubject(subject: string): string {
  if (subject.length <= MAX_SUBJECT_CHARACTERS) return subject;
  return subject.slice(0, MAX_SUBJECT_CHARACTERS).trimEnd();
}
