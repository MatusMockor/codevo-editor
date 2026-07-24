import {
  debuggerSessionId,
  type Breakpoint,
  type DebugExceptionPauseMode,
  type DebugExceptionTypeFilter,
  type DebugGateway,
  type DebugLaunchTarget,
  type DebugRuntimeStatus,
} from "../domain/debug";
import { debugBreakpointAdapterForLaunch } from "../domain/debugBreakpointPolicy";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { NodeDebugAttachCandidateStartPort } from "./debugSessionContracts";
import type {
  NativeNodeWatchDebugGateway,
  NativeNodeWatchDebugStartRequest,
} from "../domain/nativeNodeWatchDebugGateway";

export interface DebugStartDescriptor {
  readonly adapterKind: "node" | "php";
  readonly confirmStart?: (rootPath: string, sessionId: number) => Promise<void>;
  readonly exceptionTypeFilterSupported: boolean;
  readonly isStartAuthorized?: () => boolean;
  readonly restartLaunch: DebugLaunchTarget | null;
  readonly targetKind: DebugLaunchTarget["kind"];
  start(
    rootPath: string,
    breakpoints: readonly Breakpoint[],
    exceptionPauseMode: DebugExceptionPauseMode,
    exceptionTypeFilter: DebugExceptionTypeFilter,
  ): Promise<DebugRuntimeStatus>;
}

export type DebugStartAcceptance =
  | { readonly kind: "live" }
  | { readonly kind: "terminated"; readonly sessionId: number }
  | { readonly kind: "rejected" };

export function classifyDebugStartAcceptance(
  snapshot: DebuggerSessionSnapshot,
  sessionId: number,
  acceptAlreadyTerminatedSession: boolean,
): DebugStartAcceptance {
  if (
    snapshot.state.kind !== "inactive" &&
    snapshot.state.kind !== "terminated" &&
    debuggerSessionId(snapshot.state) === sessionId
  ) {
    return { kind: "live" };
  }
  return acceptAlreadyTerminatedSession &&
    snapshot.state.kind === "terminated" &&
    debuggerSessionId(snapshot.state) === sessionId
    ? { kind: "terminated", sessionId }
    : { kind: "rejected" };
}

export function legacyDebugStartDescriptor(
  gateway: DebugGateway,
  launch: DebugLaunchTarget,
): DebugStartDescriptor {
  return {
    adapterKind: debugBreakpointAdapterForLaunch(launch),
    exceptionTypeFilterSupported: true,
    restartLaunch: launch,
    targetKind: launch.kind,
    start: (rootPath, breakpoints, exceptionPauseMode, exceptionTypeFilter) =>
      gateway.start(rootPath, launch, breakpoints, exceptionPauseMode, exceptionTypeFilter),
  };
}

export function nodeAttachCandidateStartDescriptor(
  gateway: NodeDebugAttachCandidateStartPort,
  candidateLeaseId: string,
): DebugStartDescriptor {
  return {
    adapterKind: "node",
    exceptionTypeFilterSupported: true,
    restartLaunch: null,
    targetKind: "node-attach",
    start: (rootPath, breakpoints, exceptionPauseMode, exceptionTypeFilter) =>
      gateway.start({
        rootPath,
        candidateLeaseId,
        breakpoints,
        exceptionPauseMode,
        exceptionTypeFilter,
      }),
  };
}

export function nativeNodeWatchDebugStartDescriptor(
  gateway: NativeNodeWatchDebugGateway,
  request: Omit<
    NativeNodeWatchDebugStartRequest,
    "rootPath" | "breakpoints" | "exceptionPauseMode" | "exceptionTypeFilter"
  >,
  isStartAuthorized?: () => boolean,
): DebugStartDescriptor {
  return {
    adapterKind: "node",
    confirmStart: (rootPath, sessionId) => gateway.confirmNativeNodeWatch(rootPath, sessionId),
    exceptionTypeFilterSupported: false,
    ...(isStartAuthorized ? { isStartAuthorized } : {}),
    restartLaunch: null,
    targetKind: "node-configured-script",
    start: (rootPath, breakpoints, exceptionPauseMode, exceptionTypeFilter) =>
      gateway.startNativeNodeWatch({
        ...request,
        rootPath,
        breakpoints,
        exceptionPauseMode,
        exceptionTypeFilter,
      }),
  };
}

export async function acceptNodeAttachCandidateStart(
  gateway: NodeDebugAttachCandidateStartPort | undefined,
  start: (
    descriptor: DebugStartDescriptor,
    alreadyStoppedSessionId: number | null,
    acceptAlreadyTerminatedSession: boolean,
  ) => Promise<number | undefined>,
  candidateLeaseId: string,
): Promise<number | null> {
  if (!gateway) return null;
  return (
    (await start(nodeAttachCandidateStartDescriptor(gateway, candidateLeaseId), null, true)) ?? null
  );
}

export async function acceptLegacyDebugStart(
  gateway: DebugGateway,
  start: (descriptor: DebugStartDescriptor) => Promise<number | undefined>,
  launch: DebugLaunchTarget,
): Promise<boolean> {
  return (await start(legacyDebugStartDescriptor(gateway, launch))) !== undefined;
}
