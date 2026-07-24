import type {
  Breakpoint,
  DebugExceptionPauseMode,
  DebugExceptionTypeFilter,
  DebugRuntimeStatus,
} from "./debug";
import type { NodeDebugJustMyCodePolicy } from "./nodeDebugJustMyCode";

export type NativeNodeWatchDebugStartRequest = Readonly<{
  readonly rootPath: string;
  readonly scriptPath: string;
  readonly watch: true;
  readonly preserveOutput?: true;
  readonly breakpoints: readonly Breakpoint[];
  readonly exceptionPauseMode: DebugExceptionPauseMode;
  readonly exceptionTypeFilter: DebugExceptionTypeFilter;
  readonly justMyCode?: NodeDebugJustMyCodePolicy;
  readonly sourceMaps?: boolean;
}>;

/**
 * Narrow public seam for editor-owned native Node watch debugging.
 *
 * Runtime selection and inspector arguments stay behind the adapter boundary.
 */
export interface NativeNodeWatchDebugGateway {
  startNativeNodeWatch(request: NativeNodeWatchDebugStartRequest): Promise<DebugRuntimeStatus>;
  confirmNativeNodeWatch(rootPath: string, sessionId: number): Promise<void>;
}
