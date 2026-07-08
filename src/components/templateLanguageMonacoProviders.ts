import type * as Monaco from "monaco-editor";
import {
  normalizeUserSnippets,
  snippetCompletionSuggestions,
} from "../domain/snippets";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  PhpCodeActionRange,
} from "../application/phpCodeActionTypes";
import type {
  BladeCompletion,
  BladeCompletionKind,
  LatteCompletion,
  LatteCompletionKind,
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export type {
  BladeCompletion,
  BladeCompletionKind,
  LatteCompletion,
  LatteCompletionKind,
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";

export function registerTemplateLanguageMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const bladeDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("blade", {
        provideDefinition: (model, position) =>
          provideBladeDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const bladeCompletion = monaco.languages.registerCompletionItemProvider(
    "blade",
    {
      // `$` opens the view-variable list and `>` completes `->` member access
      // during natural typing.
      triggerCharacters: ["@", "'", "\"", "-", ".", "$", ">"],
      provideCompletionItems: (model, position) =>
        provideBladeCompletionItems(monaco, context, model, position),
    },
  );
  const bladeCodeActions = context.provideBladeCodeActions
    ? monaco.languages.registerCodeActionProvider(
        "blade",
        {
          provideCodeActions: (model, range, actionContext) =>
            provideBladeCodeActions(
              monaco,
              context,
              handlers,
              model,
              range,
              actionContext,
            ),
        },
        { providedCodeActionKinds: ["quickfix"] },
      )
    : { dispose: () => undefined };
  const latteDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("latte", {
        provideDefinition: (model, position) =>
          provideLatteDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const latteCompletion = monaco.languages.registerCompletionItemProvider(
    "latte",
    {
      triggerCharacters: ["{", "$", "-", ">", "|", "'", "\"", ".", "/"],
      provideCompletionItems: (model, position) =>
        provideLatteCompletionItems(monaco, context, model, position),
    },
  );
  const neonDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("neon", {
        provideDefinition: (model, position) =>
          provideNeonDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const neonCompletion = monaco.languages.registerCompletionItemProvider(
    "neon",
    {
      triggerCharacters: ["\\", ":", " ", "-", "%", "@"],
      provideCompletionItems: (model, position) =>
        provideNeonCompletionItems(monaco, context, model, position),
    },
  );

  return {
    dispose: () => {
      bladeDefinition.dispose();
      bladeCompletion.dispose();
      bladeCodeActions.dispose();
      latteDefinition.dispose();
      latteCompletion.dispose();
      neonDefinition.dispose();
      neonCompletion.dispose();
    },
  };
}

async function provideBladeDefinition(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  if (!context.provideBladeDefinition) {
    return null;
  }

  const documentContext = activeTemplateDocumentContext(context, model, "blade");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);

  try {
    await context.provideBladeDefinition(source, offset);
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }
  }

  return null;
}

async function provideBladeCompletionItems(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  if (!context.provideBladeCompletions) {
    return { suggestions: [] };
  }

  const documentContext = activeTemplateDocumentContext(context, model, "blade");

  if (!documentContext) {
    return { suggestions: [] };
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const word = model.getWordUntilPosition(position);
  const fallbackRange = templateCompletionFallbackRange(position, word);
  const snippetSuggestions = bladeSnippetSuggestions(
    monaco,
    context,
    model,
    position,
    word,
  );

  try {
    const completions = await context.provideBladeCompletions(source, position);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return { suggestions: [] };
    }

    return {
      suggestions: [
        ...completions.map((completion, index) =>
          toMonacoBladeCompletion(
            monaco,
            model,
            source,
            fallbackRange,
            completion,
            index,
          ),
        ),
        ...snippetSuggestions,
      ],
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return { suggestions: [] };
  }
}

async function provideBladeCodeActions<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  if (
    !context.provideBladeCodeActions ||
    !bladeQuickFixKindRequested(actionContext.only)
  ) {
    return emptyBladeCodeActions();
  }

  const documentContext = activeTemplateDocumentContext(context, model, "blade");

  if (!documentContext) {
    return emptyBladeCodeActions();
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  try {
    const descriptors = await context.provideBladeCodeActions(
      source,
      codeActionOffsetRange(source, range),
    );

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return emptyBladeCodeActions();
    }

    return {
      actions: descriptors.map((descriptor) =>
        handlers.toCodeAction(monaco, context, model, descriptor),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return emptyBladeCodeActions();
  }
}

function bladeQuickFixKindRequested(only: string | undefined): boolean {
  return !only || only.startsWith("quickfix");
}

function emptyBladeCodeActions(): Monaco.languages.CodeActionList {
  return { actions: [], dispose: () => undefined };
}

function codeActionOffsetRange(
  source: string,
  range: Monaco.Range,
): PhpCodeActionRange {
  const start = offsetAtMonacoPosition(source, {
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  } as MonacoPosition);
  const end = offsetAtMonacoPosition(source, {
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  } as MonacoPosition);

  return start <= end ? { end, start } : { end: start, start: end };
}

async function provideLatteDefinition(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  if (!context.provideLatteDefinition) {
    return null;
  }

  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);

  try {
    await context.provideLatteDefinition(source, offset);
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }
  }

  return null;
}

async function provideLatteCompletionItems(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  if (!context.provideLatteCompletions) {
    return { suggestions: [] };
  }

  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return { suggestions: [] };
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const word = model.getWordUntilPosition(position);
  const fallbackRange = templateCompletionFallbackRange(position, word);

  try {
    const completions = await context.provideLatteCompletions(source, position);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return { suggestions: [] };
    }

    return {
      suggestions: completions.map((completion, index) =>
        toMonacoLatteCompletion(
          monaco,
          model,
          source,
          fallbackRange,
          completion,
          index,
        ),
      ),
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return { suggestions: [] };
  }
}

async function provideNeonDefinition(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  if (!context.provideNeonDefinition) {
    return null;
  }

  const documentContext = activeTemplateDocumentContext(context, model, "neon");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);

  try {
    await context.provideNeonDefinition(source, offset);
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }
  }

  return null;
}

async function provideNeonCompletionItems(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  if (!context.provideNeonCompletions) {
    return { suggestions: [] };
  }

  const documentContext = activeTemplateDocumentContext(context, model, "neon");

  if (!documentContext) {
    return { suggestions: [] };
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const word = model.getWordUntilPosition(position);
  const fallbackRange = templateCompletionFallbackRange(position, word);

  try {
    const completions = await context.provideNeonCompletions(source, position);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return { suggestions: [] };
    }

    return {
      suggestions: completions.map((completion, index) =>
        toMonacoNeonCompletion(
          monaco,
          model,
          source,
          fallbackRange,
          completion,
          index,
        ),
      ),
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return { suggestions: [] };
  }
}

function activeTemplateDocumentContext(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  language: "blade" | "latte" | "neon",
) {
  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath) {
    return null;
  }

  if (activeDocument.language !== language) {
    return null;
  }

  const path = modelPath(model);

  if (!path || path !== activeDocument.path) {
    return null;
  }

  return { activeDocument, path, rootPath };
}

function bladeSnippetSuggestions(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number; word?: string },
): Monaco.languages.CompletionItem[] {
  const typedWord = typeof word.word === "string" ? word.word : "";
  const line = model.getLineContent?.(position.lineNumber) ?? "";
  const hasLeadingAt = line[word.startColumn - 2] === "@";
  const typed = hasLeadingAt ? `@${typedWord}` : typedWord;
  const startColumn = hasLeadingAt
    ? Math.max(1, word.startColumn - 1)
    : word.startColumn;
  const range = {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn,
    startLineNumber: position.lineNumber,
  };

  return snippetCompletionSuggestions(
    monaco,
    "blade",
    typed,
    range,
    normalizeUserSnippets(context.getUserSnippets?.() ?? []),
  ) as Monaco.languages.CompletionItem[];
}

function isStoredWorkspaceRootActive(
  context: TemplateLanguageMonacoProviderContext,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

function modelSource(model: MonacoModel, fallbackSource: string): string {
  try {
    return model.getValue();
  } catch {
    return fallbackSource;
  }
}

function modelPath(model: MonacoModel): string | null {
  const uri = model.uri;

  if (uri.fsPath) {
    return uri.fsPath;
  }

  if (uri.path) {
    return decodeURIComponent(uri.path);
  }

  return null;
}

function offsetAtMonacoPosition(source: string, position: MonacoPosition): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);
  let offset = 0;

  for (let line = 0; line < targetLine && line < lines.length; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  if (targetLine >= lines.length) {
    return source.length;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

export function toMonacoBladeCompletion(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  fallbackRange: Monaco.IRange,
  completion: BladeCompletion,
  index: number,
): Monaco.languages.CompletionItem {
  const range =
    completion.replaceStart != null && completion.replaceEnd != null
      ? templateReplaceRange(
          monaco,
          model,
          source,
          completion.replaceStart,
          completion.replaceEnd,
        )
      : fallbackRange;

  return {
    detail: completion.detail,
    insertText: completion.insertText,
    kind: monacoBladeCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
  };
}

export function toMonacoLatteCompletion(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  fallbackRange: Monaco.IRange,
  completion: LatteCompletion,
  index: number,
): Monaco.languages.CompletionItem {
  const range =
    completion.replaceStart != null && completion.replaceEnd != null
      ? templateReplaceRange(
          monaco,
          model,
          source,
          completion.replaceStart,
          completion.replaceEnd,
        )
      : fallbackRange;

  return {
    detail: completion.detail,
    insertText: completion.insertText,
    kind: monacoLatteCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
  };
}

export function toMonacoNeonCompletion(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  fallbackRange: Monaco.IRange,
  completion: NeonCompletion,
  index: number,
): Monaco.languages.CompletionItem {
  const range =
    completion.replaceStart != null && completion.replaceEnd != null
      ? templateReplaceRange(
          monaco,
          model,
          source,
          completion.replaceStart,
          completion.replaceEnd,
        )
      : fallbackRange;

  return {
    detail: completion.detail,
    insertText: completion.insertText,
    kind: monacoNeonCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
  };
}

export function templateCompletionFallbackRange(
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number },
): Monaco.IRange {
  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    startLineNumber: position.lineNumber,
  };
}

function monacoBladeCompletionKind(
  monaco: MonacoApi,
  kind: BladeCompletionKind,
): Monaco.languages.CompletionItemKind {
  if (kind === "view") {
    return monaco.languages.CompletionItemKind.File;
  }

  if (kind === "component") {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (kind === "variable") {
    return monaco.languages.CompletionItemKind.Variable;
  }

  if (kind === "helper") {
    return monaco.languages.CompletionItemKind.Function;
  }

  if (kind === "member") {
    return monaco.languages.CompletionItemKind.Method;
  }

  return monaco.languages.CompletionItemKind.Keyword;
}

function monacoLatteCompletionKind(
  monaco: MonacoApi,
  kind: LatteCompletionKind,
): Monaco.languages.CompletionItemKind {
  if (kind === "template") {
    return monaco.languages.CompletionItemKind.File;
  }

  if (kind === "variable") {
    return monaco.languages.CompletionItemKind.Variable;
  }

  if (kind === "member") {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (kind === "filter") {
    return monaco.languages.CompletionItemKind.Function;
  }

  if (kind === "link") {
    return monaco.languages.CompletionItemKind.Method;
  }

  if (kind === "component") {
    return monaco.languages.CompletionItemKind.Module;
  }

  return monaco.languages.CompletionItemKind.Keyword;
}

function monacoNeonCompletionKind(
  monaco: MonacoApi,
  kind: NeonCompletionKind,
): Monaco.languages.CompletionItemKind {
  if (kind === "parameter") {
    return monaco.languages.CompletionItemKind.Variable;
  }

  if (kind === "service") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (kind === "method") {
    return monaco.languages.CompletionItemKind.Method;
  }

  return monaco.languages.CompletionItemKind.Class;
}

function templateReplaceRange(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  startOffset: number,
  endOffset: number,
): Monaco.IRange {
  const start = monacoPositionAtOffset(model, source, startOffset);
  const end = monacoPositionAtOffset(model, source, endOffset);

  return new monaco.Range(
    start.lineNumber,
    start.column,
    end.lineNumber,
    end.column,
  );
}

function monacoPositionAtOffset(
  model: MonacoModel,
  source: string,
  offset: number,
): { column: number; lineNumber: number } {
  const positionAt = (
    model as MonacoModel & {
      getPositionAt?: (value: number) => MonacoPosition;
    }
  ).getPositionAt;

  if (typeof positionAt === "function") {
    const position = positionAt.call(model, offset);

    return { column: position.column, lineNumber: position.lineNumber };
  }

  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber };
}
