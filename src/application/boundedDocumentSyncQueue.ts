import { boundedUtf8Length } from "../domain/incrementalDocumentSync";

export const DOCUMENT_SYNC_QUEUE_OPERATION_TIMEOUT_MS = 5_000;
export const DOCUMENT_SYNC_QUEUE_MAX_KEYS = 256;
export const DOCUMENT_SYNC_QUEUE_MAX_QUEUED_PER_KEY = 256;
export const DOCUMENT_SYNC_QUEUE_MAX_KEY_UTF8_BYTES = 4 * 1024;
export const DOCUMENT_SYNC_QUEUE_MAX_TOTAL_KEY_UTF8_BYTES = 256 * 1024;
export const DOCUMENT_SYNC_QUEUE_MAX_PAYLOAD_UTF8_BYTES_PER_OPERATION = 64 * 1024 * 1024;
export const DOCUMENT_SYNC_QUEUE_MAX_PAYLOAD_UTF8_BYTES_PER_KEY = 128 * 1024 * 1024;
export const DOCUMENT_SYNC_QUEUE_MAX_PAYLOAD_UTF8_BYTES_TOTAL = 512 * 1024 * 1024;

export interface BoundedDocumentSyncQueueLimits {
  readonly maxKeyUtf8Bytes: number;
  readonly maxKeys: number;
  readonly maxPayloadUtf8BytesPerKey: number;
  readonly maxPayloadUtf8BytesPerOperation: number;
  readonly maxPayloadUtf8BytesTotal: number;
  readonly maxQueuedPerKey: number;
  readonly maxTotalKeyUtf8Bytes: number;
  readonly operationTimeoutMs: number;
}

interface QueueTask {
  readonly completion: Promise<void>;
  readonly epoch: number;
  readonly outward: Promise<void>;
  outwardSettled: boolean;
  readonly operation: () => Promise<void>;
  readonly payloadUtf8Bytes: number;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly settleCompletion: () => void;
}

interface QueueSlot {
  active: QueueTask | null;
  readonly keyUtf8Bytes: number;
  payloadUtf8Bytes: number;
  readonly queued: QueueTask[];
  readonly reservations: Set<QueueReservationRecord>;
}

interface QueueReservationRecord {
  bytes: number;
  released: boolean;
}

export interface BoundedDocumentSyncPayloadReservation {
  release(): void;
  replace(retainedPayloads: readonly string[]): boolean;
}

const DEFAULT_LIMITS: BoundedDocumentSyncQueueLimits = Object.freeze({
  maxKeyUtf8Bytes: DOCUMENT_SYNC_QUEUE_MAX_KEY_UTF8_BYTES,
  maxKeys: DOCUMENT_SYNC_QUEUE_MAX_KEYS,
  maxPayloadUtf8BytesPerKey: DOCUMENT_SYNC_QUEUE_MAX_PAYLOAD_UTF8_BYTES_PER_KEY,
  maxPayloadUtf8BytesPerOperation: DOCUMENT_SYNC_QUEUE_MAX_PAYLOAD_UTF8_BYTES_PER_OPERATION,
  maxPayloadUtf8BytesTotal: DOCUMENT_SYNC_QUEUE_MAX_PAYLOAD_UTF8_BYTES_TOTAL,
  maxQueuedPerKey: DOCUMENT_SYNC_QUEUE_MAX_QUEUED_PER_KEY,
  maxTotalKeyUtf8Bytes: DOCUMENT_SYNC_QUEUE_MAX_TOTAL_KEY_UTF8_BYTES,
  operationTimeoutMs: DOCUMENT_SYNC_QUEUE_OPERATION_TIMEOUT_MS,
});

/**
 * Serializes exact-key document work. A timed-out operation remains the active
 * owner until its underlying promise settles, so a late old owner can never
 * overlap a replacement owner.
 */
export class BoundedDocumentSyncQueue {
  private epoch = 0;
  private readonly limits: BoundedDocumentSyncQueueLimits;
  private readonly slots = new Map<string, QueueSlot>();
  private totalKeyUtf8Bytes = 0;
  private totalPayloadUtf8Bytes = 0;

  constructor(
    private readonly projection: { current: Record<string, Promise<void>> },
    limits: Partial<BoundedDocumentSyncQueueLimits> = {},
  ) {
    this.limits = normalizeLimits(limits);
  }

  enqueue(
    key: string,
    operation: () => Promise<void>,
    retainedPayloads: readonly string[] = [],
  ): Promise<void> {
    let slot = this.slots.get(key);
    const taskCount = slot ? slot.queued.length + (slot.active ? 1 : 0) : 0;
    if (taskCount >= this.limits.maxQueuedPerKey) {
      return capacityRejection();
    }

    const payloadUtf8Bytes = measurePayloads(
      retainedPayloads,
      this.limits.maxPayloadUtf8BytesPerOperation,
    );
    if (
      payloadUtf8Bytes === null ||
      (slot?.payloadUtf8Bytes ?? 0) + payloadUtf8Bytes > this.limits.maxPayloadUtf8BytesPerKey ||
      this.totalPayloadUtf8Bytes + payloadUtf8Bytes > this.limits.maxPayloadUtf8BytesTotal
    ) {
      return capacityRejection();
    }

    if (!slot) {
      if (this.slots.size >= this.limits.maxKeys) {
        return capacityRejection();
      }
      const keyLength = boundedUtf8Length(key, this.limits.maxKeyUtf8Bytes);
      if (
        keyLength.status !== "within-limit" ||
        this.totalKeyUtf8Bytes + keyLength.bytes > this.limits.maxTotalKeyUtf8Bytes
      ) {
        return capacityRejection();
      }
      slot = {
        active: null,
        keyUtf8Bytes: keyLength.bytes,
        payloadUtf8Bytes: 0,
        queued: [],
        reservations: new Set(),
      };
      this.slots.set(key, slot);
      this.totalKeyUtf8Bytes += keyLength.bytes;
    }

    const task = createTask(this.epoch, operation, payloadUtf8Bytes);
    slot.queued.push(task);
    slot.payloadUtf8Bytes += payloadUtf8Bytes;
    this.totalPayloadUtf8Bytes += payloadUtf8Bytes;
    this.projection.current[key] = task.completion;
    this.startNext(key, slot);
    return observableRejection(task);
  }

  reservePayload(
    key: string,
    retainedPayloads: readonly string[],
  ): BoundedDocumentSyncPayloadReservation | null {
    let slot = this.slots.get(key);
    const payloadUtf8Bytes = measurePayloads(
      retainedPayloads,
      this.limits.maxPayloadUtf8BytesPerOperation,
    );
    if (
      payloadUtf8Bytes === null ||
      (slot?.payloadUtf8Bytes ?? 0) + payloadUtf8Bytes > this.limits.maxPayloadUtf8BytesPerKey ||
      this.totalPayloadUtf8Bytes + payloadUtf8Bytes > this.limits.maxPayloadUtf8BytesTotal
    ) {
      return null;
    }
    if (!slot) {
      const createdSlot = this.createSlot(key);
      if (!createdSlot) return null;
      slot = createdSlot;
    }

    slot.payloadUtf8Bytes += payloadUtf8Bytes;
    this.totalPayloadUtf8Bytes += payloadUtf8Bytes;
    const record: QueueReservationRecord = { bytes: payloadUtf8Bytes, released: false };
    slot.reservations.add(record);
    return {
      release: () => {
        if (record.released) return;
        record.released = true;
        slot!.reservations.delete(record);
        slot!.payloadUtf8Bytes = Math.max(0, slot!.payloadUtf8Bytes - record.bytes);
        this.totalPayloadUtf8Bytes = Math.max(0, this.totalPayloadUtf8Bytes - record.bytes);
        this.releaseSlot(key, slot!);
      },
      replace: (replacement) => {
        if (record.released) return false;
        const replacementBytes = measurePayloads(
          replacement,
          this.limits.maxPayloadUtf8BytesPerOperation,
        );
        if (
          replacementBytes === null ||
          slot!.payloadUtf8Bytes - record.bytes + replacementBytes >
            this.limits.maxPayloadUtf8BytesPerKey ||
          this.totalPayloadUtf8Bytes - record.bytes + replacementBytes >
            this.limits.maxPayloadUtf8BytesTotal
        ) {
          return false;
        }
        slot!.payloadUtf8Bytes += replacementBytes - record.bytes;
        this.totalPayloadUtf8Bytes += replacementBytes - record.bytes;
        record.bytes = replacementBytes;
        return true;
      },
    };
  }

  clear(): void {
    this.epoch += 1;
    this.projection.current = {};
    for (const [key, slot] of this.slots) {
      for (const reservation of slot.reservations) {
        reservation.released = true;
        slot.payloadUtf8Bytes = Math.max(0, slot.payloadUtf8Bytes - reservation.bytes);
        this.totalPayloadUtf8Bytes = Math.max(0, this.totalPayloadUtf8Bytes - reservation.bytes);
      }
      slot.reservations.clear();
      if (slot.active) {
        settleTask(slot.active);
      }
      for (const task of slot.queued.splice(0)) {
        settleTask(task);
        this.releaseTask(slot, task);
        task.settleCompletion();
      }
      if (slot.active) {
        this.projection.current[key] = slot.active.completion;
      } else {
        this.releaseSlot(key, slot);
      }
    }
  }

  private startNext(key: string, slot: QueueSlot): void {
    if (slot.active) {
      return;
    }
    const task = slot.queued.shift();
    if (!task) {
      this.releaseSlot(key, slot);
      return;
    }
    if (task.epoch !== this.epoch) {
      settleTask(task);
      this.releaseTask(slot, task);
      task.settleCompletion();
      this.startNext(key, slot);
      return;
    }

    slot.active = task;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => rejectTask(task, "Document sync queue operation exceeded its deadline."),
      this.limits.operationTimeoutMs,
    );
    const finish = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (slot.active !== task) {
        return;
      }
      slot.active = null;
      this.releaseTask(slot, task);
      task.settleCompletion();
      this.startNext(key, slot);
    };
    let settlement: Promise<void>;
    try {
      settlement = task.operation();
    } catch (error) {
      settlement = Promise.reject(error);
    }
    void settlement.then(
      () => {
        settleTask(task);
        finish();
      },
      (error: unknown) => {
        rejectTask(
          task,
          error instanceof Error ? error.message : "Document sync queue operation failed.",
        );
        finish();
      },
    );
  }

  private releaseTask(slot: QueueSlot, task: QueueTask): void {
    slot.payloadUtf8Bytes = Math.max(0, slot.payloadUtf8Bytes - task.payloadUtf8Bytes);
    this.totalPayloadUtf8Bytes = Math.max(0, this.totalPayloadUtf8Bytes - task.payloadUtf8Bytes);
  }

  private releaseSlot(key: string, slot: QueueSlot): void {
    if (
      slot.active ||
      slot.queued.length > 0 ||
      slot.reservations.size > 0 ||
      this.slots.get(key) !== slot
    ) {
      return;
    }
    this.slots.delete(key);
    this.totalKeyUtf8Bytes = Math.max(0, this.totalKeyUtf8Bytes - slot.keyUtf8Bytes);
    delete this.projection.current[key];
  }

  private createSlot(key: string): QueueSlot | null {
    if (this.slots.size >= this.limits.maxKeys) {
      return null;
    }
    const keyLength = boundedUtf8Length(key, this.limits.maxKeyUtf8Bytes);
    if (
      keyLength.status !== "within-limit" ||
      this.totalKeyUtf8Bytes + keyLength.bytes > this.limits.maxTotalKeyUtf8Bytes
    ) {
      return null;
    }
    const slot: QueueSlot = {
      active: null,
      keyUtf8Bytes: keyLength.bytes,
      payloadUtf8Bytes: 0,
      queued: [],
      reservations: new Set(),
    };
    this.slots.set(key, slot);
    this.totalKeyUtf8Bytes += keyLength.bytes;
    return slot;
  }
}

function createTask(
  epoch: number,
  operation: () => Promise<void>,
  payloadUtf8Bytes: number,
): QueueTask {
  let reject!: (error: Error) => void;
  let resolve!: () => void;
  let settleCompletion!: () => void;
  const outward = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  // Operations start synchronously during enqueue and may trigger a reentrant
  // reset before enqueue returns to its caller. Install the internal observer
  // before that can happen; callers still receive the original rejecting
  // promise and can observe the retirement themselves.
  void outward.catch(() => undefined);
  const completion = new Promise<void>((settle) => {
    settleCompletion = settle;
  });
  return {
    completion,
    epoch,
    operation,
    outward,
    outwardSettled: false,
    payloadUtf8Bytes,
    reject,
    resolve,
    settleCompletion,
  };
}

function observableRejection(task: QueueTask): Promise<void> {
  return task.outward;
}

function settleTask(task: QueueTask): void {
  if (task.outwardSettled) return;
  task.outwardSettled = true;
  task.resolve();
}

function rejectTask(task: QueueTask, message: string): void {
  if (task.outwardSettled) return;
  task.outwardSettled = true;
  task.reject(new Error(message));
}

function measurePayloads(payloads: readonly string[], limit: number): number | null {
  let total = 0;
  for (const payload of payloads) {
    const receipt = boundedUtf8Length(payload, limit - total);
    if (receipt.status !== "within-limit") {
      return null;
    }
    total += receipt.bytes;
  }
  return total;
}

function normalizeLimits(
  limits: Partial<BoundedDocumentSyncQueueLimits>,
): BoundedDocumentSyncQueueLimits {
  return {
    maxKeyUtf8Bytes: positiveLimit(limits.maxKeyUtf8Bytes, DEFAULT_LIMITS.maxKeyUtf8Bytes),
    maxKeys: positiveLimit(limits.maxKeys, DEFAULT_LIMITS.maxKeys),
    maxPayloadUtf8BytesPerKey: positiveLimit(
      limits.maxPayloadUtf8BytesPerKey,
      DEFAULT_LIMITS.maxPayloadUtf8BytesPerKey,
    ),
    maxPayloadUtf8BytesPerOperation: positiveLimit(
      limits.maxPayloadUtf8BytesPerOperation,
      DEFAULT_LIMITS.maxPayloadUtf8BytesPerOperation,
    ),
    maxPayloadUtf8BytesTotal: positiveLimit(
      limits.maxPayloadUtf8BytesTotal,
      DEFAULT_LIMITS.maxPayloadUtf8BytesTotal,
    ),
    maxQueuedPerKey: positiveLimit(limits.maxQueuedPerKey, DEFAULT_LIMITS.maxQueuedPerKey),
    maxTotalKeyUtf8Bytes: positiveLimit(
      limits.maxTotalKeyUtf8Bytes,
      DEFAULT_LIMITS.maxTotalKeyUtf8Bytes,
    ),
    operationTimeoutMs: positiveLimit(limits.operationTimeoutMs, DEFAULT_LIMITS.operationTimeoutMs),
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function capacityRejection(): Promise<never> {
  const rejection = Promise.reject(new Error("Document sync queue capacity exceeded."));
  void rejection.catch(() => undefined);
  return rejection;
}
