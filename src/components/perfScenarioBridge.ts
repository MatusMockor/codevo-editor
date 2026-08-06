import type {
  editor as MonacoEditor,
  languages as MonacoLanguages,
  CancellationToken,
  Position,
} from "monaco-editor";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics } from "../domain/javaScriptTypeScriptLargeDocumentCapability";
import {
  createConservativeWorkspaceRootFromPath,
  parseWorkspacePath,
} from "../domain/workspacePath";
import {
  defaultLargeSmartDocumentPolicy,
  largeSmartDocumentStatusFromMetrics,
} from "../domain/largeDocumentPolicy";
import { strictModeEnabled } from "../perfLaneRenderMode";
import { modelPath } from "./phpMonacoDocumentContext";
import { perfProductionCaptureEnabled } from "./perfProductionCapture";

const MAX_TYPED_CHARACTERS = 2000;
const MAX_TAB_SWITCHES = 200;
const MAX_QUICK_OPEN_FRAMES = 600;
const MAX_RENAME_ACTION_FRAMES = 300;
const MAX_PROVIDER_PROBE_SAMPLES_PER_KIND = 64;
const TIMER_QUANTIZATION_MAX_READS = 200000;
const TIMER_QUANTIZATION_BUDGET_MS = 50;
const TIMER_QUANTIZATION_MIN_POSITIVE_DELTAS = 50;
const RENAME_ACTION_ID = "editor.action.rename";
const CANCEL_RENAME_INPUT_COMMAND_ID = "cancelRenameInput";
const ACCEPT_RENAME_INPUT_COMMAND_ID = "acceptRenameInput";
const RENAME_INPUT_SELECTOR = ".rename-box input.rename-input";
const QUICK_OPEN_RESULT_SELECTOR = ".quick-open .quick-open-result";
const PERF_BRIDGE_STORAGE_KEY = "codevo.perfBridge";

export interface PerfRetainedCounts {
  models: number;
  editors: number;
}

export interface PerfMemorySample {
  usedJsHeapBytes: number | null;
}

export type PerfLargeSmartDocumentReason =
  "character-limit" | "line-limit" | "invalid-metrics" | "no-active-model";

export interface PerfLargeSmartDocumentStatus {
  readonly degraded: boolean;
  readonly reason: PerfLargeSmartDocumentReason | null;
  readonly lineCount: number | null;
  readonly utf16Length: number | null;
  readonly lineLimit: number;
  readonly characterLimit: number;
}

export type PerfJavaScriptTypeScriptDocumentCapability =
  | {
      readonly tier: "full";
      readonly reason: null;
      readonly lineCount: number;
      readonly utf16Length: number;
    }
  | {
      readonly tier: "explicit-interactive";
      readonly reason: "character-limit" | "line-limit";
      readonly lineCount: number;
      readonly utf16Length: number;
    }
  | {
      readonly tier: "editing-only";
      readonly reason: "full-sync-utf16-limit" | "invalid-metrics" | "no-active-model";
      readonly lineCount: number | null;
      readonly utf16Length: number | null;
    };

export type PerfLanguageServerRuntimeKind = LanguageServerRuntimeStatus["kind"] | "none";

export interface PerfLanguageServerRuntimeStatus {
  readonly kind: PerfLanguageServerRuntimeKind;
  readonly running: boolean;
}

export interface PerfTypingScenarioResult {
  readonly dispatchMs: number[];
  readonly frameMs: number[];
  readonly typedCharacters: string[];
  readonly missedDispatches: number;
  readonly restored: boolean;
}

export interface PerfTabSwitchMeasurement {
  readonly durationsMs: number[];
  readonly assertionFailures: string[];
}

export interface PerfQuickOpenUiSample {
  readonly ms: number;
  readonly resultCount: number;
}

export type PerfProviderProbeKind =
  "completion" | "definition" | "references" | "rename" | "fileSearchEngine";

export interface PerfProviderProbeSample {
  readonly ms: number;
  readonly resultCount: number;
  readonly target?: string;
}

export interface PerfSampleProbe {
  record(kind: PerfProviderProbeKind, sample: PerfProviderProbeSample): void;
  renameApplySuppressed(): boolean;
}

export interface PerfEnvironmentSample {
  readonly bundleMode: "dev" | "production";
  readonly windowMode: "focus-only" | "always-on-top-diagnostic" | "unknown";
  readonly strictMode: boolean;
  readonly timerQuantizationMs?: number;
  readonly windowSize: { readonly width: number; readonly height: number };
  readonly platform: string;
}

export interface PerfTextPosition {
  readonly lineNumber: number;
  readonly column: number;
}

export interface PerfDocumentAuthorityLease {
  readonly __codevoPerfDocumentAuthorityLease: "opaque";
}

export interface PerfProviderProbeBatchLease {
  readonly __codevoPerfProviderProbeBatchLease: "opaque";
}

export interface PerfMeasuredLanguageProviders {
  readonly completion?: MonacoLanguages.CompletionItemProvider;
  readonly definition?: MonacoLanguages.DefinitionProvider;
  readonly references?: MonacoLanguages.ReferenceProvider;
  readonly rename?: MonacoLanguages.RenameProvider;
}

export interface PerfScenarioBridge {
  getLanguageServerRuntimeStatus(): PerfLanguageServerRuntimeStatus;
  getLatencySnapshot(): LatencySnapshotEntry[];
  clearLatencyMetrics(): void;
  runTypingScenario(text: string): Promise<PerfTypingScenarioResult | null>;
  measureTabSwitches(paths: readonly string[]): Promise<PerfTabSwitchMeasurement>;
  runQuickOpenQuery(query: string): Promise<boolean>;
  runQuickOpenUiQuery(query: string): Promise<PerfQuickOpenUiSample | null>;
  runEditorAction(actionId: string): Promise<boolean>;
  runRenameWithNewName(newName: string): Promise<boolean>;
  captureActiveDocumentAuthority(expectedPath: string): PerfDocumentAuthorityLease | null;
  beginProviderProbeBatch(
    authority: PerfDocumentAuthorityLease,
  ): PerfProviderProbeBatchLease | null;
  cancelProviderProbeBatch(batch: PerfProviderProbeBatchLease): void;
  runCompletionProbe(
    position: PerfTextPosition,
    authority?: PerfDocumentAuthorityLease,
    batch?: PerfProviderProbeBatchLease,
  ): Promise<boolean>;
  runDefinitionProbe(
    position: PerfTextPosition,
    authority?: PerfDocumentAuthorityLease,
    batch?: PerfProviderProbeBatchLease,
  ): Promise<boolean>;
  runReferencesProbe(
    position: PerfTextPosition,
    authority?: PerfDocumentAuthorityLease,
    batch?: PerfProviderProbeBatchLease,
  ): Promise<boolean>;
  runRenameProbe(
    position: PerfTextPosition,
    newName: string,
    authority?: PerfDocumentAuthorityLease,
    batch?: PerfProviderProbeBatchLease,
  ): Promise<boolean>;
  getProviderProbeSamples(kind: PerfProviderProbeKind): PerfProviderProbeSample[];
  clearProviderProbeSamples(): void;
  restoreActiveEditorContent(expectedText: string): boolean;
  getEnvironmentSample(): PerfEnvironmentSample;
  /**
   * O(1), metrics-derived observation for the active Monaco model. Raw UTF-8
   * and Unicode admission remain owned by the document-sync boundary.
   */
  getJavaScriptTypeScriptDocumentCapability(
    authority?: PerfDocumentAuthorityLease,
  ): PerfJavaScriptTypeScriptDocumentCapability | null;
  getLargeSmartDocumentStatus(): PerfLargeSmartDocumentStatus;
  getRetainedCounts(): PerfRetainedCounts;
  getMemorySample(): PerfMemorySample;
}

declare global {
  interface Window {
    __codevoPerf?: PerfScenarioBridge;
    __codevoPerfProbe?: PerfSampleProbe;
  }
}

interface PerfScenarioBridgeEnvironment {
  DEV?: boolean;
  VITE_CODEVO_PERF_BRIDGE?: string;
  VITE_CODEVO_PERF_WINDOW_MODE?: string;
  VITE_CODEVO_PERF_PRODUCTION_CAPTURE?: string;
}

export function perfScenarioBridgeEnabled(
  environment: PerfScenarioBridgeEnvironment = import.meta.env,
  storage: Pick<Storage, "getItem"> | null | undefined = window.localStorage,
): boolean {
  if (perfProductionCaptureEnabled(environment)) {
    return true;
  }

  if (!environment.DEV) {
    return false;
  }

  if (environment.VITE_CODEVO_PERF_BRIDGE === "1") {
    return true;
  }

  try {
    return storage?.getItem(PERF_BRIDGE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface PerfScenarioBridgeDependencies {
  readonly getLatencySnapshot: () => LatencySnapshotEntry[];
  readonly clearLatencyMetrics: () => void;
  readonly activateDocument: (path: string) => void;
  readonly setQuickOpenOpen: (isOpen: boolean) => void;
  readonly setQuickOpenQuery: (query: string) => void;
  readonly isQuickOpenLoading: () => boolean;
  readonly getActiveEditor: () => MonacoEditor.ICodeEditor | null;
  readonly getRetainedCounts: () => PerfRetainedCounts;
  readonly getLanguageServerRuntimeStatus?: () => LanguageServerRuntimeStatus | null;
  readonly getVisibleRenameInput?: (editor: MonacoEditor.ICodeEditor) => HTMLInputElement | null;
  readonly getActiveDocumentPath?: () => string | null;
  readonly getActiveDocumentGeneration?: () => number;
  readonly onDidChangeActiveDocument?: (listener: () => void) => { dispose(): void };
  readonly countQuickOpenResults?: () => number;
  readonly bundleEnvironment?: PerfScenarioBridgeEnvironment;
  readonly scheduleFrame?: (callback: () => void) => void;
  readonly now?: () => number;
}

type FrameScheduler = (callback: () => void) => void;

function defaultScheduleFrame(callback: () => void): void {
  requestAnimationFrame(() => {
    callback();
  });
}

function defaultNow(): number {
  return performance.now();
}

function nextFrame(scheduleFrame: FrameScheduler): Promise<void> {
  return new Promise<void>((resolve) => {
    scheduleFrame(() => {
      resolve();
    });
  });
}

function defaultGetVisibleRenameInput(editor: MonacoEditor.ICodeEditor): HTMLInputElement | null {
  const scopes = [editor.getContainerDomNode(), document.body];

  for (const scope of scopes) {
    const candidate = scope?.querySelector<HTMLInputElement>(RENAME_INPUT_SELECTOR) ?? null;

    if (candidate && candidate.getClientRects().length > 0) {
      return candidate;
    }
  }

  return null;
}

function defaultCountQuickOpenResults(): number {
  return document.querySelectorAll(QUICK_OPEN_RESULT_SELECTOR).length;
}

function readLargeSmartDocumentStatus(
  editor: MonacoEditor.ICodeEditor | null,
): PerfLargeSmartDocumentStatus {
  const policy = defaultLargeSmartDocumentPolicy;
  const model = editor?.getModel() ?? null;

  if (!model) {
    return {
      degraded: false,
      reason: "no-active-model",
      lineCount: null,
      utf16Length: null,
      lineLimit: policy.lineLimit,
      characterLimit: policy.characterLimit,
    };
  }

  const lineCount = model.getLineCount();
  const utf16Length = model.getValueLength();
  const result = largeSmartDocumentStatusFromMetrics({ lineCount, utf16Length }, policy);

  return {
    degraded: result.kind !== "eligible",
    reason: result.kind === "eligible" ? null : result.reason,
    lineCount,
    utf16Length,
    lineLimit: policy.lineLimit,
    characterLimit: policy.characterLimit,
  };
}

function readJavaScriptTypeScriptDocumentCapability(
  editor: MonacoEditor.ICodeEditor | null,
): PerfJavaScriptTypeScriptDocumentCapability {
  const model = editor?.getModel() ?? null;
  if (!model) {
    return {
      tier: "editing-only",
      reason: "no-active-model",
      lineCount: null,
      utf16Length: null,
    };
  }

  let lineCount: number;
  let utf16Length: number;
  try {
    lineCount = model.getLineCount();
    utf16Length = model.getValueLength();
  } catch {
    return {
      tier: "editing-only",
      reason: "invalid-metrics",
      lineCount: null,
      utf16Length: null,
    };
  }

  const capability = classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(
    { lineCount, utf16Length },
    defaultLargeSmartDocumentPolicy,
  );
  switch (capability.kind) {
    case "full":
      return { tier: "full", reason: null, lineCount, utf16Length };
    case "editing-degraded-interactive-lsp":
      return {
        tier: "explicit-interactive",
        reason: capability.reason,
        lineCount,
        utf16Length,
      };
    case "editing-only":
      return {
        tier: "editing-only",
        reason:
          capability.reason === "full-sync-utf16-limit"
            ? "full-sync-utf16-limit"
            : "invalid-metrics",
        lineCount: Number.isSafeInteger(lineCount) && lineCount >= 1 ? lineCount : null,
        utf16Length: Number.isSafeInteger(utf16Length) && utf16Length >= 0 ? utf16Length : null,
      };
  }
}

const UNKNOWN_LANGUAGE_SERVER_RUNTIME_STATUS: PerfLanguageServerRuntimeStatus = Object.freeze({
  kind: "none",
  running: false,
});

function readLanguageServerRuntimeStatus(
  read: (() => LanguageServerRuntimeStatus | null) | undefined,
): PerfLanguageServerRuntimeStatus {
  if (!read) {
    return UNKNOWN_LANGUAGE_SERVER_RUNTIME_STATUS;
  }

  try {
    const status = read();

    if (!status) {
      return UNKNOWN_LANGUAGE_SERVER_RUNTIME_STATUS;
    }

    return { kind: status.kind, running: status.kind === "running" };
  } catch {
    return UNKNOWN_LANGUAGE_SERVER_RUNTIME_STATUS;
  }
}

function readUsedJsHeapBytes(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;

  if (typeof memory?.usedJSHeapSize !== "number") {
    return null;
  }

  return memory.usedJSHeapSize;
}

interface ProviderProbeState {
  readonly samples: Map<PerfProviderProbeKind, PerfProviderProbeSample[]>;
  dropped: number;
  cleanup?: () => void;
}

let activeProviderProbe: ProviderProbeState | null = null;
const interactiveRenameApplySuppressionOwners = new Set<symbol>();
const providerRenameApplySuppressionOwners = new WeakMap<CancellationToken, Set<symbol>>();
const measuredProviderTokenState = new WeakMap<CancellationToken, { active: boolean }>();

interface PerfCancellationTokenSource {
  readonly token: CancellationToken;
  cancel(): void;
}

interface PerfProviderOperation {
  readonly source: PerfCancellationTokenSource;
  cancel(): void;
  finish(): void;
}

function createPerfCancellationTokenSource(): PerfCancellationTokenSource {
  let cancelled = false;
  const listeners = new Set<(event: unknown) => unknown>();
  const token: CancellationToken = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: (listener) => {
      if (cancelled) {
        queueMicrotask(() => listener(undefined));
      } else {
        listeners.add(listener);
      }
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return {
    token,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      for (const listener of listeners) listener(undefined);
      listeners.clear();
    },
  };
}

function createProviderProbeState(): ProviderProbeState {
  return { samples: new Map(), dropped: 0 };
}

function acquireRenameApplySuppression(token?: CancellationToken): () => void {
  const owner = Symbol("perf-rename-apply-suppression");
  const owners = token
    ? (providerRenameApplySuppressionOwners.get(token) ?? new Set<symbol>())
    : interactiveRenameApplySuppressionOwners;
  if (token) providerRenameApplySuppressionOwners.set(token, owners);
  owners.add(owner);
  let owned = true;
  return () => {
    if (!owned) return;
    owned = false;
    owners.delete(owner);
    if (token && owners.size === 0) providerRenameApplySuppressionOwners.delete(token);
  };
}

export function recordPerfProviderSample(
  kind: PerfProviderProbeKind,
  sample: PerfProviderProbeSample,
  token?: CancellationToken,
): void {
  const state = activeProviderProbe;

  if (!state) {
    return;
  }

  const measuredToken = token ? measuredProviderTokenState.get(token) : undefined;
  if (measuredToken && (!measuredToken.active || token?.isCancellationRequested)) {
    return;
  }

  if (!Number.isFinite(sample.ms) || sample.ms < 0) {
    return;
  }

  if (!Number.isFinite(sample.resultCount) || sample.resultCount < 0) {
    return;
  }

  const normalized: PerfProviderProbeSample =
    sample.target === undefined
      ? { ms: sample.ms, resultCount: sample.resultCount }
      : { ms: sample.ms, resultCount: sample.resultCount, target: sample.target };
  const existing = state.samples.get(kind);

  if (!existing) {
    state.samples.set(kind, [normalized]);
    return;
  }

  if (existing.length >= MAX_PROVIDER_PROBE_SAMPLES_PER_KIND) {
    state.dropped += 1;
    return;
  }

  existing.push(normalized);
}

export function perfRenameApplySuppressed(token?: CancellationToken): boolean {
  return (
    interactiveRenameApplySuppressionOwners.size > 0 ||
    (token ? (providerRenameApplySuppressionOwners.get(token)?.size ?? 0) > 0 : false)
  );
}

let activeMeasuredProviders: PerfMeasuredLanguageProviders | null = null;

function safeLocalStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function registerPerfMeasuredProviders(
  providers: PerfMeasuredLanguageProviders,
  environment: PerfScenarioBridgeEnvironment = import.meta.env,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): (() => void) | null {
  if (!perfScenarioBridgeEnabled(environment, storage)) {
    return null;
  }

  const registered = providers;
  activeMeasuredProviders = registered;

  return () => {
    if (activeMeasuredProviders === registered) {
      activeMeasuredProviders = null;
    }
  };
}

function measureTimerQuantizationMs(now: () => number): number | null {
  const first = now();
  let previous = first;
  let minimum = Number.POSITIVE_INFINITY;
  let positiveDeltas = 0;

  for (let reads = 0; reads < TIMER_QUANTIZATION_MAX_READS; reads += 1) {
    const current = now();
    const delta = current - previous;
    previous = current;

    if (delta > 0) {
      positiveDeltas += 1;

      if (delta < minimum) {
        minimum = delta;
      }
    }

    if (positiveDeltas >= TIMER_QUANTIZATION_MIN_POSITIVE_DELTAS) {
      break;
    }

    if (current - first >= TIMER_QUANTIZATION_BUDGET_MS && positiveDeltas > 0) {
      break;
    }
  }

  if (minimum === Number.POSITIVE_INFINITY) {
    return null;
  }

  return minimum;
}

function activeModelOf(editor: MonacoEditor.ICodeEditor | null): MonacoEditor.ITextModel | null {
  return editor?.getModel?.() ?? null;
}

function defaultActiveDocumentPath(
  getActiveEditor: () => MonacoEditor.ICodeEditor | null,
): string | null {
  const model = activeModelOf(getActiveEditor());

  if (!model) {
    return null;
  }

  try {
    return modelPath(model);
  } catch {
    return null;
  }
}

function exactNormalizedDocumentPath(left: string, right: string): string | null {
  const leftIdentity = createConservativeWorkspaceRootFromPath(left);
  if (!leftIdentity.ok) return null;
  const rightIdentity = parseWorkspacePath(leftIdentity.value, right);
  if (!rightIdentity.ok || rightIdentity.value.relativePath !== "") return null;
  return leftIdentity.value.nativePath;
}

export function createPerfScenarioBridge(
  dependencies: PerfScenarioBridgeDependencies,
): PerfScenarioBridge {
  const scheduleFrame = dependencies.scheduleFrame ?? defaultScheduleFrame;
  const now = dependencies.now ?? defaultNow;
  const getVisibleRenameInput = dependencies.getVisibleRenameInput ?? defaultGetVisibleRenameInput;
  const countQuickOpenResults = dependencies.countQuickOpenResults ?? defaultCountQuickOpenResults;
  const getActiveDocumentPath =
    dependencies.getActiveDocumentPath ??
    (() => defaultActiveDocumentPath(dependencies.getActiveEditor));
  const bundleEnvironment = dependencies.bundleEnvironment ?? import.meta.env;
  const probeState = createProviderProbeState();
  activeProviderProbe = probeState;
  const timerQuantizationMs = measureTimerQuantizationMs(now);
  let providerAuthorityGeneration = 0;
  let observedEditor: MonacoEditor.ICodeEditor | null = null;
  let observedModel: MonacoEditor.ITextModel | null = null;
  let authorityObservationSubscriptions: { dispose(): void }[] = [];
  const disposeAuthorityObservationSubscriptions = () => {
    for (const subscription of authorityObservationSubscriptions) subscription.dispose();
    authorityObservationSubscriptions = [];
  };
  const syncAuthorityObservation = () => {
    const editor = dependencies.getActiveEditor();
    const model = activeModelOf(editor);
    if (editor === observedEditor && model === observedModel) return;
    disposeAuthorityObservationSubscriptions();
    observedEditor = editor;
    observedModel = model;
    providerAuthorityGeneration += 1;
    const invalidate = () => {
      providerAuthorityGeneration += 1;
    };
    const resync = () => {
      invalidate();
      syncAuthorityObservation();
    };
    authorityObservationSubscriptions = [
      model?.onDidChangeContent?.(invalidate),
      model?.onWillDispose?.(invalidate),
      editor?.onDidChangeModel?.(resync),
    ].filter((subscription): subscription is { dispose(): void } => Boolean(subscription));
  };
  const captureProviderAuthority = () => {
    syncAuthorityObservation();
    const editor = dependencies.getActiveEditor();
    const model = activeModelOf(editor);
    const activePath = getActiveDocumentPath();
    if (!model || !activePath) return null;
    let activeModelPath: string | null;
    try {
      activeModelPath = modelPath(model);
    } catch {
      return null;
    }
    if (!activeModelPath) return null;
    const path = exactNormalizedDocumentPath(activeModelPath, activePath);
    if (!path) return null;
    let modelVersion: number;
    try {
      modelVersion = model.getVersionId();
    } catch {
      return null;
    }
    const documentGeneration =
      dependencies.getActiveDocumentGeneration?.() ?? providerAuthorityGeneration;
    return Number.isSafeInteger(modelVersion) &&
      modelVersion >= 0 &&
      Number.isSafeInteger(documentGeneration) &&
      documentGeneration >= 0
      ? {
          editor,
          model,
          modelVersion,
          path,
          generation: providerAuthorityGeneration,
          documentGeneration,
        }
      : null;
  };
  const providerAuthorityIsCurrent = (
    authority: NonNullable<ReturnType<typeof captureProviderAuthority>>,
  ) => {
    syncAuthorityObservation();
    const currentModel = activeModelOf(dependencies.getActiveEditor());
    const currentActivePath = getActiveDocumentPath();
    let currentModelPath: string | null = null;
    try {
      currentModelPath = currentModel ? modelPath(currentModel) : null;
    } catch {
      return false;
    }
    const currentPath =
      currentModelPath && currentActivePath
        ? exactNormalizedDocumentPath(currentModelPath, currentActivePath)
        : null;
    if (
      authority.generation !== providerAuthorityGeneration ||
      authority.documentGeneration !==
        (dependencies.getActiveDocumentGeneration?.() ?? providerAuthorityGeneration) ||
      currentModel !== authority.model ||
      currentPath !== authority.path
    ) {
      return false;
    }
    try {
      return authority.model.getVersionId() === authority.modelVersion;
    } catch {
      return false;
    }
  };
  const documentAuthorityLeases = new WeakMap<
    PerfDocumentAuthorityLease,
    NonNullable<ReturnType<typeof captureProviderAuthority>>
  >();
  const providerAuthorityForLease = (lease?: PerfDocumentAuthorityLease) => {
    if (!lease) return captureProviderAuthority();
    const authority = documentAuthorityLeases.get(lease) ?? null;
    return authority && providerAuthorityIsCurrent(authority) ? authority : null;
  };
  type ProviderProbeBatchState = {
    active: boolean;
    readonly authority: PerfDocumentAuthorityLease;
    readonly operations: Set<PerfProviderOperation>;
  };
  const providerProbeBatches = new WeakMap<PerfProviderProbeBatchLease, ProviderProbeBatchState>();
  const activeProviderProbeBatches = new Set<ProviderProbeBatchState>();
  const activeProviderOperations = new Set<PerfProviderOperation>();
  const cancelProviderProbeBatch = (batch: PerfProviderProbeBatchLease) => {
    const state = providerProbeBatches.get(batch);
    if (!state || !state.active) return;
    state.active = false;
    activeProviderProbeBatches.delete(state);
    for (const operation of state.operations) {
      operation.cancel();
      operation.finish();
    }
    state.operations.clear();
  };
  const beginProviderInvocation = (
    lease?: PerfDocumentAuthorityLease,
    batch?: PerfProviderProbeBatchLease,
  ) => {
    const authority = providerAuthorityForLease(lease);
    if (!authority) return null;
    const batchState = batch ? providerProbeBatches.get(batch) : null;
    if (batch && (!batchState || !batchState.active || !lease || batchState.authority !== lease)) {
      return null;
    }
    const source = createPerfCancellationTokenSource();
    const tokenState = { active: true };
    measuredProviderTokenState.set(source.token, tokenState);
    const cancel = () => {
      tokenState.active = false;
      source.cancel();
    };
    const subscriptions = [
      authority.model.onDidChangeContent?.(cancel),
      authority.model.onWillDispose?.(cancel),
      authority.editor?.onDidChangeModel?.(cancel),
      dependencies.onDidChangeActiveDocument?.(cancel),
    ].filter((subscription): subscription is { dispose(): void } => Boolean(subscription));
    let finished = false;
    const operation: PerfProviderOperation = {
      source,
      cancel,
      finish: () => {
        if (finished) return;
        finished = true;
        tokenState.active = false;
        activeProviderOperations.delete(operation);
        batchState?.operations.delete(operation);
        for (const subscription of subscriptions) subscription.dispose();
      },
    };
    activeProviderOperations.add(operation);
    batchState?.operations.add(operation);
    return {
      authority,
      source,
      finish: operation.finish,
    };
  };

  const bridge: PerfScenarioBridge = {
    getLanguageServerRuntimeStatus: () =>
      readLanguageServerRuntimeStatus(dependencies.getLanguageServerRuntimeStatus),
    getLatencySnapshot: () => dependencies.getLatencySnapshot(),
    clearLatencyMetrics: () => {
      dependencies.clearLatencyMetrics();
    },
    async runTypingScenario(text: string): Promise<PerfTypingScenarioResult | null> {
      const editor = dependencies.getActiveEditor();
      const model = activeModelOf(editor);

      if (!editor || !model) {
        return null;
      }

      const original = model.getValue();
      const capped = Array.from(text).slice(0, MAX_TYPED_CHARACTERS);
      const dispatchMs: number[] = [];
      const frameMs: number[] = [];
      const typedCharacters: string[] = [];
      let missedDispatches = 0;
      const lastLine = model.getLineCount();
      editor.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
      editor.focus();

      for (const character of capped) {
        let dispatchAt: number | null = null;
        const subscription = model.onDidChangeContent(() => {
          if (dispatchAt === null) {
            dispatchAt = now();
          }
        });
        const start = now();
        editor.trigger("perf", "type", { text: character });
        subscription.dispose();

        if (dispatchAt === null) {
          missedDispatches += 1;
        }

        if (dispatchAt !== null) {
          dispatchMs.push(dispatchAt - start);
        }

        await nextFrame(scheduleFrame);
        await nextFrame(scheduleFrame);
        frameMs.push(now() - start);
        typedCharacters.push(character);
      }

      model.setValue(original);

      return {
        dispatchMs,
        frameMs,
        typedCharacters,
        missedDispatches,
        restored: model.getValue() === original,
      };
    },
    async measureTabSwitches(paths: readonly string[]): Promise<PerfTabSwitchMeasurement> {
      const durationsMs: number[] = [];
      const assertionFailures: string[] = [];
      const capped = paths.slice(0, MAX_TAB_SWITCHES);

      for (const path of capped) {
        const start = now();
        dependencies.activateDocument(path);
        await nextFrame(scheduleFrame);
        await nextFrame(scheduleFrame);
        const duration = now() - start;
        const activePath = getActiveDocumentPath();

        if (activePath !== path) {
          assertionFailures.push(
            `expected the active Monaco model to be ${path} after the painted frame, saw ${activePath ?? "no active model"}`,
          );
          continue;
        }

        durationsMs.push(duration);
      }

      return { durationsMs, assertionFailures };
    },
    async runQuickOpenQuery(query: string): Promise<boolean> {
      dependencies.setQuickOpenOpen(true);
      dependencies.setQuickOpenQuery(query);

      let sawLoading = false;

      for (let tick = 0; tick < MAX_QUICK_OPEN_FRAMES; tick += 1) {
        await nextFrame(scheduleFrame);

        if (dependencies.isQuickOpenLoading()) {
          sawLoading = true;
          continue;
        }

        if (!sawLoading) {
          continue;
        }

        dependencies.setQuickOpenOpen(false);

        return true;
      }

      dependencies.setQuickOpenOpen(false);

      return false;
    },
    async runQuickOpenUiQuery(query: string): Promise<PerfQuickOpenUiSample | null> {
      const engineSamplesFor = (target: string) =>
        (probeState.samples.get("fileSearchEngine") ?? []).filter(
          (sample) => sample.target === target,
        ).length;
      dependencies.setQuickOpenOpen(true);
      await nextFrame(scheduleFrame);
      const engineSamplesBefore = engineSamplesFor(query);
      const start = now();
      dependencies.setQuickOpenQuery(query);

      for (let tick = 0; tick < MAX_QUICK_OPEN_FRAMES; tick += 1) {
        await nextFrame(scheduleFrame);

        if (engineSamplesFor(query) <= engineSamplesBefore) {
          continue;
        }

        if (dependencies.isQuickOpenLoading()) {
          continue;
        }

        await nextFrame(scheduleFrame);
        const ms = now() - start;
        const resultCount = countQuickOpenResults();
        dependencies.setQuickOpenOpen(false);

        return { ms, resultCount };
      }

      dependencies.setQuickOpenOpen(false);

      return null;
    },
    async runEditorAction(actionId: string): Promise<boolean> {
      const editor = dependencies.getActiveEditor();
      const action = editor?.getAction(actionId);

      if (!editor || !action) {
        return false;
      }

      const running = action.run();
      if (actionId === RENAME_ACTION_ID) {
        let failure: unknown = null;
        let settled = false;
        void running.then(
          () => {
            settled = true;
          },
          (error) => {
            failure = error;
            settled = true;
          },
        );

        for (let frame = 0; frame < MAX_RENAME_ACTION_FRAMES && !settled; frame += 1) {
          await nextFrame(scheduleFrame);
          editor.trigger("perf", CANCEL_RENAME_INPUT_COMMAND_ID, {});
        }

        if (!settled) return false;
        if (failure) throw failure;
        return true;
      }

      await running;

      return true;
    },
    async runRenameWithNewName(newName: string): Promise<boolean> {
      const editor = dependencies.getActiveEditor();
      const action = editor?.getAction(RENAME_ACTION_ID);

      if (!editor || !action) {
        return false;
      }

      const requestedName = newName.trim();

      if (requestedName.length === 0) {
        return false;
      }

      const releaseRenameApplySuppression = acquireRenameApplySuppression();

      try {
        let failure: unknown = null;
        let settled = false;
        void action.run().then(
          () => {
            settled = true;
          },
          (error) => {
            failure = error;
            settled = true;
          },
        );

        let accepted = false;

        for (let frame = 0; frame < MAX_RENAME_ACTION_FRAMES && !accepted && !settled; frame += 1) {
          await nextFrame(scheduleFrame);
          const input = getVisibleRenameInput(editor);

          if (!input) {
            continue;
          }

          if (input.value === requestedName) {
            break;
          }

          input.value = requestedName;
          editor.trigger("perf", ACCEPT_RENAME_INPUT_COMMAND_ID, {});
          accepted = true;
        }

        if (!accepted) {
          editor.trigger("perf", CANCEL_RENAME_INPUT_COMMAND_ID, {});

          return false;
        }

        for (let frame = 0; frame < MAX_RENAME_ACTION_FRAMES && !settled; frame += 1) {
          await nextFrame(scheduleFrame);
        }

        if (!settled) {
          editor.trigger("perf", CANCEL_RENAME_INPUT_COMMAND_ID, {});

          return false;
        }

        if (failure) {
          throw failure;
        }

        return true;
      } finally {
        releaseRenameApplySuppression();
      }
    },
    captureActiveDocumentAuthority(expectedPath: string): PerfDocumentAuthorityLease | null {
      const authority = captureProviderAuthority();
      if (!authority || exactNormalizedDocumentPath(authority.path, expectedPath) === null)
        return null;
      const lease = Object.freeze({
        __codevoPerfDocumentAuthorityLease: "opaque" as const,
      });
      documentAuthorityLeases.set(lease, authority);
      return lease;
    },
    beginProviderProbeBatch(
      authority: PerfDocumentAuthorityLease,
    ): PerfProviderProbeBatchLease | null {
      if (!providerAuthorityForLease(authority)) return null;
      const batch = Object.freeze({
        __codevoPerfProviderProbeBatchLease: "opaque" as const,
      });
      const state = { active: true, authority, operations: new Set<PerfProviderOperation>() };
      providerProbeBatches.set(batch, state);
      activeProviderProbeBatches.add(state);
      return batch;
    },
    cancelProviderProbeBatch,
    async runCompletionProbe(
      position: PerfTextPosition,
      lease?: PerfDocumentAuthorityLease,
      batch?: PerfProviderProbeBatchLease,
    ): Promise<boolean> {
      const provider = activeMeasuredProviders?.completion;
      if (!provider?.provideCompletionItems) {
        return false;
      }
      const invocation = beginProviderInvocation(lease, batch);
      if (!invocation) return false;
      try {
        const list = await provider.provideCompletionItems(
          invocation.authority.model,
          position as unknown as Position,
          { triggerKind: 0 as MonacoLanguages.CompletionTriggerKind },
          invocation.source.token,
        );
        return (
          !invocation.source.token.isCancellationRequested &&
          providerAuthorityIsCurrent(invocation.authority) &&
          Array.isArray(list?.suggestions) &&
          list.suggestions.length > 0
        );
      } finally {
        invocation.finish();
      }
    },
    async runDefinitionProbe(
      position: PerfTextPosition,
      lease?: PerfDocumentAuthorityLease,
      batch?: PerfProviderProbeBatchLease,
    ): Promise<boolean> {
      const provider = activeMeasuredProviders?.definition;
      if (!provider?.provideDefinition) {
        return false;
      }
      const invocation = beginProviderInvocation(lease, batch);
      if (!invocation) return false;
      try {
        const result = await provider.provideDefinition(
          invocation.authority.model,
          position as unknown as Position,
          invocation.source.token,
        );
        return (
          !invocation.source.token.isCancellationRequested &&
          providerAuthorityIsCurrent(invocation.authority) &&
          (Array.isArray(result) ? result.length > 0 : result != null)
        );
      } finally {
        invocation.finish();
      }
    },
    async runReferencesProbe(
      position: PerfTextPosition,
      lease?: PerfDocumentAuthorityLease,
      batch?: PerfProviderProbeBatchLease,
    ): Promise<boolean> {
      const provider = activeMeasuredProviders?.references;
      if (!provider?.provideReferences) {
        return false;
      }
      const invocation = beginProviderInvocation(lease, batch);
      if (!invocation) return false;
      try {
        const locations = await provider.provideReferences(
          invocation.authority.model,
          position as unknown as Position,
          { includeDeclaration: true },
          invocation.source.token,
        );
        return (
          !invocation.source.token.isCancellationRequested &&
          providerAuthorityIsCurrent(invocation.authority) &&
          Array.isArray(locations)
        );
      } finally {
        invocation.finish();
      }
    },
    async runRenameProbe(
      position: PerfTextPosition,
      newName: string,
      lease?: PerfDocumentAuthorityLease,
      batch?: PerfProviderProbeBatchLease,
    ): Promise<boolean> {
      const provider = activeMeasuredProviders?.rename;
      if (!provider?.provideRenameEdits) {
        return false;
      }
      const invocation = beginProviderInvocation(lease, batch);
      if (!invocation) return false;

      const releaseRenameApplySuppression = acquireRenameApplySuppression(invocation.source.token);
      const cancellationSubscription = invocation.source.token.onCancellationRequested(
        releaseRenameApplySuppression,
      );

      try {
        const edit = await provider.provideRenameEdits(
          invocation.authority.model,
          position as unknown as Position,
          newName,
          invocation.source.token,
        );

        if (
          !edit ||
          invocation.source.token.isCancellationRequested ||
          !providerAuthorityIsCurrent(invocation.authority)
        ) {
          return false;
        }

        return typeof (edit as MonacoLanguages.Rejection).rejectReason !== "string";
      } finally {
        cancellationSubscription.dispose();
        releaseRenameApplySuppression();
        invocation.finish();
      }
    },
    getProviderProbeSamples: (kind) => [...(probeState.samples.get(kind) ?? [])],
    clearProviderProbeSamples: () => {
      probeState.samples.clear();
      probeState.dropped = 0;
    },
    restoreActiveEditorContent: (expectedText) => {
      const model = activeModelOf(dependencies.getActiveEditor());

      if (!model) {
        return false;
      }

      if (model.getValue() !== expectedText) {
        model.setValue(expectedText);
      }

      return model.getValue() === expectedText;
    },
    getEnvironmentSample: () => ({
      bundleMode: bundleEnvironment.DEV === true ? "dev" : "production",
      windowMode:
        bundleEnvironment.VITE_CODEVO_PERF_WINDOW_MODE === "focus-only" ||
        bundleEnvironment.VITE_CODEVO_PERF_WINDOW_MODE === "always-on-top-diagnostic"
          ? bundleEnvironment.VITE_CODEVO_PERF_WINDOW_MODE
          : "unknown",
      strictMode: strictModeEnabled(),
      ...(timerQuantizationMs !== null ? { timerQuantizationMs } : {}),
      windowSize: { width: window.innerWidth, height: window.innerHeight },
      platform: typeof navigator.platform === "string" ? navigator.platform : "unknown",
    }),
    getJavaScriptTypeScriptDocumentCapability: (lease) => {
      const authority = lease ? providerAuthorityForLease(lease) : captureProviderAuthority();
      if (lease && !authority) return null;
      const observation = readJavaScriptTypeScriptDocumentCapability(
        dependencies.getActiveEditor(),
      );
      return authority && !providerAuthorityIsCurrent(authority) ? null : observation;
    },
    getLargeSmartDocumentStatus: () => readLargeSmartDocumentStatus(dependencies.getActiveEditor()),
    getRetainedCounts: () => dependencies.getRetainedCounts(),
    getMemorySample: () => ({ usedJsHeapBytes: readUsedJsHeapBytes() }),
  };

  probeState.cleanup = () => {
    providerAuthorityGeneration += 1;
    disposeAuthorityObservationSubscriptions();
    for (const state of activeProviderProbeBatches) {
      state.active = false;
    }
    activeProviderProbeBatches.clear();
    for (const operation of activeProviderOperations) {
      operation.cancel();
      operation.finish();
    }
    activeProviderOperations.clear();
  };

  return bridge;
}

export function installPerfScenarioBridge(
  dependencies: PerfScenarioBridgeDependencies,
): () => void {
  const bridge = createPerfScenarioBridge(dependencies);
  const ownedProbe = activeProviderProbe;
  window.__codevoPerf = bridge;
  window.__codevoPerfProbe = {
    record: recordPerfProviderSample,
    renameApplySuppressed: perfRenameApplySuppressed,
  };

  return () => {
    ownedProbe?.cleanup?.();
    if (activeProviderProbe === ownedProbe) {
      activeProviderProbe = null;
    }

    if (window.__codevoPerf !== bridge) {
      return;
    }

    delete window.__codevoPerf;
    delete window.__codevoPerfProbe;
  };
}
