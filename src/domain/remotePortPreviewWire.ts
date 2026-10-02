import {
  boundedArray,
  exactObject,
  hasControlCharacter,
  integerIn,
  isRunnerId,
  isRunnerIdentifier,
  isWireBoolean,
  isWireRecord,
  isWellFormedText,
  isWireTimestamp,
  isWireUuid,
  nullable,
  oneOf,
  utf8Bytes,
  type WireCheck,
} from "./remoteWireChecks";

export const REMOTE_PORT_LIMITS = Object.freeze({
  minPort: 1024,
  maxPort: 65535,
  ports: 32,
  processBytes: 15,
  ownerIdBytes: 1024,
  pathBytes: 2048,
});

export type RemotePortAddress = "loopback-v4" | "loopback-v6" | "any-v4" | "any-v6";
export type RemotePortSource = "agent" | "terminal";
export type RemoteListeningPort = Readonly<{
  port: number;
  address: RemotePortAddress;
  source: RemotePortSource;
  process: string;
}>;
export type RemotePortList = Readonly<{
  ports: readonly RemoteListeningPort[];
  truncated: boolean;
  scannedAt: string;
}>;
export type RemotePortScope =
  Readonly<{ kind: "task"; taskId: string }> | Readonly<{ kind: "project"; projectId: string }>;
export type RemotePortForwardState = "opening" | "open";
export type RemotePortForward = Readonly<{ localPort: number; state: RemotePortForwardState }>;
export type RemotePortListing = Readonly<{
  ports: readonly (RemoteListeningPort & Readonly<{ forward: RemotePortForward | null }>)[];
  truncated: boolean;
  scannedAt: string;
}>;
export type RemotePortOwnerRequest = Readonly<{
  serverId: string;
  runnerId: string;
  ownerId: string;
  scope: RemotePortScope;
}>;
export type RemotePortListRequest = RemotePortOwnerRequest;
export type RemotePortOpenRequest = RemotePortOwnerRequest &
  Readonly<{ port: number; scheme: "http" | "https"; path: string }>;
export type RemotePortCloseRequest = Readonly<{
  serverId: string;
  ownerId: string;
  scope: RemotePortScope;
  port: number;
}>;
export type RemotePortReleaseOwnerRequest = Readonly<{ ownerId: string }>;
export type RemotePortOpenResponse = Readonly<{ localPort: number }>;

const port = integerIn(REMOTE_PORT_LIMITS.minPort, REMOTE_PORT_LIMITS.maxPort);

const isProcessName: WireCheck = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= REMOTE_PORT_LIMITS.processBytes &&
  /^[\x20-\x7e]+$/u.test(value);

export const isRemotePortOwnerId: WireCheck = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  utf8Bytes(value) <= REMOTE_PORT_LIMITS.ownerIdBytes &&
  isWellFormedText(value) &&
  !hasControlCharacter(value);

export const isRemotePortPath: WireCheck = (value) =>
  typeof value === "string" &&
  value.startsWith("/") &&
  utf8Bytes(value) <= REMOTE_PORT_LIMITS.pathBytes &&
  !value.includes("\\") &&
  isWellFormedText(value) &&
  !hasControlCharacter(value);

const ADDRESS_ORDER: readonly RemotePortAddress[] = [
  "loopback-v4",
  "loopback-v6",
  "any-v4",
  "any-v6",
];
const SOURCE_ORDER: readonly RemotePortSource[] = ["agent", "terminal"];

const listeningPortFields = {
  port,
  address: oneOf(...ADDRESS_ORDER),
  source: oneOf(...SOURCE_ORDER),
  process: isProcessName,
};

const compareListed = (
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): number =>
  Number(left.port) - Number(right.port) ||
  ADDRESS_ORDER.indexOf(left.address as RemotePortAddress) -
    ADDRESS_ORDER.indexOf(right.address as RemotePortAddress) ||
  SOURCE_ORDER.indexOf(left.source as RemotePortSource) -
    SOURCE_ORDER.indexOf(right.source as RemotePortSource);

const strictlyOrdered: WireCheck = (value) =>
  Array.isArray(value) &&
  value.every((item, index) => {
    const previous: unknown = value[index - 1];
    return (
      index === 0 ||
      (isWireRecord(item) && isWireRecord(previous) && compareListed(previous, item) < 0)
    );
  });

const portCollection =
  (item: WireCheck): WireCheck =>
  (value) =>
    exactObject({
      ports: boundedArray(item, REMOTE_PORT_LIMITS.ports),
      truncated: isWireBoolean,
      scannedAt: isWireTimestamp,
    })(value) &&
    isWireRecord(value) &&
    strictlyOrdered(value.ports);

export const isRemotePortList = portCollection(exactObject(listeningPortFields));

export const isRemotePortListing = portCollection(
  exactObject({
    ...listeningPortFields,
    forward: nullable(exactObject({ localPort: port, state: oneOf("opening", "open") })),
  }),
);

export const isRemotePortScope: WireCheck = (value) =>
  exactObject({ kind: oneOf("task"), taskId: isWireUuid })(value) ||
  exactObject({ kind: oneOf("project"), projectId: isRunnerIdentifier })(value);

const ownerRequest = {
  serverId: isRunnerIdentifier,
  runnerId: isRunnerId,
  ownerId: isRemotePortOwnerId,
  scope: isRemotePortScope,
};

export const isRemotePortListRequest = exactObject(ownerRequest);

export const isRemotePortOpenRequest = exactObject({
  ...ownerRequest,
  port,
  scheme: oneOf("http", "https"),
  path: isRemotePortPath,
});

export const isRemotePortCloseRequest = exactObject({
  serverId: isRunnerIdentifier,
  ownerId: isRemotePortOwnerId,
  scope: isRemotePortScope,
  port,
});

export const isRemotePortReleaseOwnerRequest = exactObject({ ownerId: isRemotePortOwnerId });

export const isRemotePortOpenResponse = exactObject({ localPort: port });

export const remotePortPreviewWireChecks: Readonly<Record<string, WireCheck>> = {
  portList: isRemotePortList,
  portScope: isRemotePortScope,
  portListRequest: isRemotePortListRequest,
  portOpenRequest: isRemotePortOpenRequest,
  portCloseRequest: isRemotePortCloseRequest,
  portReleaseOwnerRequest: isRemotePortReleaseOwnerRequest,
  portListing: isRemotePortListing,
  portOpenResponse: isRemotePortOpenResponse,
};
