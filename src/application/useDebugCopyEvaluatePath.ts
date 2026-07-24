import { useRef } from "react";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugCopyValueCandidate, DebugCopyValueCandidateReader } from "./debugCopyValue";
import {
  useDebugCandidateClipboardCommand,
  type DebugCandidateClipboardFlight,
} from "./useDebugCandidateClipboardCommand";

export interface DebugCopyEvaluatePathCommands {
  canCopyEvaluatePath(): boolean;
  copyEvaluatePath(): Promise<boolean>;
}

interface UseDebugCopyEvaluatePathOptions {
  readonly candidateReader?: DebugCopyValueCandidateReader | null;
  readonly clipboard?: TextClipboardGateway | null;
  readonly flight?: DebugCandidateClipboardFlight;
  isCandidateCurrent(candidate: DebugCopyValueCandidate): boolean;
}

const COPY_EVALUATE_PATH_STRATEGY = {
  identity: "debug.copyEvaluatePath",
  isEligible: (candidate: DebugCopyValueCandidate) => candidate.adapterEvaluateName !== undefined,
  resolveText: async (candidate: DebugCopyValueCandidate) => candidate.adapterEvaluateName ?? null,
};

/** Copies the adapter-provided evaluate path verbatim; it never evaluates or falls back. */
export function useDebugCopyEvaluatePath(
  options: UseDebugCopyEvaluatePathOptions,
): DebugCopyEvaluatePathCommands {
  const localFlight = useRef(false);
  const command = useDebugCandidateClipboardCommand({
    candidateReader: options.candidateReader,
    clipboard: options.clipboard,
    flight: options.flight ?? localFlight,
    isCandidateCurrent: options.isCandidateCurrent,
    strategy: COPY_EVALUATE_PATH_STRATEGY,
  });
  return { canCopyEvaluatePath: command.canRun, copyEvaluatePath: command.run };
}
