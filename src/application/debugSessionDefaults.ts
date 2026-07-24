import type { Breakpoint, DebugScope } from "../domain/debug";
import { initialDebuggerSnapshot } from "../domain/debugSessionState";
import type { DebugOutputLine } from "./debugSessionContracts";

export const inactiveSnapshot = initialDebuggerSnapshot();
export const emptyBreakpoints: Breakpoint[] = [];
export const emptyEvaluationHistory: string[] = [];
export const emptyOutput: DebugOutputLine[] = [];
export const emptyScopes: DebugScope[] = [];
export const emptyCompoundSessionIds: readonly number[] = Object.freeze([]);
