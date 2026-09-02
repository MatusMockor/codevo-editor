import {
  MAX_APP_UPDATE_DATE_LENGTH,
  MAX_APP_UPDATE_NOTES_LENGTH,
  MAX_APP_UPDATE_VERSION_LENGTH,
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
  relaunch(): Promise<void>;
}

interface RetainedCandidate {
  readonly revision: number;
  readonly update: TauriUpdaterBridgeUpdate;
  operation: "idle" | "downloading" | "installing" | "closing";
  releaseRequested: boolean;
  closed: boolean;
}

export class TauriAppUpdaterGateway implements AppUpdaterGateway {
  private revision = 0;
  private candidate: RetainedCandidate | null = null;
  private readonly currentVersion: string;

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
    const requestRevision = this.nextRevision();
    const previousCandidate = this.candidate;
    this.candidate = null;
    if (previousCandidate) {
      await this.releaseCandidate(previousCandidate);
      this.requireCurrentRevision(requestRevision);
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
      revision: requestRevision,
      update,
      operation: "idle",
      releaseRequested: false,
      closed: false,
    };
    return {
      kind: "available",
      candidate: candidateFromUpdate(requestRevision, this.currentVersion, update),
    };
  }

  async download(candidateRevision: number): Promise<void> {
    const candidate = this.requireCandidate(candidateRevision);
    candidate.operation = "downloading";
    const settlement = await settleNativeOperation(() => candidate.update.download());
    candidate.operation = "idle";
    if (candidate.releaseRequested) {
      await this.closeCandidate(candidate);
      throw settlementError(settlement, "The application update candidate is no longer current.");
    }
    if (settlement.kind === "failed") throw settlement.error;
    this.requireCandidate(candidateRevision);
  }

  async installAndRestart(candidateRevision: number): Promise<void> {
    const candidate = this.requireCandidate(candidateRevision);
    candidate.operation = "installing";
    const settlement = await settleNativeOperation(() => candidate.update.install());
    candidate.operation = "idle";
    if (settlement.kind === "failed") {
      if (candidate.releaseRequested) await this.closeCandidate(candidate);
      throw settlement.error;
    }
    await this.closeCandidate(candidate);
    if (candidate.releaseRequested) {
      throw new Error("The application update candidate is no longer current.");
    }
    this.requireCandidate(candidateRevision);
    this.candidate = null;
    await this.bridge.relaunch();
    this.requireCurrentRevision(candidateRevision);
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
    if (candidate.operation === "closing") return;
    const previousOperation = candidate.operation;
    candidate.operation = "closing";
    try {
      await candidate.update.close();
      if (candidate.operation !== "closing") {
        throw new Error("The application update close lease was replaced.");
      }
      candidate.closed = true;
      candidate.operation = "idle";
    } catch (error) {
      if (candidate.operation === "closing") candidate.operation = previousOperation;
      throw error;
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
