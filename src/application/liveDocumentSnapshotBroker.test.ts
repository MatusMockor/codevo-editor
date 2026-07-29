import { describe, expect, it } from "vitest";
import type {
  LiveDocumentAuthority,
  LiveDocumentContentChangeEvent,
} from "../domain/liveDocumentContentAuthority";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import {
  HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
  type LiveDocumentSnapshotPurposeLimits,
} from "../domain/liveDocumentSnapshot";
import {
  LiveDocumentContentCoordinator,
  type LiveContentReservation,
} from "./liveDocumentContentCoordinator";
import {
  DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS,
  HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS,
  LiveDocumentSnapshotBroker,
  type LiveDocumentSnapshot,
  type LiveDocumentSnapshotBrokerLimits,
  type LiveDocumentSnapshotSourceRegistration,
} from "./liveDocumentSnapshotBroker";
import type {
  LiveDocumentSnapshotReadExpectation,
  LiveDocumentSnapshotSourcePort,
  LiveDocumentSnapshotSourceProbe,
  LiveDocumentSnapshotSourceRead,
} from "./liveDocumentSnapshotSourcePort";

const OWNER = Object.freeze({});
const ROOT = "/workspace";

function authority(
  identity = "inode:1",
  overrides: Partial<LiveDocumentAuthority> = {},
): LiveDocumentAuthority {
  return {
    canonicalRoot: ROOT,
    documentIdentityKey: identity,
    documentIncarnation: Object.freeze({}),
    modelId: `file://${ROOT}/${identity}.ts`,
    modelIncarnation: Object.freeze({}),
    ownerGeneration: 1,
    ownerIncarnation: OWNER,
    ownerKey: "workspace-owner",
    path: `${ROOT}/${identity}.ts`,
    ...overrides,
  };
}

class FakeSnapshotSource implements LiveDocumentSnapshotSourcePort {
  private alternativeVersionId = 1;
  private currentModelAuthority: object;
  private currentSourceAuthority = Object.freeze({});
  private modelVersionId = 1;
  onModelAuthorityGet: (() => void) | null = null;
  onProbe: (() => void) | null = null;
  onRead: (() => void) | null = null;
  probeCount = 0;
  probeUnknownField: "non-enumerable" | "symbol" | null = null;
  readCount = 0;
  readUnknownField: "non-enumerable" | "symbol" | null = null;
  throwModelAuthorityGetter = false;
  throwProbeDtoOwnKeys = false;
  throwReadDtoOwnKeys = false;
  throwSourceAuthorityGetter = false;
  throwOnProbe = false;
  throwOnRead = false;
  unavailable = false;

  constructor(
    modelAuthority: object,
    private text: string,
  ) {
    this.currentModelAuthority = modelAuthority;
  }

  get modelAuthority(): object {
    if (this.throwModelAuthorityGetter) throw new Error("model authority failed");
    const callback = this.onModelAuthorityGet;
    this.onModelAuthorityGet = null;
    callback?.();
    return this.currentModelAuthority;
  }

  get sourceAuthority(): object {
    if (this.throwSourceAuthorityGetter) throw new Error("source authority failed");
    return this.currentSourceAuthority;
  }

  probe(): LiveDocumentSnapshotSourceProbe {
    this.probeCount += 1;
    if (this.throwOnProbe) {
      this.throwOnProbe = false;
      throw new Error("model probe failed");
    }
    const result: LiveDocumentSnapshotSourceProbe = this.unavailable
      ? { status: "unavailable" }
      : {
          alternativeVersionId: this.alternativeVersionId,
          modelVersionId: this.modelVersionId,
          status: "available",
          utf16Length: this.text.length,
        };
    const callback = this.onProbe;
    this.onProbe = null;
    callback?.();
    if (this.probeUnknownField) addUnknownOwnField(result, this.probeUnknownField);
    return this.throwProbeDtoOwnKeys
      ? (new Proxy(result, {
          ownKeys: () => {
            throw new Error("probe keys failed");
          },
        }) as LiveDocumentSnapshotSourceProbe)
      : result;
  }

  readFullText(expectation: LiveDocumentSnapshotReadExpectation): LiveDocumentSnapshotSourceRead {
    this.readCount += 1;
    if (this.throwOnRead) {
      this.throwOnRead = false;
      throw new Error("model read failed");
    }
    const result = {
      alternativeVersionId: this.alternativeVersionId,
      modelAuthority: this.modelAuthority,
      modelVersionId: this.modelVersionId,
      sourceAuthority: this.sourceAuthority,
      text: this.text,
      utf16Length: this.text.length,
    };
    expect(expectation).toMatchObject({
      alternativeVersionId: result.alternativeVersionId,
      modelAuthority: result.modelAuthority,
      modelVersionId: result.modelVersionId,
      sourceAuthority: result.sourceAuthority,
      utf16Length: result.utf16Length,
    });
    const callback = this.onRead;
    this.onRead = null;
    callback?.();
    if (this.readUnknownField) addUnknownOwnField(result, this.readUnknownField);
    return this.throwReadDtoOwnKeys
      ? (new Proxy(result, {
          ownKeys: () => {
            throw new Error("read keys failed");
          },
        }) as LiveDocumentSnapshotSourceRead)
      : result;
  }

  append(value = "x"): void {
    this.text += value;
    this.modelVersionId += 1;
    this.alternativeVersionId += 1;
  }

  replaceModelAuthority(): void {
    this.currentModelAuthority = Object.freeze({});
  }
}

function addUnknownOwnField(value: object, kind: "non-enumerable" | "symbol"): void {
  Object.defineProperty(value, kind === "symbol" ? Symbol("unexpected") : "unexpected", {
    configurable: true,
    enumerable: false,
    value: true,
  });
}

interface Harness {
  readonly broker: LiveDocumentSnapshotBroker;
  readonly coordinator: LiveDocumentContentCoordinator;
  readonly lease: LiveContentReservation;
  readonly registration: LiveDocumentSnapshotSourceRegistration;
  readonly source: FakeSnapshotSource;
}

function harness(
  content = "abc",
  exactAuthority = authority(),
  brokerLimits?: LiveDocumentSnapshotBrokerLimits,
): Harness {
  const coordinator = new LiveDocumentContentCoordinator();
  const reserved = coordinator.reserveLiveContent(
    exactAuthority,
    {
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: content.length,
      utf8Bytes: content.length,
    },
    Object.freeze({}),
  );
  if (reserved.status !== "reserved") throw new Error("reservation failed");
  const broker = new LiveDocumentSnapshotBroker(coordinator, brokerLimits);
  const source = new FakeSnapshotSource(exactAuthority.modelIncarnation, content);
  const registered = broker.registerSource(reserved.lease, source);
  if (registered.status !== "registered") throw new Error("source registration failed");
  return {
    broker,
    coordinator,
    lease: reserved.lease,
    registration: registered.registration,
    source,
  };
}

function addLiveDocument(
  coordinator: LiveDocumentContentCoordinator,
  broker: LiveDocumentSnapshotBroker,
  identity: string,
  content = "abc",
  exactAuthority = authority(identity),
): { readonly lease: LiveContentReservation; readonly source: FakeSnapshotSource } {
  const reserved = coordinator.reserveLiveContent(
    exactAuthority,
    {
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: content.length,
      utf8Bytes: content.length,
    },
    Object.freeze({}),
  );
  if (reserved.status !== "reserved") throw new Error("reserve");
  const source = new FakeSnapshotSource(exactAuthority.modelIncarnation, content);
  expect(broker.registerSource(reserved.lease, source).status).toBe("registered");
  source.append();
  expect(
    coordinator.recordLiveChange(
      reserved.lease,
      changeEvent(2, 2, content.length, content.length + 1, "x"),
    ).status,
  ).toBe("committed");
  return { lease: reserved.lease, source };
}

function appendLiveDocument(
  coordinator: LiveDocumentContentCoordinator,
  lease: LiveContentReservation,
  source: FakeSnapshotSource,
): void {
  const before = source.probe();
  source.append();
  const after = source.probe();
  if (before.status !== "available" || after.status !== "available") throw new Error("probe");
  expect(
    coordinator.recordLiveChange(
      lease,
      changeEvent(
        after.modelVersionId,
        after.alternativeVersionId,
        before.utf16Length,
        after.utf16Length,
        "x",
      ),
    ).status,
  ).toBe("committed");
}

function append(harness: Harness, value = "x"): void {
  const beforeLength = harness.source.probe();
  if (beforeLength.status !== "available") throw new Error("source unavailable");
  harness.source.append(value);
  const after = harness.source.probe();
  if (after.status !== "available") throw new Error("source unavailable");
  const result = harness.coordinator.recordLiveChange(
    harness.lease,
    changeEvent(
      after.modelVersionId,
      after.alternativeVersionId,
      beforeLength.utf16Length,
      after.utf16Length,
      value,
    ),
  );
  expect(result.status).toBe("committed");
}

function changeEvent(
  modelVersionId: number,
  alternativeVersionId: number,
  previousLength: number,
  postUtf16Length: number,
  text: string,
  overrides: Partial<LiveDocumentContentChangeEvent> = {},
): LiveDocumentContentChangeEvent {
  return {
    alternativeVersionId,
    changes: [
      {
        range: {
          endColumn: 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        },
        rangeLength: 0,
        rangeOffset: previousLength,
        text,
      },
    ],
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    modelVersionId,
    postUtf16Length,
    ...overrides,
  };
}

function captured(harness: Harness, purpose: "change-hunks" | "dirty-search" | "save" = "save") {
  const result = harness.broker.capture(harness.lease, purpose);
  if (result.status !== "captured") throw new Error(`capture failed: ${result.reason}`);
  return result.snapshot;
}

function lowerLimits(
  overrides: Partial<LiveDocumentSnapshotBrokerLimits> = {},
  purpose: Partial<LiveDocumentSnapshotPurposeLimits> = {},
): LiveDocumentSnapshotBrokerLimits {
  return {
    ...DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS,
    ...overrides,
    purpose: {
      ...HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
      ...purpose,
    },
  };
}

describe("LiveDocumentSnapshotBroker", () => {
  it("does zero full reads for 100 edits of a 1 MiB model, then exactly one on demand", () => {
    const subject = harness("a".repeat(1024 * 1024));
    for (let index = 0; index < 100; index += 1) append(subject);
    expect(subject.source.readCount).toBe(0);

    const snapshot = captured(subject);

    expect(subject.source.readCount).toBe(1);
    expect(snapshot.content).toHaveLength(1024 * 1024 + 100);
    expect(subject.broker.consumeCurrent(snapshot)).toBe(true);
  });

  it("rejects a purpose overflow before the only full-read operation", () => {
    const content = "a".repeat(256 * 1024);
    const subject = harness(content);
    append(subject);

    expect(subject.broker.capture(subject.lease, "dirty-search")).toEqual({
      reason: "document-too-large",
      status: "rejected",
    });
    expect(subject.source.readCount).toBe(0);
  });

  it("captures an exact 10 Mi UTF-16 save snapshot with one bounded full read", () => {
    const subject = harness(
      "a".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS - 1),
      authority("inode:exact-save-limit"),
    );
    append(subject);

    const result = subject.broker.capture(subject.lease, "save");

    expect(result.status).toBe("captured");
    if (result.status !== "captured") return;
    expect(result.snapshot.utf16Length).toBe(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(result.snapshot.content).toHaveLength(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(subject.source.readCount).toBe(1);
    expect(subject.broker.release(result.snapshot)).toBe(true);
  });

  it("rejects a save above 10 Mi UTF-16 before a full read", () => {
    const subject = harness(
      "a".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS),
      authority("inode:above-save-limit"),
    );
    append(subject);

    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "document-too-large",
      status: "rejected",
    });
    expect(subject.source.readCount).toBe(0);
  });

  it("captures both incremental and snapshot-required live states", () => {
    const incremental = harness();
    append(incremental);
    const incrementalSnapshot = captured(incremental);
    expect(incremental.broker.consumeCurrent(incrementalSnapshot)).toBe(true);

    const degraded = harness("abc", authority("inode:flush"));
    const before = degraded.source.probe();
    degraded.source.append();
    const after = degraded.source.probe();
    if (before.status !== "available" || after.status !== "available") throw new Error("probe");
    expect(
      degraded.coordinator.recordLiveChange(
        degraded.lease,
        changeEvent(
          after.modelVersionId,
          after.alternativeVersionId,
          before.utf16Length,
          after.utf16Length,
          "x",
          { isFlush: true },
        ),
      ),
    ).toMatchObject({ mode: "snapshot-required", status: "committed" });
    const degradedSnapshot = captured(degraded);
    expect(degraded.broker.consumeCurrent(degradedSnapshot)).toBe(true);
  });

  it("drops a capture when a reentrant edit happens inside the atomic source read", () => {
    const subject = harness();
    append(subject);
    subject.source.onRead = () => append(subject);

    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(subject.source.readCount).toBe(1);
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
  });

  it("keeps source settlement locked across a rejected reentrant settlement", () => {
    const subject = harness();
    append(subject);
    let nestedSettlement = true;

    expect(
      subject.broker.settleSourceRelease(subject.registration, () => {
        nestedSettlement = subject.broker.settleSourceRelease(subject.registration, () => true);
        expect(subject.broker.capture(subject.lease, "save")).toEqual({
          reason: "capture-in-flight",
          status: "rejected",
        });
        return false;
      }),
    ).toBe(false);
    expect(nestedSettlement).toBe(false);
    expect(subject.broker.registeredSourceCount()).toBe(1);
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
  });

  it("retains an exact source when its settlement callback throws", () => {
    const subject = harness();
    append(subject);

    expect(
      subject.broker.settleSourceRelease(subject.registration, () => {
        throw new Error("settlement failed");
      }),
    ).toBe(false);
    expect(subject.broker.registeredSourceCount()).toBe(1);
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
  });

  it("honors a reentrant abort from the cached-payload probe without retaining capacity", () => {
    const subject = harness();
    append(subject);
    const retained = captured(subject);
    const retainedUtf16Units = retained.utf16Length;
    const controller = new AbortController();
    subject.source.onProbe = () => controller.abort();

    expect(subject.broker.capture(subject.lease, "save", controller.signal)).toEqual({
      reason: "aborted",
      status: "rejected",
    });
    expect(subject.broker.outstandingSnapshotCount()).toBe(1);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(retainedUtf16Units);
    expect(subject.source.readCount).toBe(1);

    expect(subject.broker.release(retained)).toBe(true);
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(0);
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    expect(subject.source.readCount).toBe(2);
  });

  it("honors a reentrant abort from the post-read probe and recovers all capacity", () => {
    const subject = harness();
    append(subject);
    const controller = new AbortController();
    subject.source.onRead = () => {
      subject.source.onProbe = () => controller.abort();
    };

    expect(subject.broker.capture(subject.lease, "save", controller.signal)).toEqual({
      reason: "aborted",
      status: "rejected",
    });
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(0);
    expect(subject.source.readCount).toBe(1);

    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    expect(subject.broker.outstandingSnapshotCount()).toBe(1);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(4);
    expect(subject.source.readCount).toBe(2);
  });

  it("drops a capture across reentrant discard and same-key A-B-A replacement", () => {
    const firstAuthority = authority("inode:aba");
    const subject = harness("abc", firstAuthority);
    append(subject);
    let replacementLease: LiveContentReservation | null = null;
    subject.source.onRead = () => {
      const prepared = subject.coordinator.prepareSettlement(subject.lease, { kind: "discard" });
      if (prepared.status !== "prepared") throw new Error("settlement failed");
      expect(subject.coordinator.commitSettlement(prepared.permit)).toBe(true);
      const nextAuthority = authority("inode:aba", {
        documentIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
        ownerGeneration: 2,
        ownerIncarnation: Object.freeze({}),
      });
      const replacement = subject.coordinator.reserveLiveContent(
        nextAuthority,
        {
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 3,
          utf8Bytes: 3,
        },
        Object.freeze({}),
      );
      if (replacement.status !== "reserved") throw new Error("replacement failed");
      replacementLease = replacement.lease;
    };

    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(replacementLease).not.toBeNull();
    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
  });

  it("contains source throws, clears in-flight state, and permits a later capture", () => {
    const subject = harness();
    append(subject);
    subject.source.throwOnRead = true;
    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "source-failed",
      status: "rejected",
    });

    expect(captured(subject).content).toBe("abcx");
    expect(subject.source.readCount).toBe(2);
  });

  it.each(["model-authority", "source-authority", "probe-dto", "read-dto"] as const)(
    "contains throwing %s getters and releases provisional capacity",
    (failure) => {
      const subject = harness(
        "abc",
        authority(`inode:getter-${failure}`),
        lowerLimits(
          {
            maxBatchSnapshots: 1,
            maxOutstandingSnapshots: 1,
            maxOutstandingUtf16Units: 4,
          },
          { saveMaxUtf16Units: 4 },
        ),
      );
      append(subject);
      if (failure === "model-authority") subject.source.throwModelAuthorityGetter = true;
      if (failure === "source-authority") subject.source.throwSourceAuthorityGetter = true;
      if (failure === "probe-dto") subject.source.throwProbeDtoOwnKeys = true;
      if (failure === "read-dto") subject.source.throwReadDtoOwnKeys = true;

      expect(subject.broker.capture(subject.lease, "save")).toEqual({
        reason: "source-failed",
        status: "rejected",
      });
      expect(subject.broker.outstandingSnapshotCount()).toBe(0);
      expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(0);

      subject.source.throwModelAuthorityGetter = false;
      subject.source.throwSourceAuthorityGetter = false;
      subject.source.throwProbeDtoOwnKeys = false;
      subject.source.throwReadDtoOwnKeys = false;
      expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    },
  );

  it.each([
    ["probe", "symbol"],
    ["probe", "non-enumerable"],
    ["read", "symbol"],
    ["read", "non-enumerable"],
  ] as const)("rejects a %s DTO with an unknown %s own field", (boundary, fieldKind) => {
    const subject = harness();
    append(subject);
    if (boundary === "probe") subject.source.probeUnknownField = fieldKind;
    else subject.source.readUnknownField = fieldKind;

    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "source-failed",
      status: "rejected",
    });
    expect(subject.source.readCount).toBe(boundary === "probe" ? 0 : 1);
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(0);

    subject.source.probeUnknownField = null;
    subject.source.readUnknownField = null;
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
  });

  it("contains a throwing source identity getter during registration", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const exactAuthority = authority("inode:register-getter");
    const reserved = coordinator.reserveLiveContent(
      exactAuthority,
      {
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 3,
        utf8Bytes: 3,
      },
      Object.freeze({}),
    );
    if (reserved.status !== "reserved") throw new Error("reserve");
    const source = new FakeSnapshotSource(exactAuthority.modelIncarnation, "abc");
    source.throwSourceAuthorityGetter = true;
    expect(broker.registerSource(reserved.lease, source)).toEqual({
      reason: "source-failed",
      status: "rejected",
    });
    expect(broker.registeredSourceCount()).toBe(0);
  });

  it("rejects registration when a descriptor getter replaces the coordinator channel", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const exactAuthority = authority("inode:register-getter-aba");
    const reserved = coordinator.reserveLiveContent(
      exactAuthority,
      {
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 3,
        utf8Bytes: 3,
      },
      Object.freeze({}),
    );
    if (reserved.status !== "reserved") throw new Error("reserve");
    const source = new FakeSnapshotSource(exactAuthority.modelIncarnation, "abc");
    source.onModelAuthorityGet = () => {
      const prepared = coordinator.prepareSettlement(reserved.lease, { kind: "discard" });
      if (prepared.status !== "prepared") throw new Error("prepare");
      expect(coordinator.commitSettlement(prepared.permit)).toBe(true);
      const replacement = coordinator.reserveLiveContent(
        authority("inode:register-getter-aba", {
          documentIncarnation: Object.freeze({}),
          modelIncarnation: Object.freeze({}),
          ownerGeneration: 2,
          ownerIncarnation: Object.freeze({}),
        }),
        {
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 3,
          utf8Bytes: 3,
        },
        Object.freeze({}),
      );
      expect(replacement.status).toBe("reserved");
    };

    expect(broker.registerSource(reserved.lease, source)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(broker.registeredSourceCount()).toBe(0);
  });

  it("contains coordinator and probe failures during destructive confirmation", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    let throwInspect = false;
    const broker = new LiveDocumentSnapshotBroker({
      inspect: (lease) => {
        if (throwInspect) throw new Error("inspection failed");
        return coordinator.inspect(lease);
      },
    });
    const document = addLiveDocument(coordinator, broker, "inode:throwing-confirm");
    const capture = broker.capture(document.lease, "save");
    if (capture.status !== "captured") throw new Error(capture.reason);
    throwInspect = true;
    expect(broker.consumeCurrent(capture.snapshot)).toBe(false);
    expect(broker.outstandingSnapshotCount()).toBe(0);

    throwInspect = false;
    const next = broker.capture(document.lease, "save");
    if (next.status !== "captured") throw new Error(next.reason);
    document.source.throwOnProbe = true;
    expect(broker.consumeCurrent(next.snapshot)).toBe(false);
    expect(broker.outstandingSnapshotCount()).toBe(0);
  });

  it("fails closed for aborts, unavailable sources, and model authority replacement", () => {
    const subject = harness();
    append(subject);
    const controller = new AbortController();
    controller.abort();
    expect(subject.broker.capture(subject.lease, "save", controller.signal)).toEqual({
      reason: "aborted",
      status: "rejected",
    });
    expect(subject.source.readCount).toBe(0);

    subject.source.unavailable = true;
    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "source-unavailable",
      status: "rejected",
    });
    subject.source.unavailable = false;
    subject.source.replaceModelAuthority();
    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
  });

  it.each([1, 2, 4])(
    "shares one exact source and one payload across %i holder consumers",
    (holderCount) => {
      const content = "a".repeat(1024 * 1024);
      const exactAuthority = authority(`inode:holders-${holderCount}`);
      const subject = harness(content, exactAuthority);
      append(subject);
      const leases = [subject.lease];
      const registrations = [subject.broker.registerSource(subject.lease, subject.source)];
      for (let index = 1; index < holderCount; index += 1) {
        const joined = subject.coordinator.reserveLiveContent(
          exactAuthority,
          {
            alternativeVersionId: 1,
            contentVersion: 1,
            modelVersionId: 1,
            utf16Length: content.length,
            utf8Bytes: content.length,
          },
          Object.freeze({}),
        );
        if (joined.status !== "reserved") throw new Error("join failed");
        leases.push(joined.lease);
        registrations.push(subject.broker.registerSource(joined.lease, subject.source));
      }
      expect(registrations.every((receipt) => receipt.status === "registered")).toBe(true);
      const snapshots = leases.map((lease) => {
        const receipt = subject.broker.capture(lease, "save");
        if (receipt.status !== "captured") throw new Error(receipt.reason);
        return receipt.snapshot;
      });
      expect(subject.source.readCount).toBe(1);
      expect(subject.broker.registeredSourceCount()).toBe(1);
      expect(subject.broker.outstandingSnapshotCount()).toBe(holderCount);
      expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(content.length + 1);

      registrations.forEach((receipt, index) => {
        if (receipt.status !== "registered") throw new Error("registration failed");
        expect(subject.broker.releaseSource(receipt.registration)).toBe(true);
        expect(subject.broker.outstandingSnapshotCount()).toBe(holderCount - index - 1);
      });
      expect(subject.broker.registeredSourceCount()).toBe(0);
      expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(0);
      snapshots.forEach((snapshot) => expect(subject.broker.release(snapshot)).toBe(false));
    },
  );

  it("invalidates ingress-owned snapshots after exact ingress transfer", () => {
    const exactAuthority = authority("inode:transfer");
    const subject = harness("abc", exactAuthority);
    const joined = subject.coordinator.reserveLiveContent(
      exactAuthority,
      {
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 3,
        utf8Bytes: 3,
      },
      Object.freeze({}),
    );
    if (joined.status !== "reserved") throw new Error("join failed");
    expect(subject.broker.registerSource(joined.lease, subject.source).status).toBe("registered");
    append(subject);
    const oldSnapshot = captured(subject);
    const released = subject.coordinator.releaseLiveContentHolder(subject.lease);
    expect(released.status).toBe("released");
    expect(subject.broker.consumeCurrent(oldSnapshot)).toBe(false);

    const current = subject.broker.capture(joined.lease, "save");
    expect(current.status).toBe("captured");
  });

  it("uses single-use object identity for consume and release", () => {
    const subject = harness();
    append(subject);
    const snapshot = captured(subject);
    const copied = { ...snapshot };
    expect(subject.broker.consumeCurrent(copied)).toBe(false);
    expect(subject.broker.release(copied)).toBe(false);
    expect(subject.broker.consumeCurrent(snapshot)).toBe(true);
    expect(subject.broker.consumeCurrent(snapshot)).toBe(false);
    expect(subject.broker.release(snapshot)).toBe(false);
  });

  it("rejects copied reservations and a different source for the shared reservation", () => {
    const subject = harness();
    const foreignLease = { ...subject.lease };
    expect(subject.broker.capture(foreignLease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
    const foreignSource = new FakeSnapshotSource(subject.lease.authority.modelIncarnation, "abc");
    expect(subject.broker.registerSource(subject.lease, foreignSource)).toEqual({
      reason: "source-mismatch",
      status: "rejected",
    });
  });

  it("batch-validates every lease and leaves a stale-last batch wholly retained", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const first = addLiveDocument(coordinator, broker, "inode:batch-a");
    const second = addLiveDocument(coordinator, broker, "inode:batch-b", "def");
    const firstCapture = broker.capture(first.lease, "dirty-search");
    const secondCapture = broker.capture(second.lease, "dirty-search");
    if (firstCapture.status !== "captured" || secondCapture.status !== "captured") {
      throw new Error("capture");
    }
    const firstSnapshot = firstCapture.snapshot;
    const secondSnapshot = secondCapture.snapshot;
    const before = second.source.probe();
    second.source.append();
    const after = second.source.probe();
    if (before.status !== "available" || after.status !== "available") throw new Error("probe");
    expect(
      coordinator.recordLiveChange(
        second.lease,
        changeEvent(
          after.modelVersionId,
          after.alternativeVersionId,
          before.utf16Length,
          after.utf16Length,
          "x",
        ),
      ).status,
    ).toBe("committed");

    expect(broker.consumeCurrentBatch([firstSnapshot, secondSnapshot])).toBe(false);
    expect(broker.outstandingSnapshotCount()).toBe(2);
    expect(broker.release(firstSnapshot)).toBe(true);
    expect(broker.release(secondSnapshot)).toBe(true);
  });

  it("atomically consumes a same-owner batch and rejects duplicates without partial release", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const snapshots: LiveDocumentSnapshot[] = [];
    const sources: FakeSnapshotSource[] = [];
    for (const identity of ["inode:one", "inode:two"]) {
      const document = addLiveDocument(coordinator, broker, identity);
      sources.push(document.source);
      const result = broker.capture(document.lease, "dirty-search");
      if (result.status !== "captured") throw new Error(result.reason);
      snapshots.push(result.snapshot);
    }

    expect(broker.consumeCurrentBatch([snapshots[0]!, snapshots[0]!])).toBe(false);
    expect(broker.outstandingSnapshotCount()).toBe(2);
    sources[1]!.onProbe = () => {
      expect(broker.release(snapshots[0]!)).toBe(false);
      expect(broker.consumeCurrent(snapshots[0]!)).toBe(false);
    };
    expect(broker.consumeCurrentBatch(snapshots)).toBe(true);
    expect(broker.outstandingSnapshotCount()).toBe(0);
  });

  it("revalidates all batch states after B's probe mutates already-validated A", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const first = addLiveDocument(coordinator, broker, "inode:batch-race-a");
    const second = addLiveDocument(coordinator, broker, "inode:batch-race-b");
    const firstCapture = broker.capture(first.lease, "dirty-search");
    const secondCapture = broker.capture(second.lease, "dirty-search");
    if (firstCapture.status !== "captured" || secondCapture.status !== "captured") {
      throw new Error("capture");
    }
    second.source.onProbe = () => appendLiveDocument(coordinator, first.lease, first.source);

    expect(broker.consumeCurrentBatch([firstCapture.snapshot, secondCapture.snapshot])).toBe(false);
    expect(broker.outstandingSnapshotCount()).toBe(2);
    expect(broker.release(firstCapture.snapshot)).toBe(true);
    expect(broker.release(secondCapture.snapshot)).toBe(true);
  });

  it("rejects a mixed canonical-root batch even when the owner tuple matches", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const first = addLiveDocument(coordinator, broker, "inode:root-a");
    const secondAuthority = authority("inode:root-b", {
      canonicalRoot: "/other-canonical-root",
      modelId: "file:///other-canonical-root/b.ts",
      path: "/other-canonical-root/b.ts",
    });
    const second = addLiveDocument(coordinator, broker, "inode:root-b", "abc", secondAuthority);
    const firstCapture = broker.capture(first.lease, "dirty-search");
    const secondCapture = broker.capture(second.lease, "dirty-search");
    if (firstCapture.status !== "captured" || secondCapture.status !== "captured") {
      throw new Error("capture");
    }

    expect(broker.consumeCurrentBatch([firstCapture.snapshot, secondCapture.snapshot])).toBe(false);
    expect(broker.outstandingSnapshotCount()).toBe(2);
  });

  it("contains a probe that discards the coordinator channel before consume", () => {
    const subject = harness();
    append(subject);
    const snapshot = captured(subject);
    subject.source.onProbe = () => {
      const prepared = subject.coordinator.prepareSettlement(subject.lease, { kind: "discard" });
      if (prepared.status !== "prepared") throw new Error("prepare");
      subject.coordinator.commitSettlement(prepared.permit);
    };

    expect(subject.broker.consumeCurrent(snapshot)).toBe(false);
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
  });

  it("enforces outstanding count and aggregate capacity and recovers after release", () => {
    const subject = harness(
      "abc",
      authority("inode:capacity"),
      lowerLimits(
        {
          maxBatchSnapshots: 1,
          maxOutstandingSnapshots: 1,
          maxOutstandingUtf16Units: 4,
        },
        { saveMaxUtf16Units: 4 },
      ),
    );
    append(subject);
    const first = captured(subject);
    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "outstanding-limit",
      status: "rejected",
    });
    expect(subject.broker.release(first)).toBe(true);
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
  });

  it("admits one maximum save by default and recovers aggregate capacity after release", () => {
    expect(DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingUtf16Units).toBe(
      MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
    );
    expect(
      DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingUtf16Units,
    ).toBeLessThanOrEqual(HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingUtf16Units);

    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(coordinator);
    const maximum = addLiveDocument(
      coordinator,
      broker,
      "inode:default-aggregate-maximum",
      "a".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS - 1),
    );
    const retry = addLiveDocument(coordinator, broker, "inode:default-aggregate-retry", "");

    const retained = broker.capture(maximum.lease, "save");
    expect(retained.status).toBe("captured");
    if (retained.status !== "captured") return;
    expect(broker.outstandingSnapshotUtf16Units()).toBe(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);

    expect(broker.capture(retry.lease, "save")).toEqual({
      reason: "aggregate-limit",
      status: "rejected",
    });
    expect(retry.source.readCount).toBe(0);

    expect(broker.release(retained.snapshot)).toBe(true);
    expect(broker.outstandingSnapshotUtf16Units()).toBe(0);
    expect(broker.capture(retry.lease, "save").status).toBe("captured");
    expect(retry.source.readCount).toBe(1);
  });

  it("enforces aggregate payload capacity across independent documents", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(
      coordinator,
      lowerLimits(
        {
          maxOutstandingUtf16Units: 7,
        },
        {
          dirtySearchMaxUtf16Units: 4,
        },
      ),
    );
    const first = addLiveDocument(coordinator, broker, "inode:aggregate-a");
    const second = addLiveDocument(coordinator, broker, "inode:aggregate-b");
    expect(broker.capture(first.lease, "dirty-search").status).toBe("captured");
    expect(broker.capture(second.lease, "dirty-search")).toEqual({
      reason: "aggregate-limit",
      status: "rejected",
    });
    expect(first.source.readCount).toBe(1);
    expect(second.source.readCount).toBe(0);
  });

  it("provisionally reserves the only global slot before a nested source callback", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(
      coordinator,
      lowerLimits(
        {
          maxBatchSnapshots: 1,
          maxOutstandingSnapshots: 1,
          maxOutstandingUtf16Units: 4,
        },
        { saveMaxUtf16Units: 4 },
      ),
    );
    const first = addLiveDocument(coordinator, broker, "inode:nested-slot-a");
    const second = addLiveDocument(coordinator, broker, "inode:nested-slot-b");
    let nested: ReturnType<LiveDocumentSnapshotBroker["capture"]> | null = null;
    first.source.onProbe = () => {
      nested = broker.capture(second.lease, "save");
    };

    expect(broker.capture(first.lease, "save").status).toBe("captured");
    expect(nested).toEqual({ reason: "capture-in-flight", status: "rejected" });
    expect(first.source.readCount).toBe(1);
    expect(second.source.readCount).toBe(0);
    expect(broker.outstandingSnapshotCount()).toBe(1);
    expect(broker.outstandingSnapshotUtf16Units()).toBe(4);
  });

  it("blocks nested capture before source callbacks can compete for aggregate budget", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(
      coordinator,
      lowerLimits(
        {
          maxBatchSnapshots: 2,
          maxOutstandingSnapshots: 2,
          maxOutstandingUtf16Units: 7,
        },
        { saveMaxUtf16Units: 4 },
      ),
    );
    const first = addLiveDocument(coordinator, broker, "inode:nested-budget-a");
    const second = addLiveDocument(coordinator, broker, "inode:nested-budget-b");
    let nested: ReturnType<LiveDocumentSnapshotBroker["capture"]> | null = null;
    first.source.onProbe = () => {
      nested = broker.capture(second.lease, "save");
    };

    expect(broker.capture(first.lease, "save").status).toBe("captured");
    expect(nested).toEqual({ reason: "capture-in-flight", status: "rejected" });
    expect(first.source.readCount).toBe(1);
    expect(second.source.readCount).toBe(0);
    expect(broker.outstandingSnapshotUtf16Units()).toBe(4);
  });

  it("prunes probe-stale payload capacity before exact aggregate admission", () => {
    const subject = harness(
      "abc",
      authority("inode:probe-stale-capacity"),
      lowerLimits(
        {
          maxBatchSnapshots: 2,
          maxOutstandingSnapshots: 2,
          maxOutstandingUtf16Units: 5,
        },
        { saveMaxUtf16Units: 5 },
      ),
    );
    append(subject);
    const stale = captured(subject);
    subject.source.append();

    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(0);
    expect(subject.broker.release(stale)).toBe(false);

    expect(
      subject.coordinator.recordLiveChange(subject.lease, changeEvent(3, 3, 4, 5, "x")).status,
    ).toBe("committed");
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(5);
  });

  it("prunes a probe-stale snapshot before reserving the only count slot", () => {
    const subject = harness(
      "abc",
      authority("inode:probe-stale-count"),
      lowerLimits(
        {
          maxBatchSnapshots: 1,
          maxOutstandingSnapshots: 1,
          maxOutstandingUtf16Units: 5,
        },
        { saveMaxUtf16Units: 5 },
      ),
    );
    append(subject);
    const stale = captured(subject);
    subject.source.append();

    expect(subject.broker.capture(subject.lease, "save")).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(subject.broker.outstandingSnapshotCount()).toBe(0);
    expect(subject.broker.release(stale)).toBe(false);

    expect(
      subject.coordinator.recordLiveChange(subject.lease, changeEvent(3, 3, 4, 5, "x")).status,
    ).toBe("committed");
    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    expect(subject.broker.outstandingSnapshotCount()).toBe(1);
  });

  it("reuses a shared payload at the full aggregate limit with zero additional units", () => {
    const exactAuthority = authority("inode:reuse-full-aggregate");
    const subject = harness(
      "abc",
      exactAuthority,
      lowerLimits(
        {
          maxBatchSnapshots: 2,
          maxOutstandingSnapshots: 2,
          maxOutstandingUtf16Units: 4,
        },
        { saveMaxUtf16Units: 4 },
      ),
    );
    const joined = subject.coordinator.reserveLiveContent(
      exactAuthority,
      {
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 3,
        utf8Bytes: 3,
      },
      Object.freeze({}),
    );
    if (joined.status !== "reserved") throw new Error("join");
    expect(subject.broker.registerSource(joined.lease, subject.source).status).toBe("registered");
    append(subject);

    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(4);
    expect(subject.broker.capture(joined.lease, "save").status).toBe("captured");
    expect(subject.source.readCount).toBe(1);
    expect(subject.broker.outstandingSnapshotCount()).toBe(2);
    expect(subject.broker.outstandingSnapshotUtf16Units()).toBe(4);
  });

  it("prunes a discarded source channel before enforcing source capacity", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(
      coordinator,
      lowerLimits({ maxRegisteredSources: 1 }),
    );
    const firstAuthority = authority("inode:source-aba");
    const first = addLiveDocument(coordinator, broker, "inode:source-aba", "abc", firstAuthority);
    const prepared = coordinator.prepareSettlement(first.lease, { kind: "discard" });
    if (prepared.status !== "prepared") throw new Error("prepare");
    expect(coordinator.commitSettlement(prepared.permit)).toBe(true);

    const nextAuthority = authority("inode:source-aba", {
      documentIncarnation: Object.freeze({}),
      modelIncarnation: Object.freeze({}),
      ownerGeneration: 2,
      ownerIncarnation: Object.freeze({}),
    });
    const reserved = coordinator.reserveLiveContent(
      nextAuthority,
      {
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 3,
        utf8Bytes: 3,
      },
      Object.freeze({}),
    );
    if (reserved.status !== "reserved") throw new Error("reserve");
    const nextSource = new FakeSnapshotSource(nextAuthority.modelIncarnation, "abc");

    expect(broker.registerSource(reserved.lease, nextSource).status).toBe("registered");
    expect(broker.registeredSourceCount()).toBe(1);
  });

  it("prunes an edited stale lease before applying capacity to the next capture", () => {
    const subject = harness(
      "abc",
      authority("inode:stale-capacity"),
      lowerLimits(
        {
          maxBatchSnapshots: 1,
          maxOutstandingSnapshots: 1,
          maxOutstandingUtf16Units: 5,
        },
        { saveMaxUtf16Units: 5 },
      ),
    );
    append(subject);
    const stale = captured(subject);
    append(subject);

    expect(subject.broker.capture(subject.lease, "save").status).toBe("captured");
    expect(subject.broker.outstandingSnapshotCount()).toBe(1);
    expect(subject.broker.release(stale)).toBe(false);
  });

  it.each([
    ["maxBatchSnapshots", HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxBatchSnapshots],
    ["maxOutstandingSnapshots", HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingSnapshots],
    [
      "maxOutstandingUtf16Units",
      HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingUtf16Units,
    ],
    ["maxRegisteredSources", HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxRegisteredSources],
  ] as const)("rejects %s above its immutable hard ceiling", (key, hardLimit) => {
    const coordinator = new LiveDocumentContentCoordinator();
    expect(
      () =>
        new LiveDocumentSnapshotBroker(coordinator, {
          ...DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS,
          [key]: hardLimit + 1,
        }),
    ).toThrow(/hard bound/);
  });
});
