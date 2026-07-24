import type * as Monaco from "monaco-editor";
import type { DebugHoverEvaluationPort } from "../application/useDebugHoverEvaluation";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import {
  createDebugHoverExpressionIndex,
  type DebugHoverExpression,
  type DebugHoverExpressionIndex,
} from "../domain/debugHoverExpression";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import { debugInspectionOwnersEqual } from "../domain/debugVariablePages";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { modelMatchesWorkspacePath } from "./phpMonacoDocumentContext";

const debugHoverLanguages = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
] as const;

export const MAX_DEBUG_HOVER_IN_FLIGHT = 4;
export const MAX_DEBUG_HOVER_RENDERED_VALUE_BYTES = 8 * 1_024;
export const MAX_DEBUG_HOVER_RENDERED_TYPE_BYTES = 256;
export const MAX_DEBUG_HOVER_MARKDOWN_BYTES = 9 * 1_024;
export const DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID = "debug.hover.copyEvaluatePath";
const MAX_DEBUG_HOVER_RENDERED_ERROR_BYTES = 1_024;
let globalDebugHoverInFlight = 0;

export interface DebugHoverMonacoProviderContext {
  readonly debugHover: DebugHoverEvaluationPort;
  getAdmittedWorkspaceRoot(): string | null;
  resolveDocumentForModel(model: Monaco.editor.ITextModel): EditorDocument | null;
}

interface CachedExpressionIndex {
  readonly index: DebugHoverExpressionIndex | null;
  readonly version: number;
}

interface DebugHoverRequest {
  readonly documentPath: string;
  readonly modelUri: string;
  readonly modelVersion: number;
  readonly owner: DebugInspectionOwner;
  readonly rootPath: string;
  readonly sequence: number;
}

export function registerDebugHoverMonacoProviders(
  monaco: typeof Monaco,
  context: DebugHoverMonacoProviderContext,
): Monaco.IDisposable {
  let disposed = false;
  const expressionIndexes = new WeakMap<Monaco.editor.ITextModel, CachedExpressionIndex>();
  const modelSequences = new WeakMap<Monaco.editor.ITextModel, number>();
  const copyTokens = new Set<string>();
  const disposables = debugHoverLanguages.map((language) =>
    monaco.languages.registerHoverProvider(language, {
      provideHover: (model, position, token) => provideHover(model, position, token),
    }),
  );
  disposables.push(
    monaco.editor.addCommand({
      id: DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID,
      run: async (_accessor, ...args: unknown[]) => {
        const token = args[0];
        if (disposed || args.length !== 1 || typeof token !== "string" || !copyTokens.delete(token))
          return;
        await context.debugHover.copyEvaluatePath(token);
      },
    }),
  );

  async function provideHover(
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
    token?: Monaco.CancellationToken,
  ): Promise<Monaco.languages.Hover | null> {
    if (disposed || token?.isCancellationRequested) return null;
    const sequence = (modelSequences.get(model) ?? 0) + 1;
    modelSequences.set(model, sequence);
    const owner = context.debugHover.getOwner();
    const rootPath = context.getAdmittedWorkspaceRoot();
    const document = context.resolveDocumentForModel(model);
    if (
      !owner ||
      !rootPath ||
      !workspaceRootKeysEqual(rootPath, owner.rootKey) ||
      !document ||
      !modelMatchesWorkspacePath(model, rootPath, document.path)
    ) {
      return null;
    }
    if (globalDebugHoverInFlight >= MAX_DEBUG_HOVER_IN_FLIGHT) return null;

    let modelVersion: number;
    let expression: DebugHoverExpression | null | undefined;
    try {
      modelVersion = model.getVersionId();
      expression = expressionIndexForModel(model, modelVersion, expressionIndexes)?.at(position);
    } catch {
      return null;
    }
    if (!expression) return null;

    const request: DebugHoverRequest = {
      documentPath: document.path,
      modelUri: model.uri.toString(),
      modelVersion,
      owner,
      rootPath,
      sequence,
    };
    globalDebugHoverInFlight += 1;
    try {
      const result = await context.debugHover.evaluate(owner, expression.expression, token);
      if (!result || !requestIsCurrent(model, token, request)) return null;
      let copyToken: string | null = null;
      if (result.status === "ok" && result.evaluateName !== undefined) {
        copyToken = context.debugHover.registerCopyEvaluatePath(request.owner, result, () =>
          requestIsCurrent(model, undefined, request),
        );
        if (copyToken) copyTokens.add(copyToken);
      }
      return renderDebugHover(expression.range, result, copyToken);
    } catch {
      return null;
    } finally {
      globalDebugHoverInFlight -= 1;
    }
  }

  function requestIsCurrent(
    model: Monaco.editor.ITextModel,
    token: Monaco.CancellationToken | undefined,
    request: DebugHoverRequest,
  ): boolean {
    if (
      disposed ||
      token?.isCancellationRequested ||
      modelSequences.get(model) !== request.sequence ||
      model.getVersionId() !== request.modelVersion ||
      model.uri.toString() !== request.modelUri ||
      !workspaceRootKeysEqual(context.getAdmittedWorkspaceRoot(), request.rootPath) ||
      !debugInspectionOwnersEqual(context.debugHover.getOwner(), request.owner)
    ) {
      return false;
    }
    const currentDocument = context.resolveDocumentForModel(model);
    return (
      currentDocument?.path === request.documentPath &&
      modelMatchesWorkspacePath(model, request.rootPath, request.documentPath)
    );
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      copyTokens.forEach((token) => context.debugHover.revokeCopyEvaluatePath(token));
      copyTokens.clear();
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

function expressionIndexForModel(
  model: Monaco.editor.ITextModel,
  version: number,
  cache: WeakMap<Monaco.editor.ITextModel, CachedExpressionIndex>,
): DebugHoverExpressionIndex | null {
  const cached = cache.get(model);
  if (cached?.version === version) return cached.index;
  const index = createDebugHoverExpressionIndex(model.getValue());
  cache.set(model, { index, version });
  return index;
}

function renderDebugHover(
  range: Monaco.IRange,
  result: DebugEvaluationResult,
  copyToken: string | null,
): Monaco.languages.Hover {
  return {
    range,
    contents: [safeDebugHoverMarkdown(result, copyToken)],
  };
}

function safeDebugHoverMarkdown(
  result: DebugEvaluationResult,
  copyToken: string | null,
): Monaco.IMarkdownString {
  if (result.status === "error") {
    const message = truncateUtf8(
      normalizeDebugHoverText(result.message),
      MAX_DEBUG_HOVER_RENDERED_ERROR_BYTES,
    );
    return untrustedMarkdown(`Debug evaluation unavailable: ${escapeMarkdown(message)}`);
  }

  const value = truncateUtf8(
    normalizeDebugHoverText(result.value),
    MAX_DEBUG_HOVER_RENDERED_VALUE_BYTES,
  );
  const valueType = truncateUtf8(
    normalizeDebugHoverText(result.type ?? ""),
    MAX_DEBUG_HOVER_RENDERED_TYPE_BYTES,
  );
  const heading = valueType ? `**Debug value** · ${escapeMarkdown(valueType)}` : "**Debug value**";
  const codeBlock = value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  if (!copyToken) return untrustedMarkdown(`${heading}\n\n${codeBlock}`);
  const action = `[Copy as Expression](command:${DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID}?${encodeURIComponent(JSON.stringify([copyToken]))})`;
  const actionBytes = new TextEncoder().encode(`\n\n${action}`).byteLength;
  return {
    isTrusted: { enabledCommands: [DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID] },
    supportHtml: false,
    supportThemeIcons: false,
    value: `${truncateUtf8(`${heading}\n\n${codeBlock}`, MAX_DEBUG_HOVER_MARKDOWN_BYTES - actionBytes)}\n\n${action}`,
  };
}

function untrustedMarkdown(value: string): Monaco.IMarkdownString {
  return {
    isTrusted: false,
    supportHtml: false,
    supportThemeIcons: false,
    value: truncateUtf8(value, MAX_DEBUG_HOVER_MARKDOWN_BYTES),
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()<>#+.!|~-]/gu, "\\$&").replace(/\r?\n/gu, " ");
}

function normalizeDebugHoverText(value: string): string {
  return [...value.replace(/\r\n?/gu, "\n")]
    .map((character) =>
      character === "\n" || character === "\t" || !/\p{Cc}/u.test(character) ? character : "�",
    )
    .join("");
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  const ellipsis = new TextEncoder().encode("…");
  let end = maximumBytes - ellipsis.byteLength;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (end > 0) {
    try {
      return `${decoder.decode(bytes.slice(0, end))}…`;
    } catch {
      end -= 1;
    }
  }
  return "";
}
