import type * as Monaco from "monaco-editor";
import type {
  LanguageServerCodeActionCommand,
  LanguageServerCompletionContext,
  LanguageServerCompletionItem,
  LanguageServerCompletionTextEdit,
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
} from "../../domain/languageServerFeatures";
import type { LatencyOperationKind } from "../../domain/latencyTracker";
import {
  normalizeUserSnippets,
  snippetCompletionSuggestions,
  type UserSnippet,
} from "../../domain/snippets";
import type { ExecuteCodeActionCommandPayload } from "../javascriptTypescriptCodeActionAuthority";
import { recordPerfProviderSample } from "../perfScenarioBridge";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
  type JavaScriptTypeScriptProviderRequestCancellationPort,
} from "./requestBoundary";
import type { JavaScriptTypeScriptProviderRequestBoundary } from "./requestBoundary";
import { toMonacoRange, toMonacoTextEdit } from "./sharedMappings";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface LanguageServerBackedCompletionItem extends Monaco.languages.CompletionItem {
  __completionRange?: Monaco.IRange | Monaco.languages.CompletionItemRanges;
  __languageServerItem?: LanguageServerCompletionItem;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

interface CompletionSnippetContext {
  getUserSnippets?(): readonly UserSnippet[];
}

interface CompletionProviderContext extends CompletionSnippetContext {
  cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort;
  completeFunctionCalls?: boolean;
  featuresGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  getActiveDocument(): { language: string } | null;
  recordLatency?(feature: LatencyOperationKind, durationMs: number, rootPath: string): void;
}

const EXECUTE_LANGUAGE_SERVER_COMMAND_ID =
  "mockor.javascriptTypeScript.executeLanguageServerCommand";

export function javaScriptTypeScriptSnippetSuggestions(
  monaco: MonacoApi,
  context: CompletionSnippetContext,
  model: MonacoModel,
  position: MonacoPosition,
  word: { startColumn: number; word?: string },
  range: Monaco.IRange,
  language: string | undefined,
): Monaco.languages.CompletionItem[] {
  if (!language || isMemberAccessCompletion(model, position, word)) {
    return [];
  }

  const typed = typeof word.word === "string" ? word.word : "";

  return snippetCompletionSuggestions(
    monaco,
    language,
    typed,
    range,
    normalizeUserSnippets(context.getUserSnippets?.() ?? []),
  ) as Monaco.languages.CompletionItem[];
}

function isMemberAccessCompletion(
  model: MonacoModel,
  position: MonacoPosition,
  word: { startColumn: number },
): boolean {
  const line = model.getLineContent?.(position.lineNumber);
  return typeof line === "string" && line[word.startColumn - 2] === ".";
}

export function dedupeJavaScriptTypeScriptCompletionItems(
  items: Monaco.languages.CompletionItem[],
): Monaco.languages.CompletionItem[] {
  const seen = new Set<string>();
  const unique: Monaco.languages.CompletionItem[] = [];

  for (const item of items) {
    const key = [
      item.kind,
      completionItemLabelKey(item.label),
      completionItemLabelDetailKey(item.label),
      completionItemLabelDescriptionKey(item.label),
      item.detail ?? "",
      item.sortText ?? "",
      item.filterText ?? "",
    ].join("\u0000");

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

function completionItemLabelKey(label: Monaco.languages.CompletionItem["label"]): string {
  return typeof label === "string" ? label : label.label;
}

function completionItemLabelDetailKey(label: Monaco.languages.CompletionItem["label"]): string {
  return typeof label === "string" ? "" : (label.detail ?? "");
}

function completionItemLabelDescriptionKey(
  label: Monaco.languages.CompletionItem["label"],
): string {
  return typeof label === "string" ? "" : (label.description ?? "");
}

export function toLanguageServerCompletionContext(
  context: Monaco.languages.CompletionContext | undefined,
): LanguageServerCompletionContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    triggerCharacter: context.triggerCharacter ?? null,
    triggerKind: context.triggerKind === 1 ? 2 : context.triggerKind === 2 ? 3 : 1,
  };
}

export async function provideJavaScriptTypeScriptCompletionItems<
  Context extends CompletionProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: MonacoModel,
  position: MonacoPosition,
  completionContext?: Monaco.languages.CompletionContext,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CompletionList> {
  const request = boundary.createFeatureRequest(
    context,
    model,
    position,
    "completion",
    completionContext?.triggerKind === 0 ? "explicit" : "automatic",
  );
  if (!request) {
    return { suggestions: [] };
  }

  try {
    if (!(await boundary.flushActiveRequest(context, request))) {
      return { suggestions: [] };
    }
    const languageServerContext = toLanguageServerCompletionContext(completionContext);
    const startedAt = performance.now();
    const completion = await runBoundedJavaScriptTypeScriptProviderRequest(
      context.featuresGateway.completion(
        request.rootPath,
        request.position,
        languageServerContext,
        request.sessionId,
      ),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(completion) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request)
    ) {
      return { suggestions: [] };
    }
    const word = model.getWordUntilPosition(position);
    const range = {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    };
    const lspSuggestions = completion.items.map((item, index) =>
      boundary.attachStoredAuthority(
        toMonacoCompletionItem(
          monaco,
          item,
          request.rootPath,
          request.sessionId,
          request.path,
          range,
          context.completeFunctionCalls === true,
          `0_${String(index).padStart(4, "0")}`,
        ),
        request,
      ),
    );
    const snippets = javaScriptTypeScriptSnippetSuggestions(
      monaco,
      context,
      model,
      position,
      word,
      range,
      context.getActiveDocument()?.language,
    );
    const suggestions = dedupeJavaScriptTypeScriptCompletionItems([...lspSuggestions, ...snippets]);
    const durationMs = performance.now() - startedAt;
    context.recordLatency?.("completion", durationMs, request.rootPath);
    recordPerfProviderSample(
      "completion",
      { ms: durationMs, resultCount: suggestions.length },
      token,
    );
    return {
      ...(completion.isIncomplete ? { incomplete: true } : {}),
      suggestions,
    };
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return { suggestions: [] };
  }
}

export async function resolveJavaScriptTypeScriptCompletionItem<
  Context extends CompletionProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  item: Monaco.languages.CompletionItem,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CompletionItem> {
  const backedItem = item as LanguageServerBackedCompletionItem;
  if (
    !backedItem.__languageServerItem ||
    !backedItem.__workspaceRoot ||
    backedItem.__languageServerSessionId == null ||
    !boundary.isStoredSessionActive(
      context,
      backedItem.__workspaceRoot,
      backedItem.__languageServerSessionId,
    )
  ) {
    return item;
  }

  try {
    if (!(await boundary.flushStoredPayload(context, backedItem, "completionResolve"))) {
      return item;
    }
    const identifiedRequests = context.featuresGateway.identifiedRequests;
    if (!identifiedRequests?.resolveCompletionItem) {
      return item;
    }
    const resolved = await runBoundedJavaScriptTypeScriptProviderRequest(
      identifiedRequests.resolveCompletionItem(
        backedItem.__workspaceRoot,
        backedItem.__languageServerItem,
        backedItem.__languageServerSessionId,
      ),
      backedItem.__languageServerSessionId,
      token,
      backedItem.__workspaceRoot,
      undefined,
      context.cancelRequest ??
        ((rootPath, sessionId, requestId) =>
          identifiedRequests.cancelRequest(rootPath, sessionId, requestId)),
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(resolved) ||
      token?.isCancellationRequested ||
      !boundary.isStoredPayloadActive(context, backedItem, "completionResolve")
    ) {
      return item;
    }
    return boundary.attachStoredAuthority(
      {
        ...item,
        ...toMonacoCompletionItem(
          monaco,
          resolved,
          backedItem.__workspaceRoot,
          backedItem.__languageServerSessionId,
          backedItem.__sourcePath,
          backedItem.__completionRange ?? item.range,
          context.completeFunctionCalls === true,
          item.sortText,
        ),
      },
      backedItem,
    );
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportStoredPayloadError(context, backedItem, error);
    }
    return item;
  }
}

export function toMonacoCompletionItem(
  monaco: MonacoApi,
  item: LanguageServerCompletionItem,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  fallbackRange: Monaco.IRange | Monaco.languages.CompletionItemRanges,
  completeFunctionCalls: boolean,
  fallbackSortText?: string,
): LanguageServerBackedCompletionItem {
  const kind = monacoCompletionKindFromLspKind(monaco, item.kind);
  const insert = completionInsert(monaco, item, kind, completeFunctionCalls);
  const additionalTextEdits =
    item.additionalTextEdits && item.additionalTextEdits.length > 0
      ? item.additionalTextEdits.map((edit) => toMonacoTextEdit(monaco, edit))
      : undefined;

  return {
    __completionRange: fallbackRange,
    __languageServerItem: item,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    ...(additionalTextEdits ? { additionalTextEdits } : {}),
    ...(item.commitCharacters && item.commitCharacters.length > 0
      ? { commitCharacters: item.commitCharacters }
      : {}),
    detail: item.detail || undefined,
    documentation: toMonacoCompletionDocumentation(item),
    filterText: item.filterText || undefined,
    insertText: insert.insertText,
    ...(item.command
      ? {
          command: toMonacoLanguageServerCommand(rootPath, sessionId, sourcePath, item.command),
        }
      : insert.command
        ? { command: insert.command }
        : {}),
    ...(insert.insertTextRules ? { insertTextRules: insert.insertTextRules } : {}),
    kind,
    label: completionLabel(item),
    ...(item.preselect ? { preselect: true } : {}),
    range: item.textEdit
      ? toMonacoCompletionRange(monaco, item.textEdit, fallbackRange)
      : fallbackRange,
    sortText: item.sortText ?? fallbackSortText,
    ...(isDeprecatedCompletionItem(item)
      ? { tags: [monaco.languages.CompletionItemTag.Deprecated] }
      : {}),
  };
}

export function toMonacoLanguageServerCommand(
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command {
  return {
    arguments: [
      {
        command,
        ...(sourcePath ? { path: sourcePath } : {}),
        rootPath,
        sessionId,
      } satisfies ExecuteCodeActionCommandPayload,
    ],
    id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
    title: command.title || command.command,
  };
}

function isDeprecatedCompletionItem(item: LanguageServerCompletionItem): boolean {
  return Boolean(item.deprecated || item.tags?.includes(1));
}

function completionLabel(
  item: LanguageServerCompletionItem,
): string | Monaco.languages.CompletionItemLabel {
  if (!item.labelDetails) {
    return item.label;
  }

  return {
    ...(item.labelDetails.description ? { description: item.labelDetails.description } : {}),
    ...(item.labelDetails.detail ? { detail: item.labelDetails.detail } : {}),
    label: item.label,
  };
}

function toMonacoCompletionDocumentation(
  item: LanguageServerCompletionItem,
): string | Monaco.IMarkdownString | undefined {
  if (!item.documentation) {
    return undefined;
  }
  return item.documentationKind === "markdown" ? { value: item.documentation } : item.documentation;
}

function toMonacoCompletionRange(
  monaco: MonacoApi,
  edit: LanguageServerCompletionTextEdit,
  fallbackRange: Monaco.IRange | Monaco.languages.CompletionItemRanges,
): Monaco.IRange | Monaco.languages.CompletionItemRanges {
  if (edit.insert && edit.replace) {
    return {
      insert: toMonacoRange(monaco, edit.insert),
      replace: toMonacoRange(monaco, edit.replace),
    };
  }
  return edit.range ? toMonacoRange(monaco, edit.range) : fallbackRange;
}

function completionInsert(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    insertText: string | null;
    insertTextFormat?: number | null;
    insertTextMode?: number | null;
    kind: number | null;
    label: string;
    labelDetails?: { description?: string | null; detail?: string | null } | null;
    textEdit?: LanguageServerCompletionTextEdit | null;
    textEditText?: string | null;
  },
  kind: Monaco.languages.CompletionItemKind,
  completeFunctionCalls: boolean,
): {
  command?: Monaco.languages.Command;
  insertText: string;
  insertTextRules?: Monaco.languages.CompletionItemInsertTextRule;
} {
  const explicitInsertText = item.textEdit?.newText ?? item.textEditText ?? item.insertText;
  const insertText = explicitInsertText ?? item.label;
  const hasExplicitInsertText = explicitInsertText != null;
  const keepWhitespaceRule =
    item.insertTextMode === 1 ? monaco.languages.CompletionItemInsertTextRule.KeepWhitespace : 0;

  if (item.insertTextFormat === 2 || /\$(?:\d+|\{)/.test(insertText)) {
    return {
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet | keepWhitespaceRule,
    };
  }

  if (
    !completeFunctionCalls ||
    hasExplicitInsertText ||
    (kind !== monaco.languages.CompletionItemKind.Method &&
      kind !== monaco.languages.CompletionItemKind.Function)
  ) {
    return { insertText, ...(keepWhitespaceRule ? { insertTextRules: keepWhitespaceRule } : {}) };
  }

  const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(insertText.trim())?.[0];
  if (!name) {
    return { insertText, ...(keepWhitespaceRule ? { insertTextRules: keepWhitespaceRule } : {}) };
  }

  const hasKnownParameters = [item.detail, item.labelDetails?.detail].some((detail) =>
    hasCompletionParameters(detail || "", name),
  );

  return {
    command: hasKnownParameters
      ? { id: "editor.action.triggerParameterHints", title: "Trigger parameter hints" }
      : undefined,
    insertText: hasKnownParameters ? `${name}($0)` : `${name}()$0`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet | keepWhitespaceRule,
  };
}

function hasCompletionParameters(detail: string, name: string): boolean {
  return hasNamedCompletionParameters(detail, name) || hasLabelDetailParameters(detail);
}

function hasNamedCompletionParameters(detail: string, name: string): boolean {
  const match = new RegExp(`${escapeRegExp(name)}\\s*(?:<[^()]*>\\s*)?\\(([^)]*)\\)`).exec(detail);
  return Boolean(match?.[1].trim());
}

function hasLabelDetailParameters(detail: string): boolean {
  const match = /^\s*(?:<[^()]*>\s*)?\(([^)]*)\)/.exec(detail);
  return Boolean(match?.[1].trim());
}

function monacoCompletionKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null | undefined,
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
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
