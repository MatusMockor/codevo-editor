import { useCallback, useRef } from "react";
import type { DebugEvaluationSuccess } from "../domain/debugEvaluationPolicy";
import type { DebugWatchDefinition } from "../domain/debugWatchExpressions";
import { debugInspectionOwnersEqual } from "../domain/debugVariablePages";
import type { DebugWatchEvaluation } from "./useDebugWatchExpressions";
import type {
  DebugWatchExpressionMutation,
  DebugWatchExpressionMutationIdentity,
  DebugWatchExpressionMutations,
} from "./debugSessionContracts";
import type { DebugSetExpressionCandidate } from "./useDebugSetExpression";

interface DebugWatchExpressionMutationOptions {
  readonly definitions: readonly DebugWatchDefinition[];
  readonly evaluations: Readonly<Record<string, DebugWatchEvaluation>>;
  readonly setExpression: (
    candidate: DebugSetExpressionCandidate,
    value: string,
  ) => Promise<DebugEvaluationSuccess | null>;
}

/**
 * Projects adapter authority into a row-scoped capability. Presentation code
 * receives neither the gateway nor the opaque reference.
 */
export function useDebugWatchExpressionMutations({
  definitions,
  evaluations,
  setExpression,
}: DebugWatchExpressionMutationOptions): DebugWatchExpressionMutations {
  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;
  const evaluationsRef = useRef(evaluations);
  evaluationsRef.current = evaluations;
  const setExpressionRef = useRef(setExpression);
  setExpressionRef.current = setExpression;

  const forWatch = useCallback(
    (
      definition: DebugWatchDefinition,
      evaluation: DebugWatchEvaluation | undefined,
    ): DebugWatchExpressionMutation | null => {
      if (!isWritableEvaluation(definition, evaluation)) return null;
      const identity: DebugWatchExpressionMutationIdentity = Object.freeze({
        definitionId: definition.id,
        definitionRevision: definition.revision,
        expression: definition.expression,
      });
      const candidate: DebugSetExpressionCandidate = Object.freeze({
        ...identity,
        owner: evaluation.owner,
        setExpressionReference: evaluation.result.setExpressionReference,
        isCurrent: () =>
          definitionsRef.current.includes(definition) &&
          evaluationsRef.current[definition.id] === evaluation,
      });
      return {
        identity,
        currentValue: evaluation.result.value,
        setValue: async (nextValue) => {
          const currentDefinition = definitionsRef.current.find(
            (item) => item.id === identity.definitionId,
          );
          const currentEvaluation = evaluationsRef.current[identity.definitionId];
          if (
            !currentDefinition ||
            currentDefinition.revision !== identity.definitionRevision ||
            currentDefinition.expression !== identity.expression ||
            !isWritableEvaluation(currentDefinition, currentEvaluation) ||
            currentEvaluation.result.setExpressionReference !== candidate.setExpressionReference ||
            !debugInspectionOwnersEqual(currentEvaluation.owner, candidate.owner) ||
            !candidate.isCurrent()
          ) {
            return null;
          }
          const result = await setExpressionRef.current(candidate, nextValue);
          return candidate.isCurrent() ? result : null;
        },
      };
    },
    [],
  );

  return { forWatch };
}

function isWritableEvaluation(
  definition: DebugWatchDefinition,
  evaluation: DebugWatchEvaluation | undefined,
): evaluation is DebugWatchEvaluation & {
  readonly result: DebugEvaluationSuccess & { readonly setExpressionReference: number };
} {
  return (
    definition.enabled &&
    evaluation !== undefined &&
    evaluation.definitionRevision === definition.revision &&
    evaluation.result.status === "ok" &&
    Number.isSafeInteger(evaluation.result.setExpressionReference) &&
    (evaluation.result.setExpressionReference ?? 0) > 0
  );
}
