import type * as Monaco from "monaco-editor";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const DEFAULT_ON_TYPE_FORMATTING_TRIGGER_CHARACTERS = ["}", ";", "\n"];

const DEFAULT_SEMANTIC_TOKENS_LEGEND = {
  tokenModifiers: [
    "declaration",
    "definition",
    "readonly",
    "static",
    "deprecated",
    "abstract",
    "async",
    "modification",
    "documentation",
    "defaultLibrary",
  ],
  tokenTypes: [
    "namespace",
    "type",
    "class",
    "enum",
    "interface",
    "struct",
    "typeParameter",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "event",
    "function",
    "method",
    "macro",
    "keyword",
    "modifier",
    "comment",
    "string",
    "number",
    "regexp",
    "operator",
  ],
} satisfies Monaco.languages.SemanticTokensLegend;

export function javaScriptTypeScriptOnTypeFormattingTriggerCharacters(
  status: LanguageServerRuntimeStatus | null,
  rootPath: string | null,
): string[] {
  if (
    status?.kind === "running" &&
    status.rootPath &&
    rootPath &&
    workspaceRootKeysEqual(status.rootPath, rootPath) &&
    isStringArray(status.capabilities.onTypeFormattingTriggerCharacters) &&
    status.capabilities.onTypeFormattingTriggerCharacters.length > 0
  ) {
    return status.capabilities.onTypeFormattingTriggerCharacters;
  }

  return DEFAULT_ON_TYPE_FORMATTING_TRIGGER_CHARACTERS;
}

export function javaScriptTypeScriptSemanticTokensLegend(
  status: LanguageServerRuntimeStatus | null,
  rootPath: string | null,
): Monaco.languages.SemanticTokensLegend {
  if (
    status?.kind !== "running" ||
    !status.rootPath ||
    !rootPath ||
    !workspaceRootKeysEqual(status.rootPath, rootPath) ||
    !isUsableSemanticTokensLegend(status.capabilities.semanticTokensLegend)
  ) {
    return DEFAULT_SEMANTIC_TOKENS_LEGEND;
  }

  return status.capabilities.semanticTokensLegend;
}

function isUsableSemanticTokensLegend(
  legend: unknown,
): legend is Monaco.languages.SemanticTokensLegend {
  if (!legend || typeof legend !== "object") {
    return false;
  }

  const candidate = legend as Partial<Monaco.languages.SemanticTokensLegend>;
  return (
    isStringArray(candidate.tokenTypes) &&
    candidate.tokenTypes.length > 0 &&
    isStringArray(candidate.tokenModifiers)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
