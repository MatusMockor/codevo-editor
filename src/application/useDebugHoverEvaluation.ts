import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
} from "../domain/debugVariablePages";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";
import type { DebugCopyEvaluatePathTarget } from "./useDebugCopyValueComposition";

const MAX_DEBUG_HOVER_COPY_TOKENS = 64;
const MAX_DEBUG_HOVER_COPY_TOKEN_BYTES = 64;

export interface DebugHoverCancellationToken {
  readonly isCancellationRequested: boolean;
}

export type DebugHoverCancellation = AbortSignal | DebugHoverCancellationToken;

export interface UseDebugHoverEvaluationOptions {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly evaluateWatch: (expression: string) => Promise<DebugEvaluationResult | null>;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly isWorkspaceTrusted?: () => boolean;
  readonly copyEvaluatePathOnce?: (target: DebugCopyEvaluatePathTarget) => Promise<boolean>;
}

export interface DebugHoverEvaluationPort {
  getOwner(): DebugInspectionOwner | null;
  evaluate(
    owner: DebugInspectionOwner,
    expression: string,
    cancellation?: DebugHoverCancellation,
  ): Promise<DebugEvaluationResult | null>;
  registerCopyEvaluatePath(
    owner: DebugInspectionOwner,
    result: DebugEvaluationResult,
    isCurrent: () => boolean,
  ): string | null;
  copyEvaluatePath(token: unknown): Promise<boolean>;
  revokeCopyEvaluatePath(token: string): void;
}

/**
 * Exposes the canonical side-effect-safe Watch evaluator to an editor hover provider.
 * The provider owns request ordering; this port only enforces exact inspection ownership.
 */
export function useDebugHoverEvaluation({
  debugAdapterKind,
  evaluateWatch,
  inspectionOwner,
  isWorkspaceTrusted = () => true,
  copyEvaluatePathOnce,
}: UseDebugHoverEvaluationOptions): DebugHoverEvaluationPort {
  const mountedRef = useRef(true);
  const ownerEpochRef = useRef({ epoch: inspectionOwner ? 1 : 0, owner: inspectionOwner });
  if (!debugInspectionOwnersEqual(ownerEpochRef.current.owner, inspectionOwner)) {
    ownerEpochRef.current = { epoch: ownerEpochRef.current.epoch + 1, owner: inspectionOwner };
  }
  const currentRef = useRef({
    debugAdapterKind,
    evaluateWatch,
    inspectionOwner,
    isWorkspaceTrusted,
    copyEvaluatePathOnce,
  });
  currentRef.current = {
    debugAdapterKind,
    evaluateWatch,
    inspectionOwner,
    isWorkspaceTrusted,
    copyEvaluatePathOnce,
  };
  const copyTokensRef = useRef(
    new Map<
      string,
      Readonly<{
        owner: DebugInspectionOwner;
        ownerEpoch: number;
        evaluateName: string;
        isCurrent: () => boolean;
      }>
    >(),
  );
  const copyProvenanceRef = useRef(new WeakSet<object>());
  const copyTokens = copyTokensRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyTokens.clear();
    };
  }, [copyTokens]);

  const getOwner = useCallback((): DebugInspectionOwner | null => {
    if (!mountedRef.current) return null;
    const current = currentRef.current;
    try {
      return current.debugAdapterKind === "node" && current.isWorkspaceTrusted()
        ? current.inspectionOwner
        : null;
    } catch {
      return null;
    }
  }, []);

  const evaluate = useCallback<DebugHoverEvaluationPort["evaluate"]>(
    async (owner, expression, cancellation) => {
      if (!isCurrent(owner, cancellation, getOwner)) return null;
      const evaluate = currentRef.current.evaluateWatch;
      try {
        const result = await evaluate(expression);
        if (!isCurrent(owner, cancellation, getOwner, evaluate, currentRef.current.evaluateWatch)) {
          return null;
        }
        if (result?.status === "ok" && result.evaluateName !== undefined) {
          copyProvenanceRef.current.add(result);
        }
        return result;
      } catch (error) {
        if (!isCurrent(owner, cancellation, getOwner, evaluate, currentRef.current.evaluateWatch)) {
          return null;
        }
        throw error;
      }
    },
    [getOwner],
  );

  const registerCopyEvaluatePath = useCallback<
    DebugHoverEvaluationPort["registerCopyEvaluatePath"]
  >(
    (owner, result, actionIsCurrent) => {
      if (
        !mountedRef.current ||
        !currentRef.current.copyEvaluatePathOnce ||
        !isCurrent(owner, undefined, getOwner) ||
        result.status !== "ok" ||
        result.evaluateName === undefined ||
        !copyProvenanceRef.current.delete(result)
      ) {
        return null;
      }
      try {
        if (actionIsCurrent() !== true) return null;
      } catch {
        return null;
      }
      const token = createOpaqueToken(copyTokensRef.current);
      if (!token) return null;
      while (copyTokensRef.current.size >= MAX_DEBUG_HOVER_COPY_TOKENS) {
        const oldest = copyTokensRef.current.keys().next().value as string | undefined;
        if (!oldest) break;
        copyTokensRef.current.delete(oldest);
      }
      copyTokensRef.current.set(
        token,
        Object.freeze({
          owner: { ...owner },
          ownerEpoch: ownerEpochRef.current.epoch,
          evaluateName: result.evaluateName,
          isCurrent: actionIsCurrent,
        }),
      );
      return token;
    },
    [getOwner],
  );

  const copyEvaluatePath = useCallback<DebugHoverEvaluationPort["copyEvaluatePath"]>(
    async (token) => {
      if (
        !mountedRef.current ||
        typeof token !== "string" ||
        new TextEncoder().encode(token).byteLength > MAX_DEBUG_HOVER_COPY_TOKEN_BYTES
      ) {
        return false;
      }
      const target = copyTokensRef.current.get(token);
      if (!target) return false;
      copyTokensRef.current.delete(token);
      const copy = currentRef.current.copyEvaluatePathOnce;
      if (
        !copy ||
        target.ownerEpoch !== ownerEpochRef.current.epoch ||
        !isCurrent(target.owner, undefined, getOwner)
      ) {
        return false;
      }
      try {
        return (await copy(target)) === true;
      } catch {
        return false;
      }
    },
    [getOwner],
  );

  const revokeCopyEvaluatePath = useCallback((token: string): void => {
    copyTokensRef.current.delete(token);
  }, []);

  return useMemo(
    () => ({
      copyEvaluatePath,
      evaluate,
      getOwner,
      registerCopyEvaluatePath,
      revokeCopyEvaluatePath,
    }),
    [copyEvaluatePath, evaluate, getOwner, registerCopyEvaluatePath, revokeCopyEvaluatePath],
  );
}

function createOpaqueToken(existing: ReadonlyMap<string, unknown>): string | null {
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!existing.has(token)) return token;
    }
  } catch {
    return null;
  }
  return null;
}

function isCurrent(
  owner: DebugInspectionOwner,
  cancellation: DebugHoverCancellation | undefined,
  getOwner: () => DebugInspectionOwner | null,
  capturedEvaluator?: UseDebugHoverEvaluationOptions["evaluateWatch"],
  currentEvaluator?: UseDebugHoverEvaluationOptions["evaluateWatch"],
): boolean {
  return (
    !isDebugHoverCancelled(cancellation) &&
    (capturedEvaluator === undefined || capturedEvaluator === currentEvaluator) &&
    debugInspectionOwnersEqual(getOwner(), owner)
  );
}

function isDebugHoverCancelled(cancellation?: DebugHoverCancellation): boolean {
  if (!cancellation) return false;
  return "aborted" in cancellation ? cancellation.aborted : cancellation.isCancellationRequested;
}
