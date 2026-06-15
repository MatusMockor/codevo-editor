import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  toLanguageServerTextDocumentPosition,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import { isLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export interface LanguageServerMonacoProviderContext {
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  reportError(error: unknown): void;
}

export function registerLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
): Disposable {
  const hover = monaco.languages.registerHoverProvider("php", {
    provideHover: (model, position) => provideHover(monaco, context, model, position),
  });
  const completion = monaco.languages.registerCompletionItemProvider("php", {
    provideCompletionItems: (model, position) =>
      provideCompletionItems(monaco, context, model, position),
  });

  return {
    dispose: () => {
      hover.dispose();
      completion.dispose();
    },
  };
}

async function provideHover(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Hover | null> {
  const request = featureRequestContext(context, model, position, "hover");

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const hover = await context.featuresGateway.hover(request.position);

    if (!hover) {
      return null;
    }

    return {
      contents: [{ value: hover.contents }],
    };
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideCompletionItems(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { suggestions: [] };
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const completion = await context.featuresGateway.completion(request.position);
    const word = model.getWordUntilPosition(position);
    const range = {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    };

    return {
      suggestions: completion.items.map((item) => ({
        detail: item.detail || undefined,
        documentation: item.documentation || undefined,
        insertText: item.insertText || item.label,
        kind: monaco.languages.CompletionItemKind.Text,
        label: item.label,
        range,
      })),
    };
  } catch (error) {
    context.reportError(error);
    return { suggestions: [] };
  }
}

function featureRequestContext(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature: "completion" | "hover",
) {
  const activeDocument = context.getActiveDocument();

  if (!activeDocument) {
    return null;
  }

  if (!isLanguageServerDocument(activeDocument)) {
    return null;
  }

  const path = modelPath(model);

  if (path !== activeDocument.path) {
    return null;
  }

  const status = context.getRuntimeStatus();

  if (status?.kind !== "running") {
    return null;
  }

  if (!canUseLanguageServerFeature(status.capabilities, feature)) {
    return null;
  }

  return {
    path,
    position: toLanguageServerTextDocumentPosition(path, position),
  };
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
