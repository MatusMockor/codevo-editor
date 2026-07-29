import type * as Monaco from "monaco-editor";
import {
  phpMethodParameters,
  type PhpMethodCompletion,
  type PhpMethodParameter,
} from "../../domain/phpMethodCompletions";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export function phpMethodCompletionKind(
  monaco: MonacoApi,
  item: PhpMethodCompletion,
): Monaco.languages.CompletionItemKind {
  if (item.kind === "relation") {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (item.kind === "route") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (item.kind === "config") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (item.kind === "env") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (item.kind === "translation") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (item.kind === "view") {
    return monaco.languages.CompletionItemKind.File;
  }

  if (item.kind === "nette.ajax-snippet") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (item.kind === "property") {
    return monaco.languages.CompletionItemKind.Property;
  }

  if (item.kind === "scope") {
    // Magic query scopes read like methods but are not declared as such, so a
    // distinct Function glyph separates them from real methods in the list.
    return monaco.languages.CompletionItemKind.Function;
  }

  if (item.kind === "magic-where") {
    // Dynamic `where<Attribute>()` query magic is synthesised from model
    // attributes, so an Event glyph marks it apart from real methods and scopes.
    return monaco.languages.CompletionItemKind.Event;
  }

  return monaco.languages.CompletionItemKind.Method;
}

export function phpMethodDetail(item: PhpMethodCompletion): string {
  if (item.detail != null) {
    return item.detail;
  }

  const visibilityPrefix = item.visibility ? `${item.visibility} ` : "";

  if (item.kind === "relation") {
    const returnType = item.returnType ? `: ${item.returnType}` : "";

    return `${item.declaringClassName}::${item.name} relation${returnType}`;
  }

  if (item.kind === "property") {
    const returnType = item.returnType ? `: ${item.returnType}` : "";

    return `${visibilityPrefix}${item.declaringClassName}::$${item.name}${returnType}`;
  }

  const parameters = item.parameters ? `(${item.parameters})` : "()";
  const returnType = item.returnType ? `: ${item.returnType}` : "";

  return `${visibilityPrefix}${item.declaringClassName}::${item.name}${parameters}${returnType}`;
}

export function phpMethodDocumentation(item: PhpMethodCompletion): string {
  if (item.documentation != null) {
    return item.documentation;
  }

  if (item.kind === "relation") {
    return `Laravel relation\n\n${item.declaringClassName}::${item.name}()`;
  }

  if (item.kind === "property") {
    return `Property\n\n${item.declaringClassName}::$${item.name}`;
  }

  const parameters = phpMethodParameters(item.parameters);

  if (!parameters.length) {
    return `Method\n\n${item.declaringClassName}::${item.name}()`;
  }

  return [
    "Method",
    "",
    `${item.declaringClassName}::${item.name}()`,
    "",
    ...parameters.map((parameter) => `- ${phpParameterLabel(parameter)}`),
  ].join("\n");
}

export function phpMethodCompletionLabel(
  item: PhpMethodCompletion,
): Monaco.languages.CompletionItemLabel {
  return {
    description: phpMethodCompletionLabelDescription(item),
    detail: phpMethodCompletionLabelDetail(item),
    label: item.name,
  };
}

export function phpMethodCompletionLabelDescription(item: PhpMethodCompletion): string {
  const visibilityPrefix = item.visibility ? `${item.visibility} ` : "";

  if (item.kind === "relation") {
    return `relation - ${item.declaringClassName}`;
  }

  if (item.kind === "route") {
    return `route - ${item.declaringClassName}`;
  }

  if (item.kind === "config") {
    return `config - ${item.declaringClassName}`;
  }

  if (item.kind === "env") {
    return `env - ${item.declaringClassName}`;
  }

  if (item.kind === "translation") {
    return `translation - ${item.declaringClassName}`;
  }

  if (item.kind === "view") {
    return `view - ${item.declaringClassName}`;
  }

  if (item.kind === "nette.ajax-snippet") {
    return `snippet - ${item.declaringClassName}`;
  }

  if (item.kind === "property") {
    return `${visibilityPrefix}property - ${item.declaringClassName}`;
  }

  if (item.kind === "scope") {
    return `scope - ${item.declaringClassName}`;
  }

  if (item.kind === "magic-where") {
    return `magic where - ${item.declaringClassName}`;
  }

  return `${visibilityPrefix}method - ${item.declaringClassName}`;
}

export function phpMethodCompletionLabelDetail(item: PhpMethodCompletion): string {
  if (
    item.kind === "config" ||
    item.kind === "env" ||
    item.kind === "translation" ||
    item.kind === "relation" ||
    item.kind === "route" ||
    item.kind === "view" ||
    item.kind === "nette.ajax-snippet"
  ) {
    return "";
  }

  if (item.kind === "property") {
    return item.visibility && item.returnType ? `: ${item.returnType}` : "";
  }

  if (item.visibility && item.returnType) {
    return `(): ${item.returnType}`;
  }

  return "()";
}

export function phpMethodSignatureLabel(item: PhpMethodCompletion): string {
  const parameters = item.parameters ? `(${item.parameters})` : "()";
  const returnType = item.returnType ? `: ${item.returnType}` : "";

  return `${item.name}${parameters}${returnType}`;
}

export function phpMethodCompletionShouldTriggerParameterHints(item: PhpMethodCompletion): boolean {
  if (item.completionBehavior?.triggerParameterHints != null) {
    return item.completionBehavior.triggerParameterHints;
  }

  return (
    item.kind !== "property" &&
    item.kind !== "config" &&
    item.kind !== "env" &&
    item.kind !== "translation" &&
    item.kind !== "relation" &&
    item.kind !== "route" &&
    item.kind !== "view" &&
    item.kind !== "nette.ajax-snippet" &&
    phpMethodParameters(item.parameters).length > 0
  );
}

export function phpMethodInsertText(item: PhpMethodCompletion): string {
  if (item.completionBehavior?.insertTextMode === "plain") {
    return item.insertText ?? item.name;
  }

  return phpMethodSnippet(item);
}

export function phpMethodInsertTextRules(
  monaco: MonacoApi,
  item: PhpMethodCompletion,
): Monaco.languages.CompletionItemInsertTextRule | undefined {
  if (item.completionBehavior?.insertTextMode === "plain") {
    return undefined;
  }

  return monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
}

export function phpMethodSnippet(item: PhpMethodCompletion): string {
  if (item.insertText) {
    return item.insertText;
  }

  if (
    item.kind === "property" ||
    item.kind === "config" ||
    item.kind === "env" ||
    item.kind === "translation" ||
    item.kind === "relation" ||
    item.kind === "route" ||
    item.kind === "view" ||
    item.kind === "nette.ajax-snippet"
  ) {
    return item.name;
  }

  const parameters = phpMethodParameters(item.parameters);

  if (!parameters.length) {
    return `${item.name}()$0`;
  }

  const requiredParameters = parameters.filter((parameter) => !parameter.optional);

  if (!requiredParameters.length) {
    return `${item.name}($0)`;
  }

  const placeholders = requiredParameters.map(
    (parameter, index) => `\${${index + 1}:${snippetPlaceholderText(parameter.name)}}`,
  );

  return `${item.name}(${placeholders.join(", ")})$0`;
}

export function phpParameterLabel(parameter: PhpMethodParameter): string {
  const type = parameter.type ? `${parameter.type} ` : "";
  const defaultValue = parameter.defaultValue !== null ? ` = ${parameter.defaultValue}` : "";

  return `${type}${parameter.name}${defaultValue}`;
}

export function snippetPlaceholderText(value: string): string {
  const name = value.replace(/^\.\.\./, "").replace(/^\$/, "") || "value";

  return name.replace(/[$}\\]/g, "\\$&");
}

export function lspCompletionInsert(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    documentation: string | null;
    insertText: string | null;
    label: string;
  },
  kind: Monaco.languages.CompletionItemKind,
): {
  command?: Monaco.languages.Command;
  insertText: string;
  insertTextRules?: Monaco.languages.CompletionItemInsertTextRule;
} {
  const insertText = item.insertText || item.label;

  if (containsSnippetPlaceholder(insertText)) {
    return {
      insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    };
  }

  if (!isCallableCompletionKind(monaco, kind)) {
    const textCallableName =
      phpCallableCompletionName(item.label) ?? phpCallableCompletionName(insertText);

    if (
      !textCallableName ||
      !completionItemValuesLookLikeSignature(item, insertText, textCallableName)
    ) {
      return { insertText };
    }

    const parameterState = lspCompletionParameterState(item, textCallableName);
    const hasParameters = parameterState !== "none";

    return {
      command: hasParameters
        ? {
            id: "editor.action.triggerParameterHints",
            title: "Trigger parameter hints",
          }
        : undefined,
      insertText: hasParameters ? `${textCallableName}($0)` : `${textCallableName}()$0`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    };
  }

  const name = phpCallableCompletionName(item.label) ?? phpCallableCompletionName(insertText);

  if (!name) {
    return { insertText };
  }

  const parameterState = lspCompletionParameterState(item, name);
  const hasParameters = parameterState !== "none";

  return {
    command: hasParameters
      ? {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        }
      : undefined,
    insertText: hasParameters ? `${name}($0)` : `${name}()$0`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  };
}

export function containsSnippetPlaceholder(insertText: string): boolean {
  return /\$(?:\d+|\{)/.test(insertText);
}

export function completionItemValuesLookLikeSignature(
  item: {
    detail?: string | null;
    documentation?: unknown;
    insertText?: string | null;
    label: Monaco.languages.CompletionItem["label"] | string;
  },
  insertText: string | null | undefined,
  name: string,
): boolean {
  const documentation = typeof item.documentation === "string" ? item.documentation : null;

  return [
    completionItemLabelText(item.label),
    item.insertText,
    insertText,
    item.detail,
    documentation,
  ]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .some((candidate) => completionLabelLooksLikeSignature(candidate, name));
}

export function isCallableCompletionKind(
  monaco: MonacoApi,
  kind: Monaco.languages.CompletionItemKind,
): boolean {
  return (
    kind === monaco.languages.CompletionItemKind.Method ||
    kind === monaco.languages.CompletionItemKind.Function
  );
}

export function phpCallableCompletionName(value: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.trim())?.[0] ?? null;
}

export function lspCompletionParameterState(
  item: {
    detail: string | null;
    documentation: string | null;
    insertText: string | null;
    label: string;
  },
  name: string,
): "hasParameters" | "none" | "unknown" {
  const candidates = [
    item.label,
    item.insertText ?? "",
    item.detail ?? "",
    item.documentation ?? "",
  ];

  for (const candidate of candidates) {
    const state = callableParameterState(candidate, name);

    if (state !== "unknown") {
      return state;
    }
  }

  return "unknown";
}

export function callableParameterState(
  value: string,
  name: string,
): "hasParameters" | "none" | "unknown" {
  const match = new RegExp(`${escapeRegExp(name)}\\s*\\(([^)]*)\\)`).exec(value);

  if (!match) {
    return "unknown";
  }

  return match[1].trim() ? "hasParameters" : "none";
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function completionRange(
  model: MonacoModel,
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number },
) {
  const line = model.getLineContent?.(position.lineNumber) ?? "";
  const characterBeforeWord = line[word.startColumn - 2] || "";
  const startColumn =
    characterBeforeWord === "$" ? Math.max(1, word.startColumn - 1) : word.startColumn;

  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn,
    startLineNumber: position.lineNumber,
  };
}

export function dedupeCompletionItems(
  monaco: MonacoApi,
  items: Monaco.languages.CompletionItem[],
): Monaco.languages.CompletionItem[] {
  const indexByKey = new Map<string, number>();
  const unique: Monaco.languages.CompletionItem[] = [];

  for (const item of items) {
    const key = completionItemDedupeKey(monaco, item);
    const existingIndex = indexByKey.get(key);

    if (existingIndex != null) {
      unique[existingIndex] = mergePhpCompletionItemMetadata(unique[existingIndex], item);
      continue;
    }

    indexByKey.set(key, unique.length);
    unique.push(item);
  }

  return unique;
}

export function mergePhpCompletionItemMetadata(
  primary: Monaco.languages.CompletionItem,
  metadata: Monaco.languages.CompletionItem,
): Monaco.languages.CompletionItem {
  const tags = Array.from(new Set([...(primary.tags ?? []), ...(metadata.tags ?? [])]));

  return {
    ...metadata,
    ...primary,
    ...(metadata.commitCharacters ? { commitCharacters: metadata.commitCharacters } : {}),
    ...(metadata.detail && !primary.detail ? { detail: metadata.detail } : {}),
    ...(metadata.documentation && !primary.documentation
      ? { documentation: metadata.documentation }
      : {}),
    ...(metadata.filterText ? { filterText: metadata.filterText } : {}),
    ...(metadata.preselect ? { preselect: true } : {}),
    ...(metadata.sortText && !primary.sortText ? { sortText: metadata.sortText } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function completionItemDedupeKey(
  monaco: MonacoApi,
  item: Monaco.languages.CompletionItem,
): string {
  const callableName = completionItemCallableDedupeName(monaco, item);

  if (callableName) {
    return `callable:${callableName.toLowerCase()}`;
  }

  const label = completionItemLabelText(item.label);

  if (
    item.kind === monaco.languages.CompletionItemKind.Property ||
    item.kind === monaco.languages.CompletionItemKind.Field
  ) {
    return `property:${label.toLowerCase()}`;
  }

  return `${item.kind}:${label.toLowerCase()}`;
}

export function completionItemCallableDedupeName(
  monaco: MonacoApi,
  item: Monaco.languages.CompletionItem,
): string | null {
  const label = completionItemLabelText(item.label);
  const callableName = phpCallableCompletionName(label);

  if (!callableName) {
    return null;
  }

  if (isCallableCompletionKind(monaco, item.kind)) {
    return callableName;
  }

  if (completionItemValuesLookLikeSignature(item, item.insertText, callableName)) {
    return callableName;
  }

  if (
    typeof item.label !== "string" &&
    item.label.detail &&
    completionLabelLooksLikeSignature(`${item.label.label}${item.label.detail}`, callableName)
  ) {
    return callableName;
  }

  return null;
}

export function completionLabelLooksLikeSignature(value: string, name: string): boolean {
  return new RegExp(`(?:^|::|\\b)${escapeRegExp(name)}\\s*\\(`).test(value);
}

export function completionItemLabelText(label: Monaco.languages.CompletionItem["label"]): string {
  return typeof label === "string" ? label : label.label;
}

export function monacoCompletionKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null,
): Monaco.languages.CompletionItemKind {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}
