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

const MAX_PENDING_WORKSPACE_FILE_CHANGE_WIRE_EVENTS = 128;
const MAX_WORKSPACE_FILE_CHANGE_PATH_LENGTH = 32_768;
const utf8Encoder = new TextEncoder();

const invokeStartCommand: InvokeStartCommand = (command, args) => invoke<unknown>(command, args);
const listenToFileChangeEvent: ListenToFileChangeEvent = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriWorkspaceFileChangeGateway implements WorkspaceFileChangeGateway {
  private readonly expectedGenerationByRoot = new Map<string, number>();
  private readonly canonicalRootByRequestedRoot = new Map<string, string>();
  private readonly requestedRootByCanonicalRoot = new Map<string, string>();
  private readonly startLeaseByRequestedRoot = new Map<string, number>();
  private readonly latestLeaseByCanonicalRoot = new Map<string, number>();
  private readonly pendingWireEvents: PendingWorkspaceFileChangeWireEvent[] = [];
  private readonly listeners = new Set<(event: WorkspaceFileChangeEvent) => void>();
  private listenPromise: Promise<WorkspaceFileChangeUnsubscribeFn> | null = null;
  private readonly overflowedWireRoots = new Set<string>();
  private listenerGapDirty = false;
  private nextStartLease = 0;
  private startsInFlight = 0;

  constructor(
    private readonly invokeCommand: InvokeStartCommand = invokeStartCommand,
    private readonly listenToEvent: ListenToFileChangeEvent = listenToFileChangeEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async startWatching(rootPath: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.ensureListening();
    const startLease = ++this.nextStartLease;
    this.startLeaseByRequestedRoot.set(rootPath, startLease);
    const previouslyAdmittedCanonicalRoot = this.canonicalRootByRequestedRoot.get(rootPath);
    if (
      previouslyAdmittedCanonicalRoot &&
      !this.hasOtherRequestedRootForCanonical(previouslyAdmittedCanonicalRoot, rootPath)
    ) {
      // Revoke before invoking so a delayed event from the old watcher cannot
      // slip through while a replacement start receipt is in flight.
      this.expectedGenerationByRoot.delete(previouslyAdmittedCanonicalRoot);
    }
    this.startsInFlight += 1;
    try {
      const receipt = parseStartReceipt(
        await this.invokeCommand("start_workspace_file_watch", { rootPath }),
      );
      if (this.startLeaseByRequestedRoot.get(rootPath) !== startLease) {
        return;
      }
      const latestCanonicalLease = this.latestLeaseByCanonicalRoot.get(receipt.rootPath) ?? 0;
      if (startLease < latestCanonicalLease) {
        return;
      }
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
      if (this.startLeaseByRequestedRoot.get(rootPath) === startLease) {
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
      }
    }
  }

  async subscribeFileChanges(
    listener: (event: WorkspaceFileChangeEvent) => void,
  ): Promise<WorkspaceFileChangeUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return () => undefined;
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
    if (this.overflowedWireRoots.delete(rootPath)) {
      const requestedRoot = this.requestedRootByCanonicalRoot.get(rootPath) ?? rootPath;
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
    this.expectedGenerationByRoot.delete(canonicalRoot);
    this.requestedRootByCanonicalRoot.delete(canonicalRoot);
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
    this.listenPromise ??= this.listenToEvent(WORKSPACE_FILE_CHANGED_EVENT, (event) => {
      this.handleWireEvent(event.payload);
    }).catch((error: unknown) => {
      this.listenPromise = null;
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
      if (this.startsInFlight > 0) {
        if (this.pendingWireEvents.length >= MAX_PENDING_WORKSPACE_FILE_CHANGE_WIRE_EVENTS) {
          const dropped = this.pendingWireEvents.shift();
          if (dropped) {
            this.overflowedWireRoots.add(dropped.event.rootPath);
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
