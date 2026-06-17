import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  toLanguageServerTextDocumentPosition,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import { isLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { phpImplementationCodeLensTargets } from "../domain/phpImplementationCodeLenses";
import {
  phpMethodParameters,
  type PhpMethodCompletion,
  type PhpMethodParameter,
  type PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import { phpVariableCompletionsAt } from "../domain/phpScopeCompletions";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export const GO_TO_IMPLEMENTATION_AT_COMMAND_ID =
  "mockor.goToImplementationAt";

export interface LanguageServerMonacoProviderContext {
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  providePhpMethodCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpMethodSignature?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodSignature | null>;
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
    triggerCharacters: ["$", ">"],
    provideCompletionItems: (model, position) =>
      provideCompletionItems(monaco, context, model, position),
  });
  const signature = monaco.languages.registerSignatureHelpProvider("php", {
    signatureHelpRetriggerCharacters: [","],
    signatureHelpTriggerCharacters: ["(", ","],
    provideSignatureHelp: (model, position) =>
      provideSignatureHelp(monaco, context, model, position),
  });
  const codeLens = monaco.languages.registerCodeLensProvider("php", {
    provideCodeLenses: (model) => provideCodeLenses(context, model),
  });

  return {
    dispose: () => {
      hover.dispose();
      completion.dispose();
      signature.dispose();
      codeLens.dispose();
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
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return { suggestions: [] };
  }

  const word = model.getWordUntilPosition(position);
  const range = completionRange(model, position, word);
  const methodSuggestions = await phpMethodSuggestions(
    monaco,
    context,
    documentContext.activeDocument.content,
    position,
    range,
  );
  const variableSuggestions: Monaco.languages.CompletionItem[] =
    methodSuggestions.length > 0
      ? []
      : phpVariableCompletionsAt(
          documentContext.activeDocument.content,
          position,
        ).map((item, index) => ({
          detail: item.detail,
          insertText: item.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          label: item.name,
          range,
          sortText: `0_${String(index).padStart(4, "0")}`,
        }));
  const suggestions = [...methodSuggestions, ...variableSuggestions];
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { suggestions };
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const completion = await context.featuresGateway.completion(request.position);
    const lspSuggestions = completion.items.map((item, index) => ({
      detail: item.detail || undefined,
      documentation: item.documentation || undefined,
      insertText: item.insertText || item.label,
      kind: monaco.languages.CompletionItemKind.Text,
      label: item.label,
      range,
      sortText: `1_${String(index).padStart(4, "0")}`,
    }));

    return {
      suggestions: dedupeCompletionItems([...suggestions, ...lspSuggestions]),
    };
  } catch (error) {
    context.reportError(error);
    return { suggestions };
  }
}

async function phpMethodSuggestions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  source: string,
  position: MonacoPosition,
  range: ReturnType<typeof completionRange>,
): Promise<Monaco.languages.CompletionItem[]> {
  if (!context.providePhpMethodCompletions) {
    return [];
  }

  try {
    const methods = await context.providePhpMethodCompletions(source, position);

    return methods.map((item, index) => ({
      command: phpMethodParameters(item.parameters).length
        ? {
            id: "editor.action.triggerParameterHints",
            title: "Trigger parameter hints",
          }
        : undefined,
      detail: phpMethodDetail(item),
      documentation: phpMethodDocumentation(item),
      insertText: phpMethodSnippet(item),
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Method,
      label: item.name,
      range,
      sortText: `0_${String(index).padStart(4, "0")}`,
    }));
  } catch (error) {
    context.reportError(error);
    return [];
  }
}

async function provideSignatureHelp(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.SignatureHelpResult | null> {
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext || !context.providePhpMethodSignature) {
    return null;
  }

  try {
    const signature = await context.providePhpMethodSignature(
      documentContext.activeDocument.content,
      position,
    );

    if (!signature) {
      return null;
    }

    return {
      dispose: () => undefined,
      value: {
        activeParameter: Math.min(
          signature.argumentIndex,
          Math.max(0, signature.parameters.length - 1),
        ),
        activeSignature: 0,
        signatures: [
          {
            documentation: signature.method.declaringClassName,
            label: phpMethodSignatureLabel(signature.method),
            parameters: signature.parameters.map((parameter) => ({
              label: phpParameterLabel(parameter),
            })),
          },
        ],
      },
    };
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

function provideCodeLenses(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Monaco.languages.CodeLensList {
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return {
      dispose: () => undefined,
      lenses: [],
    };
  }

  return {
    dispose: () => undefined,
    lenses: phpImplementationCodeLensTargets(
      documentContext.activeDocument.content,
    ).map((target) => ({
      command: {
        arguments: [target.position],
        id: GO_TO_IMPLEMENTATION_AT_COMMAND_ID,
        title: "Go to implementation",
      },
      range: {
        endColumn: target.position.column + target.methodName.length,
        endLineNumber: target.position.lineNumber,
        startColumn: target.position.column,
        startLineNumber: target.position.lineNumber,
      },
    })),
  };
}

function phpMethodDetail(item: PhpMethodCompletion): string {
  const parameters = item.parameters ? `(${item.parameters})` : "()";
  const returnType = item.returnType ? `: ${item.returnType}` : "";

  return `${item.declaringClassName}${parameters}${returnType}`;
}

function phpMethodDocumentation(item: PhpMethodCompletion): string {
  const parameters = phpMethodParameters(item.parameters);

  if (!parameters.length) {
    return `${item.declaringClassName}::${item.name}()`;
  }

  return [
    `${item.declaringClassName}::${item.name}()`,
    "",
    ...parameters.map((parameter) => `- ${phpParameterLabel(parameter)}`),
  ].join("\n");
}

function phpMethodSignatureLabel(item: PhpMethodCompletion): string {
  const parameters = item.parameters ? `(${item.parameters})` : "()";
  const returnType = item.returnType ? `: ${item.returnType}` : "";

  return `${item.name}${parameters}${returnType}`;
}

function phpMethodSnippet(item: PhpMethodCompletion): string {
  const requiredParameters = phpMethodParameters(item.parameters).filter(
    (parameter) => !parameter.optional,
  );

  if (!requiredParameters.length) {
    return `${item.name}()`;
  }

  return `${item.name}(${requiredParameters
    .map((parameter, index) => {
      const placeholder = parameter.name.replace(/^\$/, "");
      return `\${${index + 1}:${escapeSnippetPlaceholder(placeholder)}}`;
    })
    .join(", ")})`;
}

function phpParameterLabel(parameter: PhpMethodParameter): string {
  const type = parameter.type ? `${parameter.type} ` : "";
  const defaultValue =
    parameter.defaultValue !== null ? ` = ${parameter.defaultValue}` : "";

  return `${type}${parameter.name}${defaultValue}`;
}

function escapeSnippetPlaceholder(value: string): string {
  return value.replace(/[\\}$]/g, "\\$&");
}

function activePhpDocumentContext(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
) {
  const activeDocument = context.getActiveDocument();

  if (!activeDocument) {
    return null;
  }

  if (activeDocument.language !== "php") {
    return null;
  }

  const path = modelPath(model);

  if (path !== activeDocument.path) {
    return null;
  }

  return {
    activeDocument,
    path,
  };
}

function completionRange(
  model: MonacoModel,
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number },
) {
  const line = model.getLineContent?.(position.lineNumber) ?? "";
  const characterBeforeWord = line[word.startColumn - 2] || "";
  const startColumn =
    characterBeforeWord === "$"
      ? Math.max(1, word.startColumn - 1)
      : word.startColumn;

  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn,
    startLineNumber: position.lineNumber,
  };
}

function dedupeCompletionItems(
  items: Monaco.languages.CompletionItem[],
): Monaco.languages.CompletionItem[] {
  const seen = new Set<string>();
  const unique: Monaco.languages.CompletionItem[] = [];

  for (const item of items) {
    const key = String(item.label).toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
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
