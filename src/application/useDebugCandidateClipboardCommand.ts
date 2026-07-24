import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { TextClipboardGateway } from "../domain/textClipboard";
import {
  captureDebugCopyValueCandidate,
  debugCopyValueCandidatesEqual,
  type DebugCopyValueCandidate,
  type DebugCopyValueCandidateReader,
} from "./debugCopyValue";

export type DebugCandidateClipboardFlight = MutableRefObject<boolean>;

export interface DebugCandidateClipboardCommands {
  canRun(): boolean;
  run(): Promise<boolean>;
}

export interface DebugCandidateClipboardStrategy {
  readonly identity: unknown;
  isEligible(candidate: DebugCopyValueCandidate): boolean;
  resolveText(candidate: DebugCopyValueCandidate): Promise<string | null>;
}

interface UseDebugCandidateClipboardCommandOptions {
  readonly candidateReader?: DebugCopyValueCandidateReader | null;
  readonly clipboard?: TextClipboardGateway | null;
  readonly flight: DebugCandidateClipboardFlight;
  readonly strategy: DebugCandidateClipboardStrategy;
  isCandidateCurrent(candidate: DebugCopyValueCandidate): boolean;
}

/** Shared owner-fenced executor for debug actions that write one candidate-derived text value. */
export function useDebugCandidateClipboardCommand(
  options: UseDebugCandidateClipboardCommandOptions,
): DebugCandidateClipboardCommands {
  const optionsRef = useRef(options);
  const mountedRef = useRef(false);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canRun = useCallback((): boolean => {
    const current = optionsRef.current;
    if (current.flight.current) return false;
    if (!mountedClipboardAvailable(mountedRef, current.clipboard)) return false;
    const candidate = mountedCandidateCapture(mountedRef, current.candidateReader);
    return (
      candidate !== null &&
      mountedCandidateCurrent(mountedRef, current, candidate) &&
      mountedCandidateEligible(mountedRef, current.strategy, candidate)
    );
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    const started = optionsRef.current;
    if (!mountedRef.current || started.flight.current) return false;
    started.flight.current = true;
    try {
      const initial = optionsRef.current;
      const clipboard = initial.clipboard;
      const strategy = initial.strategy;
      if (initial.flight !== started.flight) return false;
      if (!mountedClipboardAvailable(mountedRef, clipboard)) return false;

      const first = mountedCandidateCapture(mountedRef, initial.candidateReader);
      const second = mountedCandidateCapture(mountedRef, initial.candidateReader);
      if (
        !first ||
        !second ||
        !debugCopyValueCandidatesEqual(first, second) ||
        !mountedCandidateEligible(mountedRef, strategy, first) ||
        !mountedCandidateEligible(mountedRef, strategy, second) ||
        !mountedCandidateCurrent(mountedRef, initial, first) ||
        !mountedCandidateCurrent(mountedRef, initial, second) ||
        !invocationCurrent(mountedRef, optionsRef.current, clipboard, strategy, first)
      ) {
        return false;
      }

      if (!mountedRef.current) return false;
      const text = await strategy.resolveText(first);
      if (!invocationCurrent(mountedRef, optionsRef.current, clipboard, strategy, first)) {
        return false;
      }
      if (
        typeof text !== "string" ||
        !invocationCurrent(mountedRef, optionsRef.current, clipboard, strategy, first)
      ) {
        return false;
      }

      if (!mountedRef.current) return false;
      await Promise.resolve(clipboard.writeText(text));
      return invocationCurrent(mountedRef, optionsRef.current, clipboard, strategy, first);
    } catch {
      return false;
    } finally {
      started.flight.current = false;
    }
  }, []);

  return { canRun, run };
}

function invocationCurrent(
  mountedRef: { readonly current: boolean },
  options: UseDebugCandidateClipboardCommandOptions,
  clipboard: TextClipboardGateway,
  strategy: DebugCandidateClipboardStrategy,
  candidate: DebugCopyValueCandidate,
): boolean {
  if (!mountedRef.current) return false;
  if (
    options.clipboard !== clipboard ||
    options.strategy.identity !== strategy.identity ||
    !options.flight.current ||
    !mountedClipboardAvailable(mountedRef, clipboard) ||
    !mountedCandidateEligible(mountedRef, options.strategy, candidate) ||
    !mountedCandidateCurrent(mountedRef, options, candidate)
  ) {
    return false;
  }
  const current = mountedCandidateCapture(mountedRef, options.candidateReader);
  return (
    mountedRef.current && current !== null && debugCopyValueCandidatesEqual(candidate, current)
  );
}

function mountedCandidateCapture(
  mountedRef: { readonly current: boolean },
  reader: DebugCopyValueCandidateReader | null | undefined,
): DebugCopyValueCandidate | null {
  if (!mountedRef.current) return null;
  const candidate = captureDebugCopyValueCandidate(reader);
  return mountedRef.current ? candidate : null;
}

function mountedCandidateCurrent(
  mountedRef: { readonly current: boolean },
  options: Pick<UseDebugCandidateClipboardCommandOptions, "isCandidateCurrent">,
  candidate: DebugCopyValueCandidate,
): boolean {
  if (!mountedRef.current) return false;
  try {
    const current = options.isCandidateCurrent(candidate) === true;
    return mountedRef.current && current;
  } catch {
    return false;
  }
}

function mountedCandidateEligible(
  mountedRef: { readonly current: boolean },
  strategy: DebugCandidateClipboardStrategy,
  candidate: DebugCopyValueCandidate,
): boolean {
  if (!mountedRef.current) return false;
  try {
    const eligible = strategy.isEligible(candidate) === true;
    return mountedRef.current && eligible;
  } catch {
    return false;
  }
}

function mountedClipboardAvailable(
  mountedRef: { readonly current: boolean },
  clipboard: TextClipboardGateway | null | undefined,
): clipboard is TextClipboardGateway {
  if (!mountedRef.current || !clipboard) return false;
  try {
    const available = clipboard.canWriteText() === true;
    return mountedRef.current && available;
  } catch {
    return false;
  }
}
