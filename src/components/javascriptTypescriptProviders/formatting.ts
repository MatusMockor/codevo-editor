import type * as Monaco from "monaco-editor";
import type {
  LanguageServerFormattingOptions,
  LanguageServerTextEdit,
} from "../../domain/languageServerFeatures";
import type { JavaScriptTypeScriptLanguageServerProviderContext } from "../javascriptTypescriptLanguageServerMonacoProviders";
import type { JavaScriptTypeScriptDocumentRequestAuthority } from "../javascriptTypescriptProviderDocumentAuthority";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
} from "./requestBoundary";

export interface JavaScriptTypeScriptFormattingRequest extends JavaScriptTypeScriptDocumentRequestAuthority {
  readonly sessionId: number;
}

export interface JavaScriptTypeScriptFormattingDependencies {
  createRequest(
    context: JavaScriptTypeScriptLanguageServerProviderContext,
    model: Monaco.editor.ITextModel,
  ): JavaScriptTypeScriptFormattingRequest | null;
  flush(
    context: JavaScriptTypeScriptLanguageServerProviderContext,
    request: JavaScriptTypeScriptFormattingRequest,
  ): Promise<boolean>;
  isActive(
    context: JavaScriptTypeScriptLanguageServerProviderContext,
    request: JavaScriptTypeScriptFormattingRequest,
  ): boolean;
  reportError(
    context: JavaScriptTypeScriptLanguageServerProviderContext,
    request: JavaScriptTypeScriptFormattingRequest,
    error: unknown,
  ): void;
  toFormattingOptions(options: Monaco.languages.FormattingOptions): LanguageServerFormattingOptions;
  toMonacoTextEdit(edit: LanguageServerTextEdit): Monaco.languages.TextEdit;
}

export function toJavaScriptTypeScriptFormattingOptions(
  options: Monaco.languages.FormattingOptions,
): LanguageServerFormattingOptions {
  return {
    insertSpaces: options.insertSpaces,
    tabSize: options.tabSize,
  };
}

export async function provideJavaScriptTypeScriptDocumentFormattingEdits(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: Monaco.editor.ITextModel,
  options: Monaco.languages.FormattingOptions,
  token: Monaco.CancellationToken | undefined,
  dependencies: JavaScriptTypeScriptFormattingDependencies,
): Promise<Monaco.languages.TextEdit[]> {
  const request = dependencies.createRequest(context, model);
  if (!request) {
    return [];
  }

  try {
    if (!(await dependencies.flush(context, request))) {
      return [];
    }

    const formatting = context.featuresGateway.identifiedRequests?.formatting;
    if (!formatting) {
      return [];
    }
    const edits = await runBoundedJavaScriptTypeScriptProviderRequest(
      formatting(
        request.rootPath,
        request.path,
        dependencies.toFormattingOptions(options),
        request.sessionId,
      ),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );

    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(edits) ||
      !dependencies.isActive(context, request)
    ) {
      return [];
    }

    return edits.map(dependencies.toMonacoTextEdit);
  } catch (error) {
    dependencies.reportError(context, request, error);
    return [];
  }
}
