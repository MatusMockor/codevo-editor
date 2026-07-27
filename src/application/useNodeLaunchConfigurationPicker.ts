import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NodeLaunchConfiguration,
  NodeLaunchConfigurationTarget,
} from "../domain/nodeLaunchConfiguration";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  loadNodeLaunchConfigurations,
  type NodeLaunchCompoundEntry,
  type NodeLaunchConfigurationDiagnostic,
  type NodeLaunchConfigurationEntry,
  type NodeLaunchConfigurationReads,
} from "./nodeLaunchConfigurationLoader";

export const MAX_NODE_LAUNCH_CONFIGURATION_PICKER_MESSAGE_BYTES = 4 * 1_024;

export type NodeLaunchConfigurationUnsupportedReason =
  | "attachRequiresDebugger"
  | "compoundRequiresDebugger"
  | "inspectorRequiresDebugger"
  | "dirtyDocument"
  | "unsupportedTarget"
  | "invalidOptions";

export interface NodeLaunchConfigurationPickerChoice {
  readonly compoundMemberCount?: number;
  readonly default: boolean;
  readonly hasPreLaunchTask?: boolean;
  readonly name: string;
  readonly preLaunchTask?: string;
  readonly runnable: boolean;
  readonly source?: NodeLaunchConfigurationEntry["source"];
  readonly targetKind: NodeLaunchConfigurationTarget["kind"] | "compound";
  readonly reason?: NodeLaunchConfigurationUnsupportedReason;
}

export interface NodeLaunchConfigurationPickerDiagnosticNotice {
  readonly count: number;
  readonly message: string;
}

export type NodeLaunchConfigurationPickerState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly diagnosticNotice?: NodeLaunchConfigurationPickerDiagnosticNotice;
    }
  | {
      readonly kind: "empty";
      readonly diagnosticNotice?: NodeLaunchConfigurationPickerDiagnosticNotice;
    }
  | { readonly kind: "error"; readonly message: string };

export type PreparedNodeLaunchConfiguration<TPrivate> =
  | {
      readonly kind: "supported";
      readonly value: TPrivate;
      readonly runnable?: boolean;
      readonly reason?: NodeLaunchConfigurationUnsupportedReason;
    }
  | { readonly kind: "unsupported"; readonly reason: NodeLaunchConfigurationUnsupportedReason };

export interface NodeLaunchConfigurationPickerStrategy<TPrivate> {
  readonly startErrorMessage: string;
  prepare(
    configuration: NodeLaunchConfiguration,
    rootPath: string,
    entry: NodeLaunchConfigurationEntry,
  ): PreparedNodeLaunchConfiguration<TPrivate>;
  prepareCompound?(
    entry: NodeLaunchCompoundEntry,
    rootPath: string,
  ): PreparedNodeLaunchConfiguration<TPrivate>;
  start(value: TPrivate): boolean | Promise<boolean>;
}

export interface NodeLaunchPickerClaim {
  release(): void;
}

export interface NodeLaunchPickerCoordinator {
  claim(onRevoked: () => void): NodeLaunchPickerClaim;
}

export function createNodeLaunchPickerCoordinator(): NodeLaunchPickerCoordinator {
  let current: { readonly token: symbol; readonly revoke: () => void } | null = null;
  return {
    claim(revoke) {
      const token = Symbol("node-launch-picker");
      const previous = current;
      current = { token, revoke };
      previous?.revoke();
      return {
        release() {
          if (current?.token === token) current = null;
        },
      };
    },
  };
}

export interface UseNodeLaunchConfigurationPickerOptions<TPrivate> {
  readonly blocked: boolean;
  readonly configurationVersion?: number;
  readonly coordinator?: NodeLaunchPickerCoordinator;
  readonly isBlocked: () => boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly revealBeforeStart?: () => void;
  readonly revealPicker: () => void;
  readonly rootPath: string | null;
  readonly strategy: NodeLaunchConfigurationPickerStrategy<TPrivate>;
  readonly workspaceId: string | null;
  readonly workspaceReads: NodeLaunchConfigurationReads;
  readonly workspaceTrusted: boolean;
}

export interface NodeLaunchConfigurationPicker {
  readonly busy: boolean;
  readonly choices: readonly NodeLaunchConfigurationPickerChoice[];
  readonly error: string | null;
  readonly pickerOpen: boolean;
  readonly selectedName: string | null;
  readonly state: NodeLaunchConfigurationPickerState;
  canOpenPicker(): boolean;
  closePicker(): void;
  load(): Promise<void>;
  openPicker(): void;
  refresh(): Promise<void>;
  select(name: string): void;
  startNamed(name: string): Promise<boolean>;
  startSelected(): Promise<boolean>;
}

interface CapturedOwner {
  readonly rootPath: string;
  readonly workspaceId: string;
}

interface PreparedEntry<TPrivate> {
  readonly prepared: PreparedNodeLaunchConfiguration<TPrivate>;
}

interface LoadedConfigurations<TPrivate> {
  readonly configurationVersion: number;
  readonly entries: ReadonlyMap<string, PreparedEntry<TPrivate>>;
  readonly generation: number;
  readonly owner: CapturedOwner;
  readonly reads: NodeLaunchConfigurationReads;
  readonly strategy: NodeLaunchConfigurationPickerStrategy<TPrivate>;
}

type LoadingConfigurations<TPrivate> = Omit<LoadedConfigurations<TPrivate>, "entries">;

const EMPTY_CHOICES: readonly NodeLaunchConfigurationPickerChoice[] = Object.freeze([]);

/** Shared owner-safe picker lifecycle. Prepared private targets never leave its refs. */
export function useNodeLaunchConfigurationPicker<TPrivate>(
  options: UseNodeLaunchConfigurationPickerOptions<TPrivate>,
): NodeLaunchConfigurationPicker {
  const [state, setState] = useState<NodeLaunchConfigurationPickerState>({ kind: "idle" });
  const [choices, setChoices] = useState(EMPTY_CHOICES);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const privateCoordinatorRef = useRef<NodeLaunchPickerCoordinator | null>(null);
  if (!privateCoordinatorRef.current)
    privateCoordinatorRef.current = createNodeLaunchPickerCoordinator();
  const claimRef = useRef<NodeLaunchPickerClaim | null>(null);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);
  const loadedRef = useRef<LoadedConfigurations<TPrivate> | null>(null);
  const loadingRef = useRef<LoadingConfigurations<TPrivate> | null>(null);
  const selectedNameRef = useRef<string | null>(null);
  const launchInFlightRef = useRef(false);

  const releaseClaim = useCallback(() => {
    claimRef.current?.release();
    claimRef.current = null;
  }, []);

  const closePicker = useCallback(() => {
    releaseClaim();
    if (mountedRef.current) setPickerOpen(false);
  }, [releaseClaim]);

  const invalidate = useCallback(() => {
    requestGenerationRef.current += 1;
    loadedRef.current = null;
    loadingRef.current = null;
    selectedNameRef.current = null;
    releaseClaim();
    setChoices(EMPTY_CHOICES);
    setPickerOpen(false);
    setSelectedName(null);
    setState({ kind: "idle" });
  }, [releaseClaim]);

  useEffect(() => {
    invalidate();
  }, [
    options.coordinator,
    options.configurationVersion,
    options.rootPath,
    options.strategy,
    options.workspaceId,
    options.workspaceReads,
    options.workspaceTrusted,
    invalidate,
  ]);

  useEffect(() => {
    if (launchInFlightRef.current && options.blocked) {
      closePicker();
      return;
    }
    invalidate();
  }, [closePicker, invalidate, options.blocked]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      loadedRef.current = null;
      loadingRef.current = null;
      selectedNameRef.current = null;
      releaseClaim();
    };
  }, [releaseClaim]);

  const load = useCallback(async (): Promise<void> => {
    const current = optionsRef.current;
    const owner = captureOwner(current);
    const reads = current.workspaceReads;
    const strategy = current.strategy;
    const configurationVersion = current.configurationVersion ?? 0;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    loadedRef.current = null;
    loadingRef.current = null;
    selectedNameRef.current = null;
    if (!owner || !canReadOrLaunch(current, owner)) {
      closePicker();
      if (mountedRef.current && requestGenerationRef.current === generation) {
        setChoices(EMPTY_CHOICES);
        setSelectedName(null);
        setState({ kind: "idle" });
      }
      return;
    }

    setChoices(EMPTY_CHOICES);
    setSelectedName(null);
    setState({ kind: "loading" });
    const loading = { configurationVersion, generation, owner, reads, strategy };
    loadingRef.current = loading;
    const remainsCurrent = () =>
      mountedRef.current &&
      requestGenerationRef.current === generation &&
      optionsRef.current.workspaceReads === reads &&
      optionsRef.current.strategy === strategy &&
      (optionsRef.current.configurationVersion ?? 0) === configurationVersion &&
      canReadOrLaunch(optionsRef.current, owner);
    const result = await loadNodeLaunchConfigurations(owner.rootPath, reads, remainsCurrent);
    if (loadingRef.current === loading) loadingRef.current = null;
    if (!remainsCurrent() || result.kind === "stale") {
      closePicker();
      if (mountedRef.current && requestGenerationRef.current === generation) {
        setChoices(EMPTY_CHOICES);
        setSelectedName(null);
        setState({ kind: "idle" });
      }
      return;
    }
    if (result.kind === "none") {
      setChoices(EMPTY_CHOICES);
      setSelectedName(null);
      setState({ kind: "empty" });
      return;
    }
    if (result.kind === "invalid") {
      setChoices(EMPTY_CHOICES);
      setSelectedName(null);
      setState({ kind: "error", message: boundedNodeLaunchConfigurationMessage(result.message) });
      return;
    }
    const diagnosticNotice = vscodeDiagnosticNotice(result.diagnostics);
    if (result.configurations.length === 0 && (result.pickerCompounds?.length ?? 0) === 0) {
      setChoices(EMPTY_CHOICES);
      setSelectedName(null);
      setState({ kind: "empty", ...(diagnosticNotice ? { diagnosticNotice } : {}) });
      return;
    }

    const entries = new Map<string, PreparedEntry<TPrivate>>();
    const configurationChoices = result.entries.map((sourceEntry) => {
      const configuration = sourceEntry.configuration;
      let prepared: PreparedNodeLaunchConfiguration<TPrivate>;
      try {
        prepared = strategy.prepare(configuration, owner.rootPath, sourceEntry);
      } catch {
        prepared = { kind: "unsupported", reason: "invalidOptions" };
      }
      entries.set(configuration.name, { prepared });
      const runnable = prepared.kind === "supported" && prepared.runnable !== false;
      return Object.freeze({
        default: configuration.default,
        name: configuration.name,
        ...(sourceEntry.source === "vscode"
          ? {
              ...(sourceEntry.preLaunchTask ? { preLaunchTask: sourceEntry.preLaunchTask } : {}),
              source: sourceEntry.source,
            }
          : {}),
        runnable,
        targetKind: configuration.target.kind,
        ...(!runnable && prepared.reason ? { reason: prepared.reason } : {}),
      });
    });
    const compoundChoices = (result.pickerCompounds ?? []).map((compoundEntry) => {
      let prepared: PreparedNodeLaunchConfiguration<TPrivate>;
      try {
        prepared = strategy.prepareCompound?.(compoundEntry, owner.rootPath) ?? {
          kind: "unsupported",
          reason: "compoundRequiresDebugger",
        };
      } catch {
        prepared = { kind: "unsupported", reason: "invalidOptions" };
      }
      entries.set(compoundEntry.compound.name, { prepared });
      const runnable = prepared.kind === "supported" && prepared.runnable !== false;
      return Object.freeze({
        compoundMemberCount: compoundEntry.compound.members.length,
        default: false,
        hasPreLaunchTask: compoundEntry.compound.preLaunchTask !== undefined,
        name: compoundEntry.compound.name,
        runnable,
        source: "vscode" as const,
        targetKind: "compound" as const,
        ...(!runnable && prepared.reason ? { reason: prepared.reason } : {}),
      });
    });
    const nextChoices = Object.freeze([...configurationChoices, ...compoundChoices]);
    if (!remainsCurrent()) return;
    const firstRunnable = nextChoices.find(({ runnable }) => runnable);
    const nextSelected =
      nextChoices.find(({ default: isDefault, runnable }) => isDefault && runnable)?.name ??
      firstRunnable?.name ??
      null;
    loadedRef.current = { configurationVersion, entries, generation, owner, reads, strategy };
    selectedNameRef.current = nextSelected;
    setChoices(nextChoices);
    setSelectedName(nextSelected);
    setState({ kind: "ready", ...(diagnosticNotice ? { diagnosticNotice } : {}) });
  }, [closePicker]);

  const select = useCallback((name: string): void => {
    const loaded = loadedRef.current;
    const entry = loaded?.entries.get(name);
    if (
      !loaded ||
      !entry ||
      entry.prepared.kind !== "supported" ||
      entry.prepared.runnable === false ||
      loaded.generation !== requestGenerationRef.current ||
      !canUseLoaded(optionsRef.current, loaded)
    )
      return;
    selectedNameRef.current = name;
    setSelectedName(name);
  }, []);

  const startExactName = useCallback(
    async (name: string, selectedNameMustRemain: string | null): Promise<boolean> => {
      if (launchInFlightRef.current) return false;
      const loaded = loadedRef.current;
      const entry = loaded?.entries.get(name);
      if (
        !loaded ||
        !entry ||
        entry.prepared.kind !== "supported" ||
        entry.prepared.runnable === false ||
        loaded.generation !== requestGenerationRef.current ||
        (selectedNameMustRemain !== null && selectedNameRef.current !== selectedNameMustRemain) ||
        !canUseLoaded(optionsRef.current, loaded)
      ) {
        if (loaded && !canUseLoaded(optionsRef.current, loaded)) closePicker();
        return false;
      }
      launchInFlightRef.current = true;
      setBusy(true);
      try {
        if (
          loadedRef.current !== loaded ||
          (selectedNameMustRemain !== null && selectedNameRef.current !== selectedNameMustRemain) ||
          !canUseLoaded(optionsRef.current, loaded)
        ) {
          if (!canUseLoaded(optionsRef.current, loaded)) closePicker();
          return false;
        }
        optionsRef.current.revealBeforeStart?.();
        if (
          loadedRef.current !== loaded ||
          (selectedNameMustRemain !== null && selectedNameRef.current !== selectedNameMustRemain) ||
          !canUseLoaded(optionsRef.current, loaded)
        ) {
          if (!canUseLoaded(optionsRef.current, loaded)) closePicker();
          return false;
        }
        const accepted = await loaded.strategy.start(entry.prepared.value);
        if (
          accepted !== true ||
          loadedRef.current !== loaded ||
          (selectedNameMustRemain !== null && selectedNameRef.current !== selectedNameMustRemain) ||
          !canFinishAcceptedStart(optionsRef.current, loaded)
        ) {
          if (!canFinishAcceptedStart(optionsRef.current, loaded)) closePicker();
          return false;
        }
        closePicker();
        return true;
      } catch {
        if (mountedRef.current && loadedRef.current === loaded) {
          setState({ kind: "error", message: loaded.strategy.startErrorMessage });
        }
        return false;
      } finally {
        launchInFlightRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [closePicker],
  );

  const startNamed = useCallback(
    (name: string): Promise<boolean> => startExactName(name, null),
    [startExactName],
  );
  const startSelected = useCallback((): Promise<boolean> => {
    const name = selectedNameRef.current;
    return name ? startExactName(name, name) : Promise.resolve(false);
  }, [startExactName]);
  const canOpenPicker = useCallback((): boolean => {
    if (launchInFlightRef.current) return false;
    const current = optionsRef.current;
    const owner = captureOwner(current);
    return owner !== null && canReadOrLaunch(current, owner);
  }, []);
  const openPicker = useCallback((): void => {
    if (!canOpenPicker()) {
      closePicker();
      return;
    }
    const coordinator = optionsRef.current.coordinator ?? privateCoordinatorRef.current!;
    releaseClaim();
    claimRef.current = coordinator.claim(() => {
      claimRef.current = null;
      if (mountedRef.current) setPickerOpen(false);
    });
    setPickerOpen(true);
    try {
      optionsRef.current.revealPicker();
    } catch {
      closePicker();
      return;
    }
    if (!canOpenPicker()) {
      closePicker();
      return;
    }
    const loaded = loadedRef.current;
    const loading = loadingRef.current;
    if (
      (!loaded ||
        loaded.generation !== requestGenerationRef.current ||
        !canUseLoaded(optionsRef.current, loaded)) &&
      (!loading ||
        loading.generation !== requestGenerationRef.current ||
        loading.reads !== optionsRef.current.workspaceReads ||
        loading.strategy !== optionsRef.current.strategy ||
        loading.configurationVersion !== (optionsRef.current.configurationVersion ?? 0) ||
        !canReadOrLaunch(optionsRef.current, loading.owner))
    )
      void load();
  }, [canOpenPicker, closePicker, load, releaseClaim]);

  const visibleOwner = captureOwner(optionsRef.current);
  return {
    busy,
    canOpenPicker,
    choices,
    closePicker,
    error: state.kind === "error" ? state.message : null,
    load,
    openPicker,
    pickerOpen:
      pickerOpen && visibleOwner !== null && canReadOrLaunch(optionsRef.current, visibleOwner),
    refresh: load,
    select,
    selectedName,
    startNamed,
    startSelected,
    state,
  };
}

function captureOwner<TPrivate>(
  options: UseNodeLaunchConfigurationPickerOptions<TPrivate>,
): CapturedOwner | null {
  return options.rootPath && options.workspaceId
    ? { rootPath: options.rootPath, workspaceId: options.workspaceId }
    : null;
}

function canReadOrLaunch<TPrivate>(
  options: UseNodeLaunchConfigurationPickerOptions<TPrivate>,
  owner: CapturedOwner,
): boolean {
  if (
    !options.workspaceTrusted ||
    options.blocked ||
    !workspaceRootKeysEqual(options.rootPath, owner.rootPath) ||
    options.workspaceId !== owner.workspaceId
  )
    return false;
  return (
    safelyCall(() => options.isWorkspaceCurrent(owner.rootPath, owner.workspaceId)) &&
    safelyCall(options.isWorkspaceTrusted) &&
    !safelyCall(options.isBlocked, true)
  );
}

function canUseLoaded<TPrivate>(
  options: UseNodeLaunchConfigurationPickerOptions<TPrivate>,
  loaded: LoadedConfigurations<TPrivate>,
): boolean {
  return (
    options.workspaceReads === loaded.reads &&
    options.strategy === loaded.strategy &&
    (options.configurationVersion ?? 0) === loaded.configurationVersion &&
    canReadOrLaunch(options, loaded.owner)
  );
}

function canFinishAcceptedStart<TPrivate>(
  options: UseNodeLaunchConfigurationPickerOptions<TPrivate>,
  loaded: LoadedConfigurations<TPrivate>,
): boolean {
  if (
    !options.workspaceTrusted ||
    !workspaceRootKeysEqual(options.rootPath, loaded.owner.rootPath) ||
    options.workspaceId !== loaded.owner.workspaceId ||
    options.workspaceReads !== loaded.reads ||
    options.strategy !== loaded.strategy ||
    (options.configurationVersion ?? 0) !== loaded.configurationVersion
  )
    return false;
  return (
    safelyCall(() => options.isWorkspaceCurrent(loaded.owner.rootPath, loaded.owner.workspaceId)) &&
    safelyCall(options.isWorkspaceTrusted)
  );
}

function safelyCall(callback: () => boolean, fallback = false): boolean {
  try {
    return callback();
  } catch {
    return fallback;
  }
}

export function boundedNodeLaunchConfigurationMessage(value: string): string {
  const normalized = [...new TextDecoder().decode(new TextEncoder().encode(value))]
    .map((character) =>
      /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(character) ? "�" : character,
    )
    .join("");
  const bytes = new TextEncoder().encode(normalized);
  if (bytes.byteLength <= MAX_NODE_LAUNCH_CONFIGURATION_PICKER_MESSAGE_BYTES) return normalized;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const suffix = new TextEncoder().encode("…");
  let end = MAX_NODE_LAUNCH_CONFIGURATION_PICKER_MESSAGE_BYTES - suffix.byteLength;
  while (end > 0) {
    try {
      return `${decoder.decode(bytes.slice(0, end))}…`;
    } catch {
      end -= 1;
    }
  }
  return "";
}

function vscodeDiagnosticNotice(
  diagnostics: readonly NodeLaunchConfigurationDiagnostic[],
): NodeLaunchConfigurationPickerDiagnosticNotice | undefined {
  if (diagnostics.length === 0) return undefined;
  const skippedCount = diagnostics.filter(({ severity }) => severity === "skipped").length;
  const reduced = diagnostics.filter(
    (
      diagnostic,
    ): diagnostic is Extract<NodeLaunchConfigurationDiagnostic, { severity: "reduced" }> =>
      diagnostic.severity === "reduced",
  );
  const fields = [...new Set(reduced.flatMap(({ fields: diagnosticFields }) => diagnosticFields))];
  const messages: string[] = [];
  if (skippedCount > 0) {
    messages.push(
      `${skippedCount} VS Code launch ${skippedCount === 1 ? "item was skipped because it is" : "items were skipped because they are"} unsupported or invalid.`,
    );
  }
  if (reduced.length > 0) {
    const fieldNames = fields.join(" and ");
    messages.push(
      `${reduced.length} VS Code launch ${reduced.length === 1 ? "configuration was" : "configurations were"} imported with reduced capability: ${fieldNames} ${fields.length === 1 ? "is" : "are"} not enforced; generated files come from tsconfig outDir.`,
    );
  }
  const count = skippedCount + reduced.length;
  return Object.freeze({
    count,
    message: boundedNodeLaunchConfigurationMessage(messages.join(" ")),
  });
}
