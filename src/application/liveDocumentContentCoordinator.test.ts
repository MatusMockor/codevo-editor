import { describe, expect, it } from "vitest";
import type {
  LiveDocumentAuthority,
  LiveDocumentContentChangeEvent,
} from "../domain/liveDocumentContentAuthority";
import {
  DEFAULT_LIVE_DOCUMENT_CONTENT_COORDINATOR_LIMITS,
  LiveDocumentContentCoordinator,
} from "./liveDocumentContentCoordinator";

const OWNER = {};
const DOCUMENT = {};
const MODEL = {};

function authority(overrides: Partial<LiveDocumentAuthority> = {}): LiveDocumentAuthority {
  return {
    canonicalRoot: "/workspace",
    documentIdentityKey: "inode:1",
    documentIncarnation: DOCUMENT,
    modelId: "file:///workspace/a.ts",
    modelIncarnation: MODEL,
    ownerGeneration: 1,
    ownerIncarnation: OWNER,
    ownerKey: "workspace-owner",
    path: "/workspace/a.ts",
    ...overrides,
  };
}

function changed(modelVersionId: number, currentLength: number): LiveDocumentContentChangeEvent {
  return {
    alternativeVersionId: modelVersionId,
    changes: [
      {
        range: {
          endColumn: 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        },
        rangeLength: 0,
        rangeOffset: currentLength,
        text: "x",
      },
    ],
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    modelVersionId,
    postUtf16Length: currentLength + 1,
  };
}

function reserve(
  coordinator: LiveDocumentContentCoordinator,
  exactAuthority = authority(),
  holderIdentity: object = {},
) {
  const result = coordinator.reserveLiveContent(
    exactAuthority,
    {
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 3,
      utf8Bytes: 3,
    },
    holderIdentity,
  );
  if (result.status !== "reserved") throw new Error("Expected reservation");
  return result;
}

describe("LiveDocumentContentCoordinator", () => {
  it("is idempotent per holder and admits one canonical ingress", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const holderA = {};
    const holderB = {};
    const first = reserve(coordinator, authority(), holderA);
    const duplicate = reserve(coordinator, authority(), holderA);
    const joined = reserve(coordinator, authority(), holderB);
    expect(first.role).toBe("ingress");
    expect(duplicate.lease).toBe(first.lease);
    expect(joined.role).toBe("joined");
    expect(coordinator.recordLiveChange(joined.lease, changed(2, 3))).toEqual({ status: "stale" });
    expect(coordinator.recordLiveChange(first.lease, changed(2, 3)).status).toBe("committed");
    expect(coordinator.inspect(first.lease)).toMatchObject({
      mutationCount: 1,
    });
  });

  it.each([1, 2, 4])("uses one bounded channel for %i holders", (count) => {
    const coordinator = new LiveDocumentContentCoordinator();
    const reservations = Array.from({ length: count }, () => reserve(coordinator));
    expect(
      new Set(reservations.map((reservation) => reservation.lease.reservationAuthority)).size,
    ).toBe(1);
    expect(coordinator.activeReservationCount()).toBe(1);
  });

  it.each([2, 4])("releases %i live holders with explicit ingress transfer", (count) => {
    const coordinator = new LiveDocumentContentCoordinator();
    const leases = Array.from({ length: count }, () => reserve(coordinator).lease);
    coordinator.recordLiveChange(leases[0]!, changed(2, 3));
    expect(coordinator.releaseLiveContentHolder(leases[0]!)).toMatchObject({
      promotedIngress: leases[1],
      status: "released",
    });
    for (const lease of leases.slice(1, -1)) {
      expect(coordinator.releaseLiveContentHolder(lease).status).toBe("released");
    }
    const finalLease = leases[count - 1]!;
    expect(coordinator.recordLiveChange(finalLease, changed(3, 4)).status).toBe("committed");
    expect(coordinator.releaseLiveContentHolder(finalLease)).toEqual({
      status: "blocked",
    });
    const prepared = coordinator.prepareSettlement(finalLease, {
      kind: "discard",
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status === "prepared") {
      expect(coordinator.commitSettlement(prepared.permit)).toBe(true);
    }
    expect(coordinator.inspect(finalLease)).toBeNull();
  });

  it("allows cancellation only before the first mutation", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const untouched = reserve(coordinator).lease;
    expect(coordinator.requestDispose(untouched)).toEqual({
      status: "allowed",
    });
    expect(coordinator.cancelLiveContent(untouched)).toBe(true);
    expect(coordinator.cancelLiveContent(untouched)).toBe(false);

    const live = reserve(coordinator).lease;
    coordinator.recordLiveChange(live, changed(2, 3));
    expect(coordinator.cancelLiveContent(live)).toBe(false);
    expect(coordinator.requestDispose(live)).toEqual({
      reason: "settlement-required",
      status: "blocked",
    });
  });

  it("makes discard permits exact and single-use", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const lease = reserve(coordinator).lease;
    coordinator.recordLiveChange(lease, changed(2, 3));
    const prepared = coordinator.prepareSettlement(lease, { kind: "discard" });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    expect(
      coordinator.reserveLiveContent(
        authority(),
        {
          alternativeVersionId: 2,
          contentVersion: 2,
          modelVersionId: 2,
          utf16Length: 4,
          utf8Bytes: 4,
        },
        {},
      ),
    ).toEqual({ reason: "settlement-required", status: "rejected" });
    expect(coordinator.commitSettlement(prepared.permit)).toBe(true);
    expect(coordinator.commitSettlement(prepared.permit)).toBe(false);
    expect(coordinator.cancelSettlement(prepared.permit)).toBe(false);
  });

  it("does not advertise disposal while retained discard is prepared", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const lease = reserve(coordinator).lease;
    const prepared = coordinator.prepareSettlement(lease, { kind: "discard" });
    expect(prepared.status).toBe("prepared");
    expect(coordinator.requestDispose(lease)).toEqual({
      reason: "settlement-required",
      status: "blocked",
    });
    expect(coordinator.cancelLiveContent(lease)).toBe(false);
    if (prepared.status === "prepared") {
      expect(coordinator.cancelSettlement(prepared.permit)).toBe(true);
    }
    expect(coordinator.requestDispose(lease)).toEqual({ status: "allowed" });
  });

  it("invalidates a prepared discard when another observed mutation arrives", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const lease = reserve(coordinator).lease;
    coordinator.recordLiveChange(lease, changed(2, 3));
    const prepared = coordinator.prepareSettlement(lease, { kind: "discard" });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    coordinator.recordLiveChange(lease, changed(3, 4));
    expect(coordinator.commitSettlement(prepared.permit)).toBe(false);
    expect(coordinator.inspect(lease)).toMatchObject({ mutationCount: 2 });
  });

  it("degrades a throwing runtime event with wholly unknown work", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const lease = reserve(coordinator).lease;
    const runtimeEvent = changed(2, 3);
    const throwingChange = {
      range: runtimeEvent.changes[0]!.range,
      rangeLength: 0,
      rangeOffset: 3,
    } as unknown as LiveDocumentContentChangeEvent["changes"][number];
    Object.defineProperty(throwingChange, "text", {
      get() {
        throw new Error("unreadable text");
      },
    });
    const receipt = coordinator.recordLiveChange(lease, {
      ...runtimeEvent,
      changes: [throwingChange],
    });
    expect(receipt).toMatchObject({
      mode: "snapshot-required",
      observedWork: {
        insertedUtf16Units: null,
        insertedUtf8Bytes: null,
        removedUtf16Units: null,
      },
      status: "committed",
    });
    expect(coordinator.inspect(lease)).toMatchObject({
      journal: { kind: "snapshot-required", reason: "invalid-change" },
      mutationCount: 1,
    });
  });

  it("fences A-B-A owner, document, and model incarnations", () => {
    const coordinator = new LiveDocumentContentCoordinator();
    const leaseA = reserve(coordinator).lease;
    coordinator.recordLiveChange(leaseA, changed(2, 3));
    const prepared = coordinator.prepareSettlement(leaseA, {
      kind: "discard",
    });
    if (prepared.status !== "prepared") throw new Error("Expected permit");
    coordinator.commitSettlement(prepared.permit);

    const nextAuthority = authority({
      documentIncarnation: {},
      modelIncarnation: {},
      ownerGeneration: 2,
      ownerIncarnation: {},
    });
    const leaseB = reserve(coordinator, nextAuthority).lease;
    expect(coordinator.recordLiveChange(leaseA, changed(3, 4))).toEqual({
      status: "stale",
    });
    expect(coordinator.inspect(leaseB)).toMatchObject({ kind: "retained" });
  });

  it("bounds holders and live channels before writable admission", () => {
    const holderBound = new LiveDocumentContentCoordinator({
      ...DEFAULT_LIVE_DOCUMENT_CONTENT_COORDINATOR_LIMITS,
      maxHoldersPerDocument: 1,
    });
    reserve(holderBound);
    expect(
      holderBound.reserveLiveContent(
        authority(),
        {
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 3,
          utf8Bytes: 3,
        },
        {},
      ),
    ).toEqual({ reason: "holder-limit", status: "rejected" });

    const channelBound = new LiveDocumentContentCoordinator({
      ...DEFAULT_LIVE_DOCUMENT_CONTENT_COORDINATOR_LIMITS,
      maxLiveDocuments: 1,
    });
    reserve(channelBound);
    expect(
      channelBound.reserveLiveContent(
        authority({
          documentIdentityKey: "inode:2",
          documentIncarnation: {},
          modelId: "file:///workspace/b.ts",
          modelIncarnation: {},
          path: "/workspace/b.ts",
        }),
        {
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 1,
          utf8Bytes: 1,
        },
        {},
      ),
    ).toEqual({ reason: "live-document-limit", status: "rejected" });
  });

  it("validates the complete limits shape before reservation", () => {
    expect(
      () =>
        new LiveDocumentContentCoordinator({
          ...DEFAULT_LIVE_DOCUMENT_CONTENT_COORDINATOR_LIMITS,
          maxHoldersPerDocument: 0,
        }),
    ).toThrow(/maxHolders/);
  });
});
