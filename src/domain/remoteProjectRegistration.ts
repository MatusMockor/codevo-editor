import { isRemoteProjectDirectoryPath } from "./remoteProjectManagement";

export const REMOTE_PROJECT_NAME_CHARS = 64;
export const REMOTE_PROJECT_DISPLAY_NAME_BYTES = 256;

export const REMOTE_PROJECT_REGISTRATION_REJECTIONS = [
  "not_git_root",
  "name_taken",
  "limit_reached",
  "not_allowed",
] as const;

export type RemoteProjectRegistrationRejection =
  (typeof REMOTE_PROJECT_REGISTRATION_REJECTIONS)[number];

export type RemoteProjectRegistrationInput = Readonly<{ path: string; name: string }>;

export type RemoteProjectRegistration =
  | Readonly<{
      status: "registered";
      project: Readonly<{ id: string; name: string }>;
      created: boolean;
    }>
  | Readonly<{ status: "rejected"; reason: RemoteProjectRegistrationRejection }>;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REGISTERED_KEYS: readonly string[] = ["status", "project", "created"];
const REJECTED_KEYS: readonly string[] = ["status", "reason"];
const PROJECT_KEYS: readonly string[] = ["id", "name"];
const REJECTIONS: ReadonlySet<unknown> = new Set(REMOTE_PROJECT_REGISTRATION_REJECTIONS);
const UTF8_ENCODER = new TextEncoder();

export function isRemoteProjectName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value);
}

export function isRemoteProjectRegistrationPath(value: unknown): value is string {
  return isRemoteProjectDirectoryPath(value) && value !== "/";
}

export function isRemoteProjectRegistrationInput(
  value: unknown,
): value is RemoteProjectRegistrationInput {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "name"])) return false;
  return isRemoteProjectRegistrationPath(value.path) && isRemoteProjectName(value.name);
}

export function isRemoteProjectRegistration(value: unknown): value is RemoteProjectRegistration {
  if (!isRecord(value)) return false;
  if (value.status === "registered") {
    return (
      hasExactKeys(value, REGISTERED_KEYS) &&
      typeof value.created === "boolean" &&
      isRegisteredProject(value.project)
    );
  }
  if (value.status === "rejected") {
    return hasExactKeys(value, REJECTED_KEYS) && REJECTIONS.has(value.reason);
  }
  return false;
}

export function remoteProjectNameFromPath(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  const last = segments[segments.length - 1] ?? "";
  return last
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, REMOTE_PROJECT_NAME_CHARS);
}

function isRegisteredProject(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, PROJECT_KEYS)) return false;
  return isRemoteProjectName(value.id) && isProjectDisplayName(value.name);
}

function isProjectDisplayName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("\0") &&
    UTF8_ENCODER.encode(value).length <= REMOTE_PROJECT_DISPLAY_NAME_BYTES
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}
