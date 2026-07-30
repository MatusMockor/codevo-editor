import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
  WorkspaceFileChangeUnsubscribeFn,
} from "../domain/workspaceFileChange";

const WORKSPACE_FILE_CHANGED_EVENT = "workspace://file-changed";

type InvokeStartCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenToFileChangeEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<WorkspaceFileChangeUnsubscribeFn>;
type RuntimeDetector = () => boolean;

interface WorkspaceFileWatchStartReceipt {
  rootPath: string;
  watchGeneration: number;
}

type WorkspaceFileChangeWireEvent = WorkspaceFileChangeEvent & {
  watchGeneration: number;
};

interface PendingWorkspaceFileChangeWireEvent {
  event: WorkspaceFileChangeWireEvent;
}

interface WorkspaceFileChangeGatewayLimits {
  readonly maxListeners?: number;
  readonly maxRoots?: number;
  readonly maxStartsInFlight?: number;
  readonly operationTimeoutMs?: number;
}

const MAX_PENDING_WORKSPACE_FILE_CHANGE_WIRE_EVENTS = 128;
const MAX_WORKSPACE_FILE_CHANGE_PATH_LENGTH = 32_768;
const DEFAULT_MAX_WORKSPACE_FILE_CHANGE_LISTENERS = 16;
const DEFAULT_MAX_WORKSPACE_FILE_CHANGE_ROOTS = 16;
const DEFAULT_MAX_WORKSPACE_FILE_CHANGE_STARTS = 16;
const DEFAULT_WORKSPACE_FILE_CHANGE_OPERATION_TIMEOUT_MS = 15_000;
const utf8Encoder = new TextEncoder();

const invokeStartCommand: InvokeStartCommand = (command, args) => invoke<unknown>(command, args);
const listenToFileChangeEvent: ListenToFileChangeEvent = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriWorkspaceFileChangeGateway implements WorkspaceFileChangeGateway {
  private readonly expectedGenerationByRoot = new Map<string, number>();
  private readonly canonicalRootByRequestedRoot = new Map<string, string>();
  private readonly requestedRootByCanonicalRoot = new Map<string, string>();
  private readonly rootsNeedingRescan = new Set<string>();
  private readonly startLeaseByRequestedRoot = new Map<string, number>();
  private readonly latestLeaseByCanonicalRoot = new Map<string, number>();
  private readonly knownRequestedRoots = new Set<string>();
  private readonly pendingRequestedRoots = new Set<string>();
  private readonly pendingStopByRequestedRoot = new Map<string, Promise<boolean>>();
  private readonly releasedGenerationByCanonicalRoot = new Map<string, number>();
  private releasedGenerationOverflowed = false;
  private readonly pendingWireEvents: PendingWorkspaceFileChangeWireEvent[] = [];
  private readonly listeners = new Set<(event: WorkspaceFileChangeEvent) => void>();
  private listenPromise: Promise<WorkspaceFileChangeUnsubscribeFn> | null = null;
  private listenAttempt: symbol | null = null;
  private listenRegistrationOutstanding = false;
  private listenUnsubscribe: WorkspaceFileChangeUnsubscribeFn | null = null;
  private readonly overflowedWireRoots = new Set<string>();
  private readonly maxListeners: number;
  private readonly maxRoots: number;
  private readonly maxStartsInFlight: number;
  private readonly operationTimeoutMs: number;
  private rejectDisposal!: (error: Error) => void;
  private readonly disposal = new Promise<never>((_resolve, reject) => {
    this.rejectDisposal = reject;
  });
  private listenerGapDirty = false;
  private pendingGlobalOverflow = false;
  private nextStartLease = 0;
  private outstandingStartTransports = 0;
  private outstandingStopTransports = 0;
  private startsInFlight = 0;
  private disposed = false;

  constructor(
    private readonly invokeCommand: InvokeStartCommand = invokeStartCommand,
    private readonly listenToEvent: ListenToFileChangeEvent = listenToFileChangeEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    limits: WorkspaceFileChangeGatewayLimits = {},
  ) {
    this.maxListeners = positiveInteger(
      limits.maxListeners,
      DEFAULT_MAX_WORKSPACE_FILE_CHANGE_LISTENERS,
    );
    this.maxRoots = positiveInteger(limits.maxRoots, DEFAULT_MAX_WORKSPACE_FILE_CHANGE_ROOTS);
    this.maxStartsInFlight = positiveInteger(
      limits.maxStartsInFlight,
      DEFAULT_MAX_WORKSPACE_FILE_CHANGE_STARTS,
    );
    this.operationTimeoutMs = positiveInteger(
      limits.operationTimeoutMs,
      DEFAULT_WORKSPACE_FILE_CHANGE_OPERATION_TIMEOUT_MS,
    );
    void this.disposal.catch(() => undefined);
  }

  async startWatching(rootPath: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    this.assertNotDisposed();
    if (boundedString(rootPath) === null) {
      throw new Error("Workspace file watcher root is invalid or too large.");
    }
    const pendingStop = this.pendingStopByRequestedRoot.get(rootPath);
    if (pendingStop && !(await pendingStop)) {
      throw new Error("Workspace file watcher cleanup could not be confirmed.");
    }
    if (
      !this.knownRequestedRoots.has(rootPath) &&
      !this.pendingRequestedRoots.has(rootPath) &&
      this.knownRequestedRoots.size + this.pendingRequestedRoots.size >= this.maxRoots
    ) {
      throw new Error("Workspace file watcher root capacity has been reached.");
    }
    if (this.startsInFlight >= this.maxStartsInFlight) {
      throw new Error("Workspace file watcher start capacity has been reached.");
    }
    const startLease = ++this.nextStartLease;
    this.pendingRequestedRoots.add(rootPath);
    this.startLeaseByRequestedRoot.set(rootPath, startLease);
    this.startsInFlight += 1;
    try {
      await this.ensureListening();
      this.assertNotDisposed();
    } catch (error) {
      if (this.startLeaseByRequestedRoot.get(rootPath) === startLease) {
        this.startLeaseByRequestedRoot.delete(rootPath);
      }
      this.pendingRequestedRoots.delete(rootPath);
      this.startsInFlight -= 1;
      throw error;
    }
    this.pendingRequestedRoots.delete(rootPath);
    const previouslyAdmittedCanonicalRoot = this.canonicalRootByRequestedRoot.get(rootPath);
    if (
      previouslyAdmittedCanonicalRoot &&
      !this.hasOtherRequestedRootForCanonical(previouslyAdmittedCanonicalRoot, rootPath)
    ) {
      // Revoke before invoking so a delayed event from the old watcher cannot
      // slip through while a replacement start receipt is in flight.
      this.expectedGenerationByRoot.delete(previouslyAdmittedCanonicalRoot);
    }
    let abandoned = false;
    try {
      const startTransport = this.invokeStartBounded(rootPath, startLease);
      void startTransport.then(
        (value) => {
          if (abandoned) {
            void this.cleanupLateStartReceipt(rootPath, value);
          }
        },
        () => undefined,
      );
      const receipt = parseStartReceipt(
        await withTimeout(
          startTransport,
          this.operationTimeoutMs,
          "Workspace file watcher start",
          this.disposal,
        ),
      );
      if (this.disposed) {
        await this.stopWatchExact(receipt.rootPath, receipt.watchGeneration);
        this.assertNotDisposed();
      }
      const currentStartLease = this.startLeaseByRequestedRoot.get(rootPath);
      if (currentStartLease !== startLease) {
        if (currentStartLease === undefined) {
          await this.stopWatchExact(receipt.rootPath, receipt.watchGeneration);
        }
        return;
      }
      const releasedGeneration = this.releasedGenerationByCanonicalRoot.get(receipt.rootPath);
      if (releasedGeneration !== undefined && receipt.watchGeneration < releasedGeneration) {
        throw new Error("Workspace file watcher returned a released watch generation.");
      }
      const latestCanonicalLease = this.latestLeaseByCanonicalRoot.get(receipt.rootPath) ?? 0;
      if (startLease < latestCanonicalLease) {
        return;
      }
      this.releasedGenerationByCanonicalRoot.delete(receipt.rootPath);
      this.latestLeaseByCanonicalRoot.set(receipt.rootPath, startLease);
      const previousCanonicalRoot = this.canonicalRootByRequestedRoot.get(rootPath);
      if (previousCanonicalRoot && previousCanonicalRoot !== receipt.rootPath) {
        this.revokeCanonicalRootIfUnreferenced(previousCanonicalRoot, rootPath);
      }
      this.canonicalRootByRequestedRoot.set(rootPath, receipt.rootPath);
      this.requestedRootByCanonicalRoot.set(receipt.rootPath, rootPath);
      this.expectedGenerationByRoot.set(receipt.rootPath, receipt.watchGeneration);
      this.flushPendingWireEvents(receipt.rootPath, receipt.watchGeneration);
    } catch (error) {
      abandoned = true;
      if (this.startLeaseByRequestedRoot.get(rootPath) === startLease) {
        this.rootsNeedingRescan.add(rootPath);
        const previousCanonicalRoot = this.canonicalRootByRequestedRoot.get(rootPath);
        if (previousCanonicalRoot) {
          this.canonicalRootByRequestedRoot.delete(rootPath);
          this.revokeCanonicalRootIfUnreferenced(previousCanonicalRoot, rootPath);
        }
        this.startLeaseByRequestedRoot.delete(rootPath);
      }
      throw error;
    } finally {
      this.startsInFlight -= 1;
      if (this.startsInFlight === 0) {
        this.pendingWireEvents.length = 0;
        this.overflowedWireRoots.clear();
        this.pendingGlobalOverflow = false;
      }
    }
  }

  async subscribeFileChanges(
    listener: (event: WorkspaceFileChangeEvent) => void,
  ): Promise<WorkspaceFileChangeUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return () => undefined;
    }
    this.assertNotDisposed();
    if (!this.listeners.has(listener) && this.listeners.size >= this.maxListeners) {
      throw new Error("Workspace file watcher listener capacity has been reached.");
    }
    this.listeners.add(listener);
    let recoveryAttempted = false;
    try {
      await this.ensureListening();
      if (this.listenerGapDirty) {
        recoveryAttempted = true;
        this.listenerGapDirty = false;
        const requestedRoots = new Set(this.requestedRootByCanonicalRoot.values());
        for (const rootPath of requestedRoots) {
          listener({
            rootPath,
            kind: "rescanRequired",
            path: rootPath,
            previousPath: null,
            relativePath: "",
            previousRelativePath: null,
            fileKind: "directory",
          });
        }
      }
    } catch (error) {
      if (recoveryAttempted) {
        this.listenerGapDirty = true;
      }
      this.listeners.delete(listener);
      throw error;
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  async releaseRoot(rootPath: string): Promise<void> {
    const canonicalRoot = this.canonicalRootByRequestedRoot.get(rootPath);
    if (
      !canonicalRoot &&
      !this.startLeaseByRequestedRoot.has(rootPath) &&
      !this.knownRequestedRoots.has(rootPath)
    ) {
      return;
    }
    const generation = canonicalRoot ? this.expectedGenerationByRoot.get(canonicalRoot) : undefined;
    const hasOtherOwner = canonicalRoot
      ? this.hasOtherRequestedRootForCanonical(canonicalRoot, rootPath)
      : false;
    this.startLeaseByRequestedRoot.delete(rootPath);
    this.rootsNeedingRescan.add(rootPath);
    this.canonicalRootByRequestedRoot.delete(rootPath);
    if (!canonicalRoot) {
      return;
    }
    this.revokeCanonicalRootIfUnreferenced(canonicalRoot, rootPath);
    if (!hasOtherOwner && generation !== undefined) {
      const stopping = this.stopWatchExact(canonicalRoot, generation);
      this.pendingStopByRequestedRoot.set(rootPath, stopping);
      const stopped = await stopping;
      if (stopped) {
        if (
          !this.startLeaseByRequestedRoot.has(rootPath) &&
          !this.canonicalRootByRequestedRoot.has(rootPath)
        ) {
          this.knownRequestedRoots.delete(rootPath);
        }
      }
      if (this.pendingStopByRequestedRoot.get(rootPath) === stopping) {
        this.pendingStopByRequestedRoot.delete(rootPath);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectDisposal(new Error("Workspace file watcher gateway was disposed."));
    const stops = [...this.expectedGenerationByRoot].map(([rootPath, generation]) =>
      this.stopWatchExact(rootPath, generation),
    );
    await Promise.allSettled(stops);
    this.listeners.clear();
    this.pendingWireEvents.length = 0;
    this.overflowedWireRoots.clear();
    this.pendingGlobalOverflow = false;
    this.expectedGenerationByRoot.clear();
    this.canonicalRootByRequestedRoot.clear();
    this.requestedRootByCanonicalRoot.clear();
    this.startLeaseByRequestedRoot.clear();
    this.latestLeaseByCanonicalRoot.clear();
    this.releasedGenerationByCanonicalRoot.clear();
    this.releasedGenerationOverflowed = false;
    this.rootsNeedingRescan.clear();
    this.listenAttempt = null;
    const unsubscribe = this.listenUnsubscribe;
    this.listenUnsubscribe = null;
    this.listenPromise = null;
    unsubscribe?.();
  }

  private flushPendingWireEvents(rootPath: string, watchGeneration: number): void {
    const retained: PendingWorkspaceFileChangeWireEvent[] = [];
    for (const pending of this.pendingWireEvents) {
      if (pending.event.rootPath !== rootPath) {
        retained.push(pending);
      } else if (pending.event.watchGeneration === watchGeneration) {
        this.dispatchDomainEvent(this.toDomainEvent(pending.event));
      }
    }
    this.pendingWireEvents.splice(0, this.pendingWireEvents.length, ...retained);
    const requestedRoot = this.requestedRootByCanonicalRoot.get(rootPath) ?? rootPath;
    if (
      this.overflowedWireRoots.delete(rootPath) ||
      this.pendingGlobalOverflow ||
      this.rootsNeedingRescan.delete(requestedRoot)
    ) {
      this.dispatchDomainEvent({
        rootPath: requestedRoot,
        kind: "rescanRequired",
        path: requestedRoot,
        previousPath: null,
        relativePath: "",
        previousRelativePath: null,
        fileKind: "directory",
      });
    }
  }

  private dropPendingWireEvents(rootPath: string): void {
    const retained = this.pendingWireEvents.filter(
      (pending) => pending.event.rootPath !== rootPath,
    );
    this.pendingWireEvents.splice(0, this.pendingWireEvents.length, ...retained);
  }

  private revokeCanonicalRootIfUnreferenced(
    canonicalRoot: string,
    excludingRequestedRoot: string,
  ): void {
    const replacementRequestedRoot = [...this.canonicalRootByRequestedRoot].find(
      ([requestedRoot, candidate]) =>
        requestedRoot !== excludingRequestedRoot && candidate === canonicalRoot,
    );
    if (replacementRequestedRoot) {
      this.requestedRootByCanonicalRoot.set(canonicalRoot, replacementRequestedRoot[0]);
      return;
    }
    this.requestedRootByCanonicalRoot.delete(canonicalRoot);
    const generation = this.expectedGenerationByRoot.get(canonicalRoot);
    if (generation !== undefined) {
      this.rememberReleasedGeneration(canonicalRoot, generation);
    }
    this.expectedGenerationByRoot.delete(canonicalRoot);
    this.latestLeaseByCanonicalRoot.delete(canonicalRoot);
    this.dropPendingWireEvents(canonicalRoot);
  }

  private hasOtherRequestedRootForCanonical(
    canonicalRoot: string,
    excludingRequestedRoot: string,
  ): boolean {
    return [...this.canonicalRootByRequestedRoot].some(
      ([requestedRoot, candidate]) =>
        requestedRoot !== excludingRequestedRoot && candidate === canonicalRoot,
    );
  }

  private toDomainEvent(event: WorkspaceFileChangeWireEvent): WorkspaceFileChangeEvent {
    const { watchGeneration: _watchGeneration, ...domainEvent } = event;
    const requestedRoot = this.requestedRootByCanonicalRoot.get(event.rootPath);
    if (!requestedRoot || requestedRoot === event.rootPath) {
      return domainEvent;
    }
    return {
      ...domainEvent,
      rootPath: requestedRoot,
      path: pathFromRelative(requestedRoot, event.relativePath),
      previousPath:
        event.previousRelativePath == null
          ? event.previousPath
          : pathFromRelative(requestedRoot, event.previousRelativePath),
    };
  }

  private ensureListening(): Promise<WorkspaceFileChangeUnsubscribeFn> {
    this.assertNotDisposed();
    if (this.listenPromise) {
      return this.listenPromise;
    }
    if (this.listenRegistrationOutstanding) {
      return Promise.reject(
        new Error("Workspace file watcher listener transport capacity has been reached."),
      );
    }
    const attempt = Symbol("workspace-file-change-listener");
    this.listenAttempt = attempt;
    this.listenRegistrationOutstanding = true;
    const registration = this.listenToEvent(WORKSPACE_FILE_CHANGED_EVENT, (event) => {
      if (!this.disposed && this.listenAttempt === attempt) {
        this.handleWireEvent(event.payload);
      }
    }).then((unsubscribe) => {
      if (this.disposed || this.listenAttempt !== attempt) {
        unsubscribe();
        throw new Error("Workspace file watcher listener is no longer current.");
      }
      this.listenUnsubscribe = unsubscribe;
      return unsubscribe;
    });
    const releaseRegistration = () => {
      this.listenRegistrationOutstanding = false;
    };
    void registration.then(releaseRegistration, releaseRegistration);
    this.listenPromise = withTimeout(
      registration,
      this.operationTimeoutMs,
      "Workspace file watcher listener registration",
      this.disposal,
    ).catch((error: unknown) => {
      if (this.listenAttempt === attempt) {
        this.listenAttempt = null;
        this.listenPromise = null;
      }
      throw error;
    });
    return this.listenPromise;
  }

  private handleWireEvent(rawPayload: unknown): void {
    const payload = parseWireEvent(rawPayload);
    if (!payload) {
      return;
    }
    const expectedGeneration = this.expectedGenerationByRoot.get(payload.rootPath);
    if (expectedGeneration === undefined) {
      if (this.releasedGenerationOverflowed) {
        if (this.startsInFlight > 0) {
          this.pendingGlobalOverflow = true;
        }
        return;
      }
      const releasedGeneration = this.releasedGenerationByCanonicalRoot.get(payload.rootPath);
      if (releasedGeneration !== undefined && payload.watchGeneration <= releasedGeneration) {
        return;
      }
      if (this.startsInFlight > 0) {
        const duplicateIndex = this.pendingWireEvents.findIndex(
          (pending) =>
            pending.event.rootPath === payload.rootPath &&
            pending.event.watchGeneration === payload.watchGeneration &&
            pending.event.kind === payload.kind &&
            pending.event.relativePath === payload.relativePath &&
            pending.event.previousRelativePath === payload.previousRelativePath,
        );
        if (duplicateIndex >= 0) {
          this.pendingWireEvents[duplicateIndex] = { event: payload };
          return;
        }
        if (this.pendingWireEvents.length >= MAX_PENDING_WORKSPACE_FILE_CHANGE_WIRE_EVENTS) {
          const dropped = this.pendingWireEvents.shift();
          if (dropped) {
            if (this.overflowedWireRoots.size < this.maxRoots) {
              this.overflowedWireRoots.add(dropped.event.rootPath);
            } else {
              this.pendingGlobalOverflow = true;
            }
          }
        }
        this.pendingWireEvents.push({ event: payload });
      }
      return;
    }
    if (expectedGeneration === payload.watchGeneration) {
      this.dispatchDomainEvent(this.toDomainEvent(payload));
    }
  }

  private dispatchDomainEvent(event: WorkspaceFileChangeEvent): void {
    if (this.listeners.size === 0) {
      // No callback can consume exact events during this gap. A single dirty
      // bit is sufficient: the next subscriber rescans every admitted root.
      this.listenerGapDirty = true;
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
        this.listenerGapDirty = true;
      }
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Workspace file watcher gateway was disposed.");
    }
  }

  private rememberReleasedGeneration(canonicalRoot: string, generation: number): void {
    this.releasedGenerationByCanonicalRoot.delete(canonicalRoot);
    this.releasedGenerationByCanonicalRoot.set(canonicalRoot, generation);
    while (this.releasedGenerationByCanonicalRoot.size > this.maxRoots) {
      const oldestRoot = this.releasedGenerationByCanonicalRoot.keys().next().value;
      if (oldestRoot === undefined) {
        return;
      }
      this.releasedGenerationByCanonicalRoot.delete(oldestRoot);
      this.releasedGenerationOverflowed = true;
    }
  }

  private invokeStartBounded(rootPath: string, startLease: number): Promise<unknown> {
    if (this.outstandingStartTransports >= this.maxStartsInFlight) {
      return Promise.reject(
        new Error("Workspace file watcher transport capacity has been reached."),
      );
    }
    const newlyKnownRoot = !this.knownRequestedRoots.has(rootPath);
    this.knownRequestedRoots.add(rootPath);
    this.outstandingStartTransports += 1;
    let operation: Promise<unknown>;
    try {
      operation = this.invokeCommand("start_workspace_file_watch", { rootPath });
    } catch (error) {
      this.outstandingStartTransports -= 1;
      if (
        newlyKnownRoot &&
        this.startLeaseByRequestedRoot.get(rootPath) === startLease &&
        !this.canonicalRootByRequestedRoot.has(rootPath)
      ) {
        this.knownRequestedRoots.delete(rootPath);
      }
      throw error;
    }
    const release = () => {
      this.outstandingStartTransports -= 1;
    };
    void operation.then(release, () => {
      release();
      if (
        newlyKnownRoot &&
        this.startLeaseByRequestedRoot.get(rootPath) === startLease &&
        !this.canonicalRootByRequestedRoot.has(rootPath)
      ) {
        this.knownRequestedRoots.delete(rootPath);
      }
    });
    return operation;
  }

  private async cleanupLateStartReceipt(rootPath: string, value: unknown): Promise<void> {
    let receipt: WorkspaceFileWatchStartReceipt;
    try {
      receipt = parseStartReceipt(value);
    } catch {
      this.rootsNeedingRescan.add(rootPath);
      return;
    }
    const stopped = await this.stopWatchExact(receipt.rootPath, receipt.watchGeneration);
    if (
      stopped &&
      !this.startLeaseByRequestedRoot.has(rootPath) &&
      !this.canonicalRootByRequestedRoot.has(rootPath)
    ) {
      this.knownRequestedRoots.delete(rootPath);
    }
  }

  private async stopWatchExact(rootPath: string, watchGeneration: number): Promise<boolean> {
    if (this.outstandingStopTransports >= this.maxRoots) {
      return false;
    }
    this.outstandingStopTransports += 1;
    let operation: Promise<unknown>;
    try {
      operation = this.invokeCommand("stop_workspace_file_watch", {
        rootPath,
        watchGeneration,
      });
    } catch {
      this.outstandingStopTransports -= 1;
      return false;
    }
    const release = () => {
      this.outstandingStopTransports -= 1;
    };
    void operation.then(release, release);
    try {
      return (
        (await withTimeout(operation, this.operationTimeoutMs, "Workspace file watcher stop")) ===
        true
      );
    } catch {
      return false;
    }
  }
}

async function withTimeout<Result>(
  operation: Promise<Result>,
  timeoutMs: number,
  label: string,
  cancellation?: Promise<never>,
): Promise<Result> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race(
      cancellation ? [operation, timeout, cancellation] : [operation, timeout],
    );
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function parseStartReceipt(value: unknown): WorkspaceFileWatchStartReceipt {
  if (!isRecord(value) || !hasOnlyKeys(value, ["rootPath", "watchGeneration"])) {
    throw new Error("Workspace watcher returned an invalid start receipt.");
  }
  const rootPath = boundedString(value.rootPath);
  const watchGeneration = safeGeneration(value.watchGeneration);
  if (!rootPath || watchGeneration === null) {
    throw new Error("Workspace watcher returned an invalid start receipt.");
  }
  return { rootPath, watchGeneration };
}

function parseWireEvent(value: unknown): WorkspaceFileChangeWireEvent | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "watchGeneration",
      "rootPath",
      "kind",
      "path",
      "previousPath",
      "relativePath",
      "previousRelativePath",
      "fileKind",
    ])
  ) {
    return null;
  }
  const rootPath = boundedString(value.rootPath);
  const path = boundedString(value.path);
  const relativePath = safeRelativePath(value.relativePath);
  const watchGeneration = safeGeneration(value.watchGeneration);
  const previousPath = optionalBoundedString(value.previousPath);
  const previousRelativePath = optionalSafeRelativePath(value.previousRelativePath);
  if (
    !rootPath ||
    !path ||
    relativePath === null ||
    watchGeneration === null ||
    !isChangeKind(value.kind) ||
    previousPath === undefined ||
    previousRelativePath === undefined ||
    !isFileKind(value.fileKind) ||
    normalizedPath(path) !== normalizedPath(pathFromRelative(rootPath, relativePath)) ||
    (value.kind === "renamed") !== (previousPath !== null && previousRelativePath !== null) ||
    (previousPath !== null &&
      normalizedPath(previousPath) !==
        normalizedPath(pathFromRelative(rootPath, previousRelativePath ?? "")))
  ) {
    return null;
  }
  return {
    rootPath,
    path,
    relativePath,
    watchGeneration,
    kind: value.kind,
    previousPath,
    previousRelativePath,
    fileKind: value.fileKind,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, allowEmpty = false): string | null {
  return typeof value === "string" &&
    value.length <= MAX_WORKSPACE_FILE_CHANGE_PATH_LENGTH &&
    utf8Encoder.encode(value).byteLength <= MAX_WORKSPACE_FILE_CHANGE_PATH_LENGTH &&
    !value.includes("\0") &&
    (allowEmpty || value.length > 0)
    ? value
    : null;
}

function safeGeneration(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalBoundedString(value: unknown): string | null | undefined {
  return value === null ? null : (boundedString(value) ?? undefined);
}

function safeRelativePath(value: unknown): string | null {
  const path = boundedString(value, true);
  if (
    path === null ||
    /^[\\/]/.test(path) ||
    path.split(/[\\/]/).some((component) => component === "..")
  ) {
    return null;
  }
  return path;
}

function optionalSafeRelativePath(value: unknown): string | null | undefined {
  return value === null ? null : (safeRelativePath(value) ?? undefined);
}

function isChangeKind(value: unknown): value is WorkspaceFileChangeEvent["kind"] {
  return (
    value === "created" ||
    value === "deleted" ||
    value === "modified" ||
    value === "renamed" ||
    value === "rescanRequired"
  );
}

function isFileKind(value: unknown): value is WorkspaceFileChangeEvent["fileKind"] {
  return value === null || value === "directory" || value === "file";
}

function pathFromRelative(rootPath: string, relativePath: string): string {
  if (!relativePath) {
    return rootPath;
  }
  return `${rootPath.replace(/[\\/]+$/, "")}/${relativePath.replace(/^[\\/]+/, "")}`;
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function hasOnlyKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
