import { LATTE_TAGS } from "../domain/latteNavigation";
import { LATTE_BUILTIN_FILTERS } from "../domain/latteSyntax";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type {
  LatteFilterCompletionContext,
} from "./latteExpressionDetection";

/**
 * The Monaco icon bucket a Latte completion maps to: tag -> keyword,
 * template -> file, variable -> `{$var}` template variable, member -> `{$var->}`
 * property/method, filter -> `|filter` name.
 */
export type LatteCompletionItemKind =
  | "tag"
  | "template"
  | "variable"
  | "member"
  | "filter"
  | "link"
  | "component"
  | "translation"
  | "snippet";

/**
 * A Latte completion the hook hands to the Monaco "latte" provider. Structurally
 * compatible with the provider's `LatteCompletion`; kept in application code so
 * the application layer does not depend on the components layer.
 */
export interface LatteCompletionItem {
  detail?: string;
  insertText: string;
  kind: LatteCompletionItemKind;
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export function latteTagCompletions(
  prefix: string,
  braceStart: number,
  offset: number,
  maxCompletions: number,
): LatteCompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return LATTE_TAGS.filter((tag) =>
    tag.toLowerCase().startsWith(normalizedPrefix),
  )
    .slice(0, maxCompletions)
    .map((tag) => ({
      detail: "Latte tag",
      insertText: tag,
      kind: "tag" as const,
      label: tag,
      replaceEnd: offset,
      replaceStart: braceStart + 1,
    }));
}

export function latteFilterCompletions(
  filter: LatteFilterCompletionContext,
  maxCompletions: number,
  projectFilterNames: readonly string[] = [],
): LatteCompletionItem[] {
  const normalizedPrefix = filter.prefix.toLowerCase();
  const builtinNames = new Set(LATTE_BUILTIN_FILTERS);
  const projectNames = projectFilterNames.filter(
    (name) => !builtinNames.has(name),
  );
  const entries = [
    ...LATTE_BUILTIN_FILTERS.map((name) => ({
      detail: "Latte filter",
      name,
    })),
    ...projectNames.map((name) => ({
      detail: "Project Latte filter",
      name,
    })),
  ];

  return entries
    .filter((entry) => entry.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, maxCompletions)
    .map((entry) => ({
      detail: entry.detail,
      insertText: entry.name,
      kind: "filter" as const,
      label: entry.name,
      replaceEnd: filter.end,
      replaceStart: filter.start,
    }));
}

export function latteMemberCompletionItem(
  member: PhpMethodCompletion,
  start: number,
  end: number,
): LatteCompletionItem {
  return {
    detail: latteMemberCompletionDetail(member),
    insertText: latteMemberCompletionInsertText(member),
    kind: "member",
    label: member.name,
    replaceEnd: end,
    replaceStart: start,
  };
}

function latteMemberCompletionInsertText(member: PhpMethodCompletion): string {
  if (member.insertText) {
    return member.insertText;
  }

  if (member.kind === "property" || member.kind === "relation") {
    return member.name;
  }

  return `${member.name}()`;
}

function latteMemberCompletionDetail(member: PhpMethodCompletion): string {
  const returnType = member.returnType ? `: ${member.returnType}` : "";

  if (member.kind === "property" || member.kind === "relation") {
    return `${member.declaringClassName}::${member.name}${returnType}`;
  }

  const parameters = member.parameters ? `(${member.parameters})` : "()";

  return `${member.declaringClassName}::${member.name}${parameters}${returnType}`;
}
