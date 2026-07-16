import { LATTE_TAGS } from "../domain/latteNavigation";
import { LATTE_BUILTIN_FILTERS } from "../domain/latteSyntax";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type {
  LatteFilterCompletionContext,
} from "./latteExpressionDetection";
import type { ResolvedLatteProjectFilter } from "./latteFilterCallableResolution";

/**
 * The Monaco icon bucket a Latte completion maps to: tag -> keyword,
 * template -> file, variable -> `{$var}` template variable, member -> `{$var->}`
 * property/method, filter -> `|filter` name.
 */
export type LatteCompletionItemKind =
  | "block"
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
  projectFilters: readonly (string | ResolvedLatteProjectFilter)[] = [],
): LatteCompletionItem[] {
  const normalizedPrefix = filter.prefix.toLowerCase();
  const builtinNames = new Set(LATTE_BUILTIN_FILTERS);
  const projectEntries = projectFilters
    .map((filter) => (typeof filter === "string" ? { name: filter } : filter))
    .filter((filter) => !builtinNames.has(filter.name));
  const entries = [
    ...LATTE_BUILTIN_FILTERS.map((name) => ({
      detail: "Latte filter",
      name,
    })),
    ...projectEntries.map((filter) => ({
      detail: latteProjectFilterCompletionDetail(filter),
      name: filter.name,
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

function latteProjectFilterCompletionDetail(
  filter: ResolvedLatteProjectFilter,
): string {
  if (!filter.callable) {
    return "Project Latte filter";
  }

  const parameters = filter.callable.parameters
    ? `(${filter.callable.parameters})`
    : "()";
  const returnType = filter.callable.returnType
    ? `: ${filter.callable.returnType}`
    : "";

  return `${filter.callable.declaringClassName}::${filter.callable.methodName}${parameters}${returnType}`;
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
