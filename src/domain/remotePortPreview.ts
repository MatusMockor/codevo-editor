import {
  REMOTE_PORT_LIMITS,
  isRemotePortListing,
  isRemotePortPath,
  type RemotePortCloseRequest,
  type RemotePortForward,
  type RemotePortListing,
  type RemotePortListRequest,
  type RemotePortOpenRequest,
  type RemotePortOpenResponse,
  type RemotePortReleaseOwnerRequest,
  type RemotePortScope,
} from "./remotePortPreviewWire";

export interface RemotePortPreviewPort {
  list(request: RemotePortListRequest): Promise<RemotePortListing>;
  open(request: RemotePortOpenRequest): Promise<RemotePortOpenResponse>;
  close(request: RemotePortCloseRequest): Promise<void>;
  releaseOwner(request: RemotePortReleaseOwnerRequest): Promise<void>;
}

export const REMOTE_PORT_GENERIC_ERROR = "The server could not complete this port operation.";
const MAX_ERROR_LENGTH = 1000;

export const remotePortErrorMessage = (reason: unknown): string => {
  const message =
    typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "";
  if (message.length === 0 || message.length > MAX_ERROR_LENGTH) return REMOTE_PORT_GENERIC_ERROR;
  return message;
};

export const parseRemotePortListing = (value: unknown): RemotePortListing => {
  if (!isRemotePortListing(value)) throw new Error("Invalid server port listing.");
  return value as RemotePortListing;
};

export type RemotePortForwardView =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "opening" }>
  | Readonly<{ kind: "open"; localPort: number }>
  | Readonly<{ kind: "failed"; reason: string }>;

export type RemotePortLocalMarker =
  Readonly<{ kind: "opening" }> | Readonly<{ kind: "failed"; reason: string }>;

const NO_FORWARD: RemotePortForwardView = Object.freeze({ kind: "none" });
const OPENING_FORWARD: RemotePortForwardView = Object.freeze({ kind: "opening" });

const wireForwardView = (forward: RemotePortForward | null): RemotePortForwardView => {
  if (forward === null) return NO_FORWARD;
  switch (forward.state) {
    case "opening":
      return OPENING_FORWARD;
    case "open":
      return { kind: "open", localPort: forward.localPort };
    default: {
      const unreachable: never = forward.state;
      return unreachable;
    }
  }
};

export const remotePortForwardView = (
  forward: RemotePortForward | null,
  marker: RemotePortLocalMarker | null,
): RemotePortForwardView => {
  if (marker === null) return wireForwardView(forward);
  switch (marker.kind) {
    case "opening":
      return OPENING_FORWARD;
    case "failed":
      return { kind: "failed", reason: marker.reason };
    default: {
      const unreachable: never = marker;
      return unreachable;
    }
  }
};

export type RemoteLoopbackScheme = "http" | "https";
export type RemoteLoopbackUrl = Readonly<{
  url: string;
  scheme: RemoteLoopbackScheme;
  port: number;
  path: string;
}>;

const MAX_LOOPBACK_URL_LENGTH = 4096;
const UNSAFE_URL_TEXT = /[\\\s\u0000-\u001f\u007f-\u009f]/u;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["[::1]", "[::]", "0.0.0.0"]);
const LOOPBACK_NAME = /^(?:[a-z0-9-]+\.)*localhost\.?$/u;
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;
const LOOPBACK_MAPPED_IPV6 = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u;

const isLoopbackHost = (hostname: string): boolean =>
  LOOPBACK_HOSTS.has(hostname) ||
  LOOPBACK_NAME.test(hostname) ||
  LOOPBACK_IPV4.test(hostname) ||
  LOOPBACK_MAPPED_IPV6.test(hostname);
const LOOPBACK_SCHEMES: ReadonlyMap<string, RemoteLoopbackScheme> = new Map([
  ["http:", "http"],
  ["https:", "https"],
]);

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const explicitPort = (parsed: URL): number | null => {
  if (parsed.port === "") return null;
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port)) return null;
  if (port < REMOTE_PORT_LIMITS.minPort || port > REMOTE_PORT_LIMITS.maxPort) return null;
  return port;
};

export const classifyLoopbackUrl = (url: string): RemoteLoopbackUrl | null => {
  if (typeof url !== "string" || url.length > MAX_LOOPBACK_URL_LENGTH) return null;
  if (UNSAFE_URL_TEXT.test(url)) return null;
  const parsed = parseUrl(url);
  if (parsed === null) return null;
  const scheme = LOOPBACK_SCHEMES.get(parsed.protocol);
  if (scheme === undefined || !isLoopbackHost(parsed.hostname)) return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  const port = explicitPort(parsed);
  if (port === null) return null;
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!isRemotePortPath(path)) return null;
  return { url, scheme, port, path };
};

export const REMOTE_PORT_POLL_MS = Object.freeze({ active: 5000, idle: 30000 });

export type RemotePortPollActivity = Readonly<{
  turnActive: boolean;
  terminalOpen: boolean;
  focused: boolean;
}>;

export const remotePortPollDelay = ({
  turnActive,
  terminalOpen,
  focused,
}: RemotePortPollActivity): number => {
  if ((turnActive || terminalOpen) && focused) return REMOTE_PORT_POLL_MS.active;
  return REMOTE_PORT_POLL_MS.idle;
};

const scopeIdentity = (scope: RemotePortScope): string => {
  switch (scope.kind) {
    case "task":
      return scope.taskId;
    case "project":
      return scope.projectId;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
};

export const remotePortPreviewKey = (request: RemotePortListRequest): string =>
  JSON.stringify([
    request.serverId,
    request.runnerId,
    request.ownerId,
    request.ownerGeneration,
    request.scope.kind,
    scopeIdentity(request.scope),
  ]);
