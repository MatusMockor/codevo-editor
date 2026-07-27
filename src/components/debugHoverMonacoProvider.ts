import type * as Monaco from "monaco-editor";
import type { DebugHoverEvaluationPort } from "../application/useDebugHoverEvaluation";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import {
  createDebugHoverExpressionIndex,
  MAX_DEBUG_HOVER_SOURCE_BYTES,
  MAX_DEBUG_HOVER_SOURCE_LINES,
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
export const MAX_DEBUG_HOVER_GLOBAL_UNSETTLED = 16;
export const MAX_DEBUG_HOVER_COPY_TOKENS = 64;
export const DEBUG_HOVER_REQUEST_TIMEOUT_MS = 2_000;
export const MAX_DEBUG_HOVER_RENDERED_VALUE_BYTES = 8 * 1_024;
export const MAX_DEBUG_HOVER_RENDERED_TYPE_BYTES = 256;
export const MAX_DEBUG_HOVER_MARKDOWN_BYTES = 9 * 1_024;
export const DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID = "debug.hover.copyEvaluatePath";
const MAX_DEBUG_HOVER_RENDERED_ERROR_BYTES = 1_024;

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
  readonly ownerEpoch: number;
  readonly rootPath: string;
  readonly sequence: number;
}

interface DebugHoverCopyToken {
  readonly isCurrent: () => boolean;
  readonly owner: DebugInspectionOwner;
}

interface ActiveDebugHoverRequest {
  readonly cancellation: AbortController;
  readonly lease: DebugHoverRequestLease;
}

class DebugHoverRequestLeaseCoordinator {
  readonly #leasedByOwner = new Map<string, number>();
  #unsettled = 0;

  acquire(owner: DebugInspectionOwner): DebugHoverRequestLease | null {
    const ownerKey = debugHoverOwnerKey(owner);
    const ownerLeases = this.#leasedByOwner.get(ownerKey) ?? 0;
    if (
      ownerLeases >= MAX_DEBUG_HOVER_IN_FLIGHT ||
      this.#unsettled >= MAX_DEBUG_HOVER_GLOBAL_UNSETTLED
    ) {
      return null;
    }
    this.#leasedByOwner.set(ownerKey, ownerLeases + 1);
    this.#unsettled += 1;
    return new DebugHoverRequestLease(this, ownerKey);
  }

  release(ownerKey: string): void {
    const ownerLeases = this.#leasedByOwner.get(ownerKey) ?? 0;
    if (ownerLeases <= 1) this.#leasedByOwner.delete(ownerKey);
    else this.#leasedByOwner.set(ownerKey, ownerLeases - 1);
  }

  settle(): void {
    this.#unsettled = Math.max(0, this.#unsettled - 1);
  }
}

class DebugHoverRequestLease {
  #leased = true;
  #settled = false;

  constructor(
    private readonly coordinator: DebugHoverRequestLeaseCoordinator,
    private readonly ownerKey: string,
  ) {}

  release(): void {
    if (!this.#leased) return;
    this.#leased = false;
    this.coordinator.release(this.ownerKey);
  }

  settle(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.release();
    this.coordinator.settle();
  }
}

const debugHoverRequestLeases = new DebugHoverRequestLeaseCoordinator();

export function registerDebugHoverMonacoProviders(
  monaco: typeof Monaco,
  context: DebugHoverMonacoProviderContext,
): Monaco.IDisposable {
  let disposed = false;
  const expressionIndexes = new WeakMap<Monaco.editor.ITextModel, CachedExpressionIndex>();
  const modelSequences = new WeakMap<Monaco.editor.ITextModel, number>();
  const copyTokens = new Map<string, DebugHoverCopyToken>();
  const activeRequests = new Set<ActiveDebugHoverRequest>();
  let observedOwner: DebugInspectionOwner | null = null;
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
        if (disposed || args.length !== 1 || typeof token !== "string") return;
        const action = copyTokens.get(token);
        if (!action) return;
        copyTokens.delete(token);
        let current = false;
        try {
          current = action.isCurrent();
        } catch {
          current = false;
        }
        if (!current) {
          context.debugHover.revokeCopyEvaluatePath(token);
          return;
        }
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
    const owner = observeOwner(context.debugHover.getOwner());
    revokeStaleCopyTokens(owner);
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
    const lease = debugHoverRequestLeases.acquire(owner);
    if (!lease) return null;
    let modelVersion: number;
    let modelUri: string;
    let ownerEpoch: number;
    let expression: DebugHoverExpression | null | undefined;
    try {
      if (model.isDisposed()) throw new Error("Disposed model.");
      modelVersion = model.getVersionId();
      modelUri = model.uri.toString();
      ownerEpoch = context.debugHover.getOwnerEpoch();
      expression = expressionIndexForModel(model, modelVersion, expressionIndexes)?.at(position);
    } catch {
      lease.settle();
      return null;
    }
    if (!expression) {
      lease.settle();
      return null;
    }

    const request: DebugHoverRequest = {
      documentPath: document.path,
      modelUri,
      modelVersion,
      owner,
      ownerEpoch,
      rootPath,
      sequence,
    };
    const cancellation = new AbortController();
    const activeRequest = { cancellation, lease };
    activeRequests.add(activeRequest);
    let resolveCancellation!: () => void;
    const cancellationResult = new Promise<null>((resolve) => {
      resolveCancellation = () => resolve(null);
    });
    const cancel = () => {
      cancellation.abort();
      lease.release();
      resolveCancellation();
    };
    const cancellationDisposable = token?.onCancellationRequested?.(() => {
      cancel();
    });
    if (token?.isCancellationRequested) cancel();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        cancel();
        resolve(null);
      }, DEBUG_HOVER_REQUEST_TIMEOUT_MS);
    });
    let physicalEvaluation: Promise<DebugEvaluationResult | null>;
    try {
      physicalEvaluation = context.debugHover.evaluate(
        owner,
        expression.expression,
        cancellation.signal,
      );
    } catch {
      physicalEvaluation = Promise.resolve(null);
    }
    const evaluation = physicalEvaluation
      .then(
        (result) => result,
        () => null,
      )
      .finally(() => lease.settle());
    try {
      const result = await Promise.race([evaluation, timeoutResult, cancellationResult]);
      if (!result || !requestIsCurrent(model, token, request)) return null;
      let copyToken: string | null = null;
      if (result.status === "ok" && result.evaluateName !== undefined) {
        const isCurrent = () => requestIsCurrent(model, undefined, request);
        copyToken = context.debugHover.registerCopyEvaluatePath(request.owner, result, isCurrent);
        if (copyToken) {
          while (copyTokens.size >= MAX_DEBUG_HOVER_COPY_TOKENS) {
            const oldest = copyTokens.keys().next().value as string | undefined;
            if (!oldest) break;
            copyTokens.delete(oldest);
            context.debugHover.revokeCopyEvaluatePath(oldest);
          }
          copyTokens.set(copyToken, { isCurrent, owner: { ...request.owner } });
        }
      }
      return renderDebugHover(expression.range, result, copyToken);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      cancellationDisposable?.dispose();
      activeRequests.delete(activeRequest);
    }
  }

  function revokeStaleCopyTokens(owner: DebugInspectionOwner | null): void {
    for (const [token, action] of copyTokens) {
      let current = false;
      try {
        current = action.isCurrent();
      } catch {
        current = false;
      }
      if (owner && debugInspectionOwnersEqual(action.owner, owner) && current) continue;
      copyTokens.delete(token);
      context.debugHover.revokeCopyEvaluatePath(token);
    }
  }

  function observeOwner(owner: DebugInspectionOwner | null): DebugInspectionOwner | null {
    if (!debugInspectionOwnersEqual(observedOwner, owner)) {
      observedOwner = owner ? { ...owner } : null;
    }
    return owner;
  }

  function requestIsCurrent(
    model: Monaco.editor.ITextModel,
    token: Monaco.CancellationToken | undefined,
    request: DebugHoverRequest,
  ): boolean {
    try {
      if (
        disposed ||
        token?.isCancellationRequested ||
        model.isDisposed() ||
        modelSequences.get(model) !== request.sequence ||
        model.getVersionId() !== request.modelVersion ||
        model.uri.toString() !== request.modelUri ||
        !workspaceRootKeysEqual(context.getAdmittedWorkspaceRoot(), request.rootPath) ||
        context.debugHover.getOwnerEpoch() !== request.ownerEpoch ||
        !debugInspectionOwnersEqual(observeOwner(context.debugHover.getOwner()), request.owner) ||
        context.debugHover.getOwnerEpoch() !== request.ownerEpoch
      ) {
        return false;
      }
    } catch {
      return false;
    }
    try {
      const currentDocument = context.resolveDocumentForModel(model);
      return (
        currentDocument?.path === request.documentPath &&
        modelMatchesWorkspacePath(model, request.rootPath, request.documentPath)
      );
    } catch {
      return false;
    }
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      activeRequests.forEach(({ cancellation, lease }) => {
        cancellation.abort();
        lease.release();
      });
      activeRequests.clear();
      copyTokens.forEach((_action, token) => context.debugHover.revokeCopyEvaluatePath(token));
      copyTokens.clear();
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

function debugHoverOwnerKey(owner: DebugInspectionOwner): string {
  return JSON.stringify([owner.rootKey, owner.sessionId, owner.pauseGeneration, owner.frameId]);
}

function expressionIndexForModel(
  model: Monaco.editor.ITextModel,
  version: number,
  cache: WeakMap<Monaco.editor.ITextModel, CachedExpressionIndex>,
): DebugHoverExpressionIndex | null {
  const cached = cache.get(model);
  if (cached?.version === version) return cached.index;
  const valueLength = model.getValueLength();
  const lineCount = model.getLineCount();
  if (
    !Number.isSafeInteger(valueLength) ||
    valueLength < 0 ||
    valueLength > MAX_DEBUG_HOVER_SOURCE_BYTES ||
    !Number.isSafeInteger(lineCount) ||
    lineCount <= 0 ||
    lineCount > MAX_DEBUG_HOVER_SOURCE_LINES
  ) {
    cache.set(model, { index: null, version });
    return null;
  }
  const source = model.getValue();
  const index =
    model.isDisposed() ||
    model.getVersionId() !== version ||
    model.getValueLength() !== valueLength ||
    model.getLineCount() !== lineCount ||
    source.length !== valueLength
      ? null
      : createDebugHoverExpressionIndex(source);
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
