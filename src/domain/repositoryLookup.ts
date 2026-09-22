export const REPOSITORY_LOOKUP_LIMITS = {
  pathChars: 255,
  queryChars: 100,
  searchPageSize: 20,
  searchMaxPages: 10,
  hostsPerProvider: 8,
  hostChars: 253,
  descriptionChars: 200,
} as const;

export const REPOSITORY_PROVIDERS = ["github", "gitlab"] as const;

export type RepositoryProvider = (typeof REPOSITORY_PROVIDERS)[number];

export const REPOSITORY_PATH_SEGMENT_LIMITS = {
  github: { min: 2, max: 2 },
  gitlab: { min: 2, max: 20 },
} as const satisfies Readonly<Record<RepositoryProvider, Readonly<{ min: number; max: number }>>>;

export type RemoteProjectSourceKind = "serverProject" | "gitUrl" | RepositoryProvider;

export type RepositoryHostAuth = "authenticated" | "notAuthenticated";

export type RepositoryHost = Readonly<{
  provider: RepositoryProvider;
  host: string;
  auth: RepositoryHostAuth;
}>;

export type RepositoryHostsFailureReason = "timedOut" | "invalidOutput" | "busy";

export type RepositoryHostsState =
  | Readonly<{ status: "ready"; hosts: readonly RepositoryHost[]; truncated: boolean }>
  | Readonly<{ status: "cliMissing" }>
  | Readonly<{ status: "failed"; reason: RepositoryHostsFailureReason }>;

export type RepositoryHostsSnapshot = Readonly<Record<RepositoryProvider, RepositoryHostsState>>;

export type RepositoryLookupRequest = Readonly<{
  provider: RepositoryProvider;
  host: string;
  path: string;
}>;

export type RepositoryVisibility = "public" | "private" | "internal" | "unknown";

export type RepositoryInfo = Readonly<{
  provider: RepositoryProvider;
  host: string;
  fullPath: string;
  description: string | null;
  visibility: RepositoryVisibility;
  defaultBranch: string | null;
  sshUrl: string | null;
  httpsUrl: string | null;
}>;

export type RepositoryLookupFailureReason =
  "network" | "invalidOutput" | "outputTooLarge" | "busy" | "unknown";

export type RepositoryLookupOutcome =
  | Readonly<{ status: "ok"; repository: RepositoryInfo }>
  | Readonly<{
      status:
        | "notFound"
        | "cliMissing"
        | "notAuthenticated"
        | "hostNotAllowed"
        | "timedOut"
        | "superseded";
    }>
  | Readonly<{ status: "rateLimited"; retryAfterSeconds: number | null }>
  | Readonly<{ status: "failed"; reason: RepositoryLookupFailureReason }>;

const REPOSITORY_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPOSITORY_HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export function isRepositoryProvider(value: unknown): value is RepositoryProvider {
  return value === "github" || value === "gitlab";
}

export function isRepositoryHost(value: string): boolean {
  if (value.length === 0 || value.length > REPOSITORY_LOOKUP_LIMITS.hostChars) return false;
  return REPOSITORY_HOST_PATTERN.test(value);
}

export function parseRepositoryPath(provider: RepositoryProvider, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > REPOSITORY_LOOKUP_LIMITS.pathChars) return null;
  const path = trimmed.endsWith(".git") ? trimmed.slice(0, -".git".length) : trimmed;
  if (path.length === 0) return null;
  const segments = path.split("/");
  const limits = REPOSITORY_PATH_SEGMENT_LIMITS[provider];
  if (segments.length < limits.min || segments.length > limits.max) return null;
  if (segments.some((segment) => !isRepositoryPathSegment(segment))) return null;
  return segments.join("/");
}

function isRepositoryPathSegment(segment: string): boolean {
  if (segment.includes("..")) return false;
  return REPOSITORY_PATH_SEGMENT_PATTERN.test(segment);
}

export type RepositorySearchRequest = Readonly<{
  provider: RepositoryProvider;
  host: string;
  query: string;
  page: number;
}>;

export type RepositorySearchOutcome =
  | Readonly<{
      status: "ok";
      repositories: readonly RepositoryInfo[];
      nextPage: number | null;
      truncated: boolean;
    }>
  | Exclude<RepositoryLookupOutcome, Readonly<{ status: "ok"; repository: RepositoryInfo }>>;

export function parseRepositorySearchQuery(raw: string): string | null {
  const query = raw.trim();
  return query.length <= REPOSITORY_LOOKUP_LIMITS.queryChars &&
    /^[A-Za-z0-9][A-Za-z0-9._ /-]*$/.test(query) &&
    !query.includes("..")
    ? query
    : null;
}
