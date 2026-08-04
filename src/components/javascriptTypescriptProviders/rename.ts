import type * as Monaco from "monaco-editor";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerWorkspaceEdit,
} from "../../domain/languageServerFeatures";
import type { LatencyOperationKind } from "../../domain/latencyTracker";
import { perfRenameApplySuppressed, recordPerfProviderSample } from "../perfScenarioBridge";
import type { JavaScriptTypeScriptProviderRequestBoundary } from "./requestBoundary";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
  type JavaScriptTypeScriptProviderRequestCancellationPort,
} from "./requestBoundary";
import { toMonacoRange } from "./sharedMappings";

interface RenameContext {
  applyWorkspaceEdit?: unknown;
  cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort;
  featuresGateway: Pick<JavaScriptTypeScriptLanguageServerFeaturesGateway, "identifiedRequests">;
  recordLatency?(feature: LatencyOperationKind, durationMs: number, rootPath: string): void;
}

export interface JavaScriptTypeScriptRenameDependencies<Context> {
  applyWorkspaceEdit(
    monaco: typeof Monaco,
    context: Context,
    edit: LanguageServerWorkspaceEdit,
    rootPath: string,
    isStillActive: () => boolean,
  ): Promise<boolean>;
  editIsFullyInRoot(edit: LanguageServerWorkspaceEdit, rootPath: string): boolean;
  toWorkspaceEdit(
    monaco: typeof Monaco,
    model: Monaco.editor.ITextModel,
    edit: LanguageServerWorkspaceEdit,
    rootPath: string,
  ): Monaco.languages.WorkspaceEdit;
}

export async function provideJavaScriptTypeScriptRenameEdits<Context extends RenameContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  dependencies: JavaScriptTypeScriptRenameDependencies<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  newName: string,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.WorkspaceEdit | null> {
  const request = boundary.createFeatureRequest(context, model, position, "rename");
  if (!request) {
    return null;
  }
  try {
    if (!(await boundary.flushActiveRequest(context, request))) {
      return null;
    }
    const identifiedRequests = context.featuresGateway.identifiedRequests;
    if (!identifiedRequests?.rename) {
      return null;
    }
    const startedAt = performance.now();
    const edit = await runBoundedJavaScriptTypeScriptProviderRequest(
      identifiedRequests.rename(request.rootPath, request.position, newName, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest ??
        ((rootPath, sessionId, requestId) =>
          identifiedRequests.cancelRequest(rootPath, sessionId, requestId)),
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(edit) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request) ||
      !edit
    ) {
      return null;
    }
    const converted = dependencies.toWorkspaceEdit(monaco, model, edit, request.rootPath);
    const durationMs = performance.now() - startedAt;
    context.recordLatency?.("rename", durationMs, request.rootPath);
    recordPerfProviderSample("rename", {
      ms: durationMs,
      resultCount: workspaceEditResourceCount(converted),
    });
    if (!dependencies.editIsFullyInRoot(edit, request.rootPath)) {
      return null;
    }
    if (perfRenameApplySuppressed()) {
      return { edits: [] };
    }
    if (context.applyWorkspaceEdit) {
      const applied = await dependencies.applyWorkspaceEdit(
        monaco,
        context,
        edit,
        request.rootPath,
        () => token?.isCancellationRequested !== true && boundary.isActiveRequest(context, request),
      );
      return applied &&
        token?.isCancellationRequested !== true &&
        boundary.isActiveRequest(context, request)
        ? { edits: [] }
        : null;
    }
    return converted;
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return null;
  }
}

function workspaceEditResourceCount(edit: Monaco.languages.WorkspaceEdit): number {
  const resources = new Set<string>();

  for (const entry of edit.edits) {
    const resource = (entry as { resource?: { toString(): string } }).resource;

    if (resource) {
      resources.add(resource.toString());
    }
  }

  return resources.size;
}

export async function resolveJavaScriptTypeScriptRenameLocation<Context extends RenameContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
): Promise<(Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null> {
  const request = boundary.createFeatureRequest(context, model, position, "prepareRename");
  if (!request) {
    return null;
  }
  try {
    if (!(await boundary.flushActiveRequest(context, request))) {
      return null;
    }
    const identifiedRequests = context.featuresGateway.identifiedRequests;
    if (!identifiedRequests?.prepareRename) {
      return null;
    }
    const prepared = await runBoundedJavaScriptTypeScriptProviderRequest(
      identifiedRequests.prepareRename(request.rootPath, request.position, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest ??
        ((rootPath, sessionId, requestId) =>
          identifiedRequests.cancelRequest(rootPath, sessionId, requestId)),
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(prepared) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request)
    ) {
      return null;
    }
    if (!prepared?.range || prepared.defaultBehavior) {
      const word = model.getWordAtPosition(position);
      if (!word) {
        return {
          rejectReason: "Cannot rename this symbol.",
        } as Monaco.languages.RenameLocation & Monaco.languages.Rejection;
      }
      return {
        range: {
          endColumn: word.endColumn,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          startLineNumber: position.lineNumber,
        },
        text: word.word,
      };
    }
    const range = toMonacoRange(monaco, prepared.range);
    return { range, text: prepared.placeholder ?? model.getValueInRange(range) };
  } catch (error) {
    if (token?.isCancellationRequested || !boundary.isActiveRequest(context, request)) {
      return null;
    }
    return {
      rejectReason: error instanceof Error ? error.message : String(error),
    } as Monaco.languages.RenameLocation & Monaco.languages.Rejection;
  }
}
