import {
  orderPhpMemberCompletionsByCategory,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  latteExpressionCompletionTargetAt,
  type LatteMemberAccess,
  type LatteVariableCompletionContext,
} from "./latteExpressionDetection";
import {
  latteFilterCompletions,
  latteMemberCompletionItem,
  type LatteCompletionItem,
} from "./latteCompletionItems";
import type { LatteVariableCandidate } from "./latteVariableTypes";
import type { EditorPosition } from "../domain/languageServerFeatures";

export interface LatteExpressionCompletionDependencies {
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
}

export interface LatteExpressionCompletionContext {
  collectVariableCandidates(
    source: string,
    offset: number,
  ): Promise<LatteVariableCandidate[]>;
  deps: LatteExpressionCompletionDependencies;
  isRequestedRootActive(): boolean;
  maxCompletions: number;
  resolveVariableType(
    source: string,
    offset: number,
    variableName: string,
    depth: number,
  ): Promise<string | null>;
}

/**
 * Completions inside a Latte PHP-like expression (`{$...}`, `{if ...}`,
 * `{foreach ...}`, `{= ...}`): `{$var->}` member access, a `|filter` name, or
 * the `{$var}` template-variable list - in that precedence order.
 */
export async function latteExpressionCompletions(
  context: LatteExpressionCompletionContext,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[]> {
  const target = latteExpressionCompletionTargetAt(source, offset);

  if (!target) {
    return [];
  }

  if (target.kind === "member") {
    return latteMemberCompletions(context, source, offset, target.member);
  }

  if (target.kind === "filter") {
    return latteFilterCompletions(target.filter, context.maxCompletions);
  }

  return latteVariableCompletions(context, source, offset, target.variable);
}

async function latteMemberCompletions(
  context: LatteExpressionCompletionContext,
  source: string,
  offset: number,
  member: LatteMemberAccess,
): Promise<LatteCompletionItem[]> {
  const { deps, isRequestedRootActive, maxCompletions } = context;
  const receiverType = await context.resolveVariableType(
    source,
    offset,
    member.variableName,
    0,
  );

  if (!isRequestedRootActive() || !receiverType) {
    return [];
  }

  const synthetic = deps.synthesizeTypedReceiverSource(
    member.variableName,
    receiverType,
  );
  const members = await deps.resolvePhpReceiverCompletions(
    synthetic.source,
    synthetic.position,
    member.receiverExpression,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = member.prefix.toLowerCase();

  return orderPhpMemberCompletionsByCategory(members)
    .filter((entry) => entry.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, maxCompletions)
    .map((entry) => latteMemberCompletionItem(entry, member.start, member.end));
}

async function latteVariableCompletions(
  context: LatteExpressionCompletionContext,
  source: string,
  offset: number,
  variable: LatteVariableCompletionContext,
): Promise<LatteCompletionItem[]> {
  const candidates = await context.collectVariableCandidates(source, offset);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = `$${variable.prefix.toLowerCase()}`;

  return candidates
    .filter((candidate) =>
      candidate.name.toLowerCase().startsWith(normalizedPrefix),
    )
    .slice(0, context.maxCompletions)
    .map((candidate) => ({
      detail: candidate.typeHint
        ? `${candidate.detail} · ${candidate.typeHint}`
        : candidate.detail,
      insertText: candidate.name,
      kind: "variable" as const,
      label: candidate.name,
      replaceEnd: variable.end,
      replaceStart: variable.start,
    }));
}
