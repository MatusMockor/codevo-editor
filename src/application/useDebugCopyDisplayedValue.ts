import { useRef } from "react";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugCopyValueCandidate, DebugCopyValueCandidateReader } from "./debugCopyValue";
import {
  useDebugCandidateClipboardCommand,
  type DebugCandidateClipboardFlight,
} from "./useDebugCandidateClipboardCommand";

export interface DebugCopyDisplayedValueCommands {
  canCopyDisplayedValue(): boolean;
  copyDisplayedValue(): Promise<boolean>;
}

interface UseDebugCopyDisplayedValueOptions {
  readonly candidateReader?: DebugCopyValueCandidateReader | null;
  readonly clipboard?: TextClipboardGateway | null;
  readonly flight?: DebugCandidateClipboardFlight;
  isCandidateCurrent(candidate: DebugCopyValueCandidate): boolean;
}

const COPY_DISPLAYED_VALUE_STRATEGY = Object.freeze({
  identity: "debug.copyDisplayedValue",
  isEligible: (candidate: DebugCopyValueCandidate) => candidate.source === "console",
  resolveText: async (candidate: DebugCopyValueCandidate) => candidate.displayedValue,
});

/**
 * Copies an immutable console result. Unlike Variables Copy Value, this never
 * evaluates an expression and therefore cannot repeat debuggee side effects.
 */
export function useDebugCopyDisplayedValue(
  options: UseDebugCopyDisplayedValueOptions,
): DebugCopyDisplayedValueCommands {
  const localFlight = useRef(false);
  const command = useDebugCandidateClipboardCommand({
    candidateReader: options.candidateReader,
    clipboard: options.clipboard,
    flight: options.flight ?? localFlight,
    isCandidateCurrent: options.isCandidateCurrent,
    strategy: COPY_DISPLAYED_VALUE_STRATEGY,
  });
  return { canCopyDisplayedValue: command.canRun, copyDisplayedValue: command.run };
}
