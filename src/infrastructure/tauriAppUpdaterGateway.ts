import {
  MAX_APP_UPDATE_DATE_LENGTH,
  MAX_APP_UPDATE_NOTES_LENGTH,
  MAX_APP_UPDATE_VERSION_LENGTH,
  type AppUpdatePreparation,
  type AppUpdateCandidate,
  type AppUpdateCheckResult,
  type AppUpdaterGateway,
} from "../domain/appUpdater";

export interface TauriUpdaterBridgeUpdate {
  readonly currentVersion: string;
  readonly version: string;
  readonly date?: string;
  readonly body?: string;
  download(): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}

export interface TauriUpdaterBridge {
  check(): Promise<unknown>;
  getInstallMode?(): Promise<unknown>;
  relaunch(): Promise<void>;
}

type InstallMode = "prepareBeforeRestart" | "installOnRestart";

interface RetainedCandidate {
  readonly mode: InstallMode;
  readonly revision: number;
  readonly update: TauriUpdaterBridgeUpdate;
  operation: "idle" | "downloading" | "installing" | "closing";
  releaseRequested: boolean;
  closed: boolean;
  closing: Promise<void> | null;
}

export class TauriAppUpdaterGateway implements AppUpdaterGateway {
  private revision = 0;
  private candidate: RetainedCandidate | null = null;
  private readonly currentVersion: string;
  private installed: { snapshot: AppUpdateCandidate; resource: RetainedCandidate } | null = null;
  private installing: Promise<void> | null = null;
  private restarting = false;

  constructor(
    private readonly bridge: TauriUpdaterBridge,
    currentVersion: string,
  ) {
    this.currentVersion = boundedString(
      currentVersion,
      "currentVersion",
      MAX_APP_UPDATE_VERSION_LENGTH,
    );
  }

  async check(): Promise<AppUpdateCheckResult> {
    if (this.restarting) throw new Error("An application update operation is already active.");
    const requestRevision = this.nextRevision();
    if (this.installing) {
      await this.installing;
      this.requireCurrentRevision(requestRevision);
    }
    if (this.installed) {
      this.installed.snapshot = { ...this.installed.snapshot, candidateRevision: requestRevision };
      return { kind: "readyToRestart", candidate: this.installed.snapshot };
    }
    const previousCandidate = this.candidate;
    this.candidate = null;
    if (previousCandidate) {
      await this.releaseCandidate(previousCandidate);
      this.requireCurrentRevision(requestRevision);
    }
    let mode: InstallMode = "installOnRestart";
    if (this.bridge.getInstallMode) {
      const rawMode = await this.bridge.getInstallMode();
      this.requireCurrentRevision(requestRevision);
      if (rawMode !== "prepareBeforeRestart" && rawMode !== "installOnRestart") {
        throw new TypeError("Invalid application update install mode.");
      }
      mode = rawMode;
    }
    const rawUpdate = await this.bridge.check();
    if (rawUpdate === null) {
      this.requireCurrentRevision(requestRevision);
      return { kind: "upToDate", currentVersion: this.currentVersion };
    }
    const update = await this.parseOwnedUpdate(rawUpdate, requestRevision);
    this.requireCurrentRevision(requestRevision);
    if (update.currentVersion !== this.currentVersion) {
      await update.close();
      this.requireCurrentRevision(requestRevision);
      throw new Error("The updater current version does not match the application version.");
    }
    this.candidate = {
      mode,
      revision: requestRevision,
      update,
      operation: "idle",
      releaseRequested: false,
      closed: false,
      closing: null,
    };
    return {
      kind: "available",
      candidate: candidateFromUpdate(requestRevision, this.currentVersion, update),
    };
  }

  async download(candidateRevision: number): Promise<AppUpdatePreparation> {
    const candidate = this.requireIdleCandidate(candidateRevision);
    candidate.operation = "downloading";
    const settlement = await settleNativeOperation(() => candidate.update.download());
    candidate.operation = "idle";
    if (candidate.releaseRequested) {
      await this.closeCandidate(candidate);
      throw settlementError(settlement, "The application update candidate is no longer current.");
    }
    if (settlement.kind === "failed") throw settlement.error;
    this.requireCandidate(candidateRevision);
    if (candidate.mode === "installOnRestart") return "readyToInstall";
    await this.installCandidate(candidate);
    return "readyToRestart";
  }

  async installAndRestart(candidateRevision: number): Promise<void> {
    if (this.restarting || this.installing) {
      throw new Error("An application update operation is already active.");
    }
    this.restarting = true;
    try {
      if (!this.installed) {
        const candidate = this.requireIdleCandidate(candidateRevision);
        await this.installCandidate(candidate);
      }
      this.requireCurrentRevision(candidateRevision);
      const installed = this.installed;
      if (!installed || installed.snapshot.candidateRevision !== candidateRevision) {
        throw new Error("The application update candidate is no longer current.");
      }
      await this.closeCandidate(installed.resource);
      this.requireCurrentRevision(candidateRevision);
      await this.bridge.relaunch();
      this.requireCurrentRevision(candidateRevision);
    } finally {
      this.restarting = false;
    }
  }

  private async installCandidate(candidate: RetainedCandidate): Promise<void> {
    candidate.operation = "installing";
    let finish!: () => void;
    this.installing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      await this.performInstall(candidate);
    } finally {
      this.installing = null;
      finish();
    }
  }

  private async performInstall(candidate: RetainedCandidate): Promise<void> {
    const settlement = await settleNativeOperation(() => candidate.update.install());
    candidate.operation = "idle";
    if (settlement.kind === "succeeded") {
      this.installed = {
        snapshot: candidateFromUpdate(candidate.revision, this.currentVersion, candidate.update),
        resource: candidate,
      };
    }
    if (settlement.kind === "failed") {
      if (candidate.releaseRequested) await this.closeCandidate(candidate);
      throw settlement.error;
    }
    const cleanup = await settleNativeOperation(() => this.closeCandidate(candidate));
    if (candidate.releaseRequested) {
      throw new Error("The application update candidate is no longer current.");
    }
    this.requireCandidate(candidate.revision);
    if (candidate.mode === "installOnRestart" && cleanup.kind === "failed") throw cleanup.error;
  }

  async dispose(): Promise<void> {
    const disposalRevision = this.nextRevision();
    const candidate = this.candidate;
    this.candidate = null;
    if (!candidate) return;
    try {
      await this.releaseCandidate(candidate);
    } catch (error) {
      if (this.revision === disposalRevision && !candidate.closed) this.candidate = candidate;
      throw error;
    }
    if (this.revision !== disposalRevision) return;
  }

  private async parseOwnedUpdate(
    rawUpdate: unknown,
    requestRevision: number,
  ): Promise<TauriUpdaterBridgeUpdate> {
    let update: TauriUpdaterBridgeUpdate;
    try {
      update = parseTauriUpdaterBridgeUpdate(rawUpdate);
    } catch (error) {
      await closeMalformedUpdaterResource(rawUpdate);
      this.requireCurrentRevision(requestRevision);
      throw error;
    }
    if (this.revision === requestRevision) return update;
    await update.close();
    this.requireCurrentRevision(requestRevision);
    return update;
  }

  private async releaseCandidate(candidate: RetainedCandidate): Promise<void> {
    candidate.releaseRequested = true;
    if (candidate.operation !== "idle") return;
    await this.closeCandidate(candidate);
  }

  private async closeCandidate(candidate: RetainedCandidate): Promise<void> {
    if (candidate.closed) return;
    if (candidate.closing) return candidate.closing;
    candidate.operation = "closing";
    const closing = Promise.resolve().then(() => candidate.update.close());
    candidate.closing = closing;
    try {
      await closing;
      candidate.closed = true;
    } finally {
      candidate.operation = "idle";
      candidate.closing = null;
    }
  }

  private nextRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  private requireCurrentRevision(revision: number): void {
    if (this.revision === revision) return;
    throw new Error("The application update request is stale.");
  }

  private requireIdleCandidate(revision: number): RetainedCandidate {
    const candidate = this.requireCandidate(revision);
    if (candidate.operation !== "idle" || candidate.closed || this.installed) {
      throw new Error("An application update operation is already active.");
    }
    return candidate;
  }

  private requireCandidate(revision: number): RetainedCandidate {
    const candidate = this.candidate;
    if (candidate?.revision === revision && this.revision === revision) return candidate;
    throw new Error("The application update candidate is no longer current.");
  }
}

export function parseTauriUpdaterBridgeUpdate(value: unknown): TauriUpdaterBridgeUpdate {
  if (!isRecord(value)) throw new TypeError("Invalid application update response.");
  const currentVersion = boundedString(
    value.currentVersion,
    "currentVersion",
    MAX_APP_UPDATE_VERSION_LENGTH,
  );
  const version = boundedString(value.version, "version", MAX_APP_UPDATE_VERSION_LENGTH);
  const date = optionalBoundedString(value.date, "date", MAX_APP_UPDATE_DATE_LENGTH);
  const body = optionalBoundedString(value.body, "body", MAX_APP_UPDATE_NOTES_LENGTH);
  if (typeof value.download !== "function") throw invalidField("download");
  if (typeof value.install !== "function") throw invalidField("install");
  if (typeof value.close !== "function") throw invalidField("close");
  return {
    currentVersion,
    version,
    date,
    body,
    download: value.download.bind(value) as () => Promise<void>,
    install: value.install.bind(value) as () => Promise<void>,
    close: value.close.bind(value) as () => Promise<void>,
  };
}

function candidateFromUpdate(
  candidateRevision: number,
  currentVersion: string,
  update: TauriUpdaterBridgeUpdate,
): AppUpdateCandidate {
  return {
    candidateRevision,
    currentVersion,
    version: update.version,
    date: update.date ?? null,
    notes: update.body ?? null,
  };
}

function boundedString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string") throw invalidField(field);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) throw invalidField(field);
  return normalized;
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedString(value, field, maximumLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidField(field: string): TypeError {
  return new TypeError(`Invalid application update response field: ${field}.`);
}

async function closeMalformedUpdaterResource(value: unknown): Promise<void> {
  if (!isRecord(value)) return;
  if (typeof value.close !== "function") return;
  await Promise.resolve(Reflect.apply(value.close, value, []));
}

type NativeOperationSettlement =
  { readonly kind: "succeeded" } | { readonly kind: "failed"; readonly error: unknown };

async function settleNativeOperation(
  operation: () => Promise<void>,
): Promise<NativeOperationSettlement> {
  try {
    await operation();
    return { kind: "succeeded" };
  } catch (error) {
    return { kind: "failed", error };
  }
}

function settlementError(settlement: NativeOperationSettlement, staleMessage: string): unknown {
  if (settlement.kind === "failed") return settlement.error;
  return new Error(staleMessage);
}
