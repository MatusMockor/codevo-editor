import { useRef } from "react";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { TextClipboardGateway } from "../domain/textClipboard";
import {
  debugCopyValueExpression,
  type DebugCopyValueCandidate,
  type DebugCopyValueCandidateReader,
} from "./debugCopyValue";
import {
  useDebugCandidateClipboardCommand,
  type DebugCandidateClipboardFlight,
} from "./useDebugCandidateClipboardCommand";

export interface DebugCopyValueCommands {
  canCopyValue(): boolean;
  copyValue(): Promise<boolean>;
}

export interface UseDebugCopyValueOptions {
  readonly candidateReader?: DebugCopyValueCandidateReader | null;
  readonly clipboard?: TextClipboardGateway | null;
  readonly flight?: DebugCandidateClipboardFlight;
  evaluateClipboard(expression: string): Promise<DebugEvaluationResult | null>;
  isCandidateCurrent(candidate: DebugCopyValueCandidate): boolean;
}

/** Owner-fenced global single-flight coordinator for Variables and Watch values. */
export function useDebugCopyValue(options: UseDebugCopyValueOptions): DebugCopyValueCommands {
  const localFlight = useRef(false);
  const evaluateClipboard = options.evaluateClipboard;
  const command = useDebugCandidateClipboardCommand({
    candidateReader: options.candidateReader,
    clipboard: options.clipboard,
    flight: options.flight ?? localFlight,
    isCandidateCurrent: options.isCandidateCurrent,
    strategy: {
      identity: evaluateClipboard,
      isEligible: () => true,
      resolveText: async (candidate) => {
        const result = await evaluateClipboard(debugCopyValueExpression(candidate));
        return copyTextForResult(result, candidate);
      },
    },
  });
  return { canCopyValue: command.canRun, copyValue: command.run };
}

function copyTextForResult(
  result: DebugEvaluationResult | null,
  candidate: DebugCopyValueCandidate,
): string | null {
  if (result === null) return null;
  return result.status === "ok" ? result.value : candidate.displayedValue;
}
