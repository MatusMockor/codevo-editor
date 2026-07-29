import { describe, expect, it, vi } from "vitest";
import type {
  LiveDocumentAuthority,
  LiveDocumentContentChangeEvent,
} from "../domain/liveDocumentContentAuthority";
import { LiveDocumentContentCoordinator } from "./liveDocumentContentCoordinator";
import {
  LiveModelIngressCoordinator,
  type LiveModelIngressRegistration,
} from "./liveModelIngressCoordinator";
import { LiveDocumentSnapshotBroker } from "./liveDocumentSnapshotBroker";
import type {
  LiveDocumentSnapshotReadExpectation,
  LiveDocumentSnapshotSourcePort,
  LiveDocumentSnapshotSourceProbe,
  LiveDocumentSnapshotSourceRead,
} from "./liveDocumentSnapshotSourcePort";

const OWNER = Object.freeze({});

class FakeSource implements LiveDocumentSnapshotSourcePort {
  readonly sourceAuthority = Object.freeze({});
  alternativeVersionId = 1;
  modelVersionId = 1;
  text = "abc";

  constructor(readonly modelAuthority: object) {}

  probe(): LiveDocumentSnapshotSourceProbe {
    return {
      alternativeVersionId: this.alternativeVersionId,
      modelVersionId: this.modelVersionId,
      status: "available",
      utf16Length: this.text.length,
    };
  }

  readFullText(_expectation: LiveDocumentSnapshotReadExpectation): LiveDocumentSnapshotSourceRead {
    return {
      alternativeVersionId: this.alternativeVersionId,
      modelAuthority: this.modelAuthority,
      modelVersionId: this.modelVersionId,
      sourceAuthority: this.sourceAuthority,
      text: this.text,
      utf16Length: this.text.length,
    };
  }

  append(text = "x"): void {
    this.text += text;
    this.modelVersionId += 1;
    this.alternativeVersionId += 1;
  }
}

function authority(
  identity = "inode:1",
  overrides: Partial<LiveDocumentAuthority> = {},
): LiveDocumentAuthority {
  return {
    canonicalRoot: "/workspace",
    documentIdentityKey: identity,
    documentIncarnation: Object.freeze({}),
    modelId: `file:///workspace/${identity}.ts`,
    modelIncarnation: Object.freeze({}),
    ownerGeneration: 1,
    ownerIncarnation: OWNER,
    ownerKey: "workspace-owner",
    path: `/workspace/${identity}.ts`,
    ...overrides,
  };
}

function registration(
  exactAuthority: LiveDocumentAuthority,
  source: LiveDocumentSnapshotSourcePort,
  holderIdentity: object = Object.freeze({}),
): LiveModelIngressRegistration {
  return {
    authority: exactAuthority,
    base: {
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 3,
      utf8Bytes: 3,
    },
    holderIdentity,
    source,
  };
}

function change(modelVersionId: number, previousLength: number): LiveDocumentContentChangeEvent {
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
        rangeOffset: previousLength,
        text: "x",
      },
    ],
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    modelVersionId,
    postUtf16Length: previousLength + 1,
  };
}

function harness(exactAuthority = authority()) {
  const content = new LiveDocumentContentCoordinator();
  const snapshots = new LiveDocumentSnapshotBroker(content);
  const ingress = new LiveModelIngressCoordinator(content, snapshots);
  const source = new FakeSource(exactAuthority.modelIncarnation);
  return { content, ingress, snapshots, source };
}

describe("LiveModelIngressCoordinator", () => {
  it("rolls a reservation back when source admission fails", () => {
    const content = new LiveDocumentContentCoordinator();
    const releaseSource = vi.fn(() => false);
    const ingress = new LiveModelIngressCoordinator(content, {
      registerSource: () => ({ reason: "source-limit", status: "rejected" }),
      releaseSource,
    });
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation);

    expect(ingress.register(registration(exactAuthority, source))).toEqual({
      reason: "source-limit",
      status: "rejected",
    });
    expect(content.activeReservationCount()).toBe(0);
    expect(releaseSource).not.toHaveBeenCalled();
  });

  it("rolls a reservation back when the injected source port throws", () => {
    const content = new LiveDocumentContentCoordinator();
    const ingress = new LiveModelIngressCoordinator(content, {
      registerSource: () => {
        throw new Error("registration failed");
      },
      releaseSource: () => false,
    });
    const exactAuthority = authority("inode:throw");
    const source = new FakeSource(exactAuthority.modelIncarnation);

    expect(ingress.register(registration(exactAuthority, source))).toEqual({
      reason: "source-failed",
      status: "rejected",
    });
    expect(content.activeReservationCount()).toBe(0);
  });

  it("discards a reentrant mutation before reporting source rejection", () => {
    const content = new LiveDocumentContentCoordinator();
    const ingress = new LiveModelIngressCoordinator(content, {
      registerSource: (lease) => {
        expect(content.recordLiveChange(lease, change(2, 3)).status).toBe("committed");
        return { reason: "source-limit", status: "rejected" };
      },
      releaseSource: () => false,
    });
    const exactAuthority = authority("inode:reentrant-reject");
    const source = new FakeSource(exactAuthority.modelIncarnation);

    expect(ingress.register(registration(exactAuthority, source))).toEqual({
      reason: "source-limit",
      status: "rejected",
    });
    expect(content.activeReservationCount()).toBe(0);
  });

  it("discards a reentrant mutation before reporting a thrown source failure", () => {
    const content = new LiveDocumentContentCoordinator();
    const ingress = new LiveModelIngressCoordinator(content, {
      registerSource: (lease) => {
        expect(content.recordLiveChange(lease, change(2, 3)).status).toBe("committed");
        throw new Error("source failed after reentry");
      },
      releaseSource: () => false,
    });
    const exactAuthority = authority("inode:reentrant-throw");
    const source = new FakeSource(exactAuthority.modelIncarnation);

    expect(ingress.register(registration(exactAuthority, source))).toEqual({
      reason: "source-failed",
      status: "rejected",
    });
    expect(content.activeReservationCount()).toBe(0);
  });

  it("returns an exact recovery handle when reentrant rollback is temporarily blocked", () => {
    const content = new LiveDocumentContentCoordinator();
    let blockFirstSettlement = true;
    const ingress = new LiveModelIngressCoordinator(
      {
        cancelLiveContent: (lease) => content.cancelLiveContent(lease),
        commitSettlement: (permit) => content.commitSettlement(permit),
        inspect: (lease) => content.inspect(lease),
        prepareSettlement: (lease, discard) => {
          if (blockFirstSettlement) {
            blockFirstSettlement = false;
            return { reason: "already-prepared", status: "rejected" };
          }
          return content.prepareSettlement(lease, discard);
        },
        recordLiveChange: (lease, event) => content.recordLiveChange(lease, event),
        releaseLiveContentHolder: (lease) => content.releaseLiveContentHolder(lease),
        requestDispose: (lease) => content.requestDispose(lease),
        reserveLiveContent: (exactAuthority, base, holder) =>
          content.reserveLiveContent(exactAuthority, base, holder),
      },
      {
        registerSource: (lease) => {
          expect(content.recordLiveChange(lease, change(2, 3)).status).toBe("committed");
          return { reason: "source-limit", status: "rejected" };
        },
        releaseSource: () => false,
      },
    );
    const exactAuthority = authority("inode:recovery");
    const source = new FakeSource(exactAuthority.modelIncarnation);
    const result = ingress.register(registration(exactAuthority, source));

    expect(result.status).toBe("recovery-required");
    if (result.status !== "recovery-required") {
      throw new Error("expected recovery handle");
    }
    expect(result.recovery.currentRevision()).toMatchObject({
      contentVersion: 2,
      mode: "incremental",
    });
    expect(content.activeReservationCount()).toBe(1);
    expect(result.recovery.discard()).toBe(true);
    expect(result.recovery.currentRevision()).toBeNull();
    expect(result.recovery.discard()).toBe(false);
    expect(content.activeReservationCount()).toBe(0);
  });

  it.each(["reject", "throw"] as const)(
    "releases only a failed joined holder when source registration will %s",
    (failure) => {
      const exactAuthority = authority(`inode:joined-${failure}`);
      const content = new LiveDocumentContentCoordinator();
      const broker = new LiveDocumentSnapshotBroker(content);
      let registrations = 0;
      const ingress = new LiveModelIngressCoordinator(content, {
        registerSource: (lease, source) => {
          registrations += 1;
          if (registrations === 1) {
            return broker.registerSource(lease, source);
          }
          if (failure === "throw") {
            throw new Error("joined source failed");
          }
          return { reason: "source-limit", status: "rejected" };
        },
        releaseSource: (sourceRegistration) => broker.releaseSource(sourceRegistration),
      });
      const source = new FakeSource(exactAuthority.modelIncarnation);
      const first = ingress.register(registration(exactAuthority, source, Object.freeze({})));
      if (first.status !== "registered") {
        throw new Error("initial registration failed");
      }
      source.append();
      expect(first.handle.recordChange(change(2, 3)).status).toBe("committed");

      const failed = ingress.register(registration(exactAuthority, source, Object.freeze({})));

      expect(failed).toEqual({
        reason: failure === "throw" ? "source-failed" : "source-limit",
        status: "rejected",
      });
      expect(content.activeReservationCount()).toBe(1);
      expect(first.handle.currentRevision()).toMatchObject({
        contentVersion: 2,
        mode: "incremental",
      });
      source.append();
      expect(first.handle.recordChange(change(3, 4)).status).toBe("committed");
    },
  );

  it("is idempotent for one exact holder and rejects its replacement source", () => {
    const exactAuthority = authority();
    const subject = harness(exactAuthority);
    const holder = Object.freeze({});
    const first = subject.ingress.register(registration(exactAuthority, subject.source, holder));
    const duplicate = subject.ingress.register(
      registration(exactAuthority, subject.source, holder),
    );
    if (first.status !== "registered" || duplicate.status !== "registered") {
      throw new Error("registration failed");
    }

    expect(duplicate.role).toBe("existing");
    expect(duplicate.handle).toBe(first.handle);
    expect(subject.snapshots.registeredSourceCount()).toBe(1);
    expect(
      subject.ingress.register(
        registration(exactAuthority, new FakeSource(exactAuthority.modelIncarnation), holder),
      ),
    ).toEqual({ reason: "source-mismatch", status: "rejected" });
  });

  it("records compact revisions and makes a released handle stale", () => {
    const exactAuthority = authority();
    const subject = harness(exactAuthority);
    const registered = subject.ingress.register(registration(exactAuthority, subject.source));
    if (registered.status !== "registered") throw new Error("registration failed");

    expect(registered.handle.currentRevision()).toEqual({
      alternativeVersionId: 1,
      contentVersion: 1,
      mode: "retained",
      modelVersionId: 1,
      utf16Length: 3,
    });
    subject.source.append();
    expect(registered.handle.recordChange(change(2, 3))).toEqual({
      revision: {
        alternativeVersionId: 2,
        contentVersion: 2,
        mode: "incremental",
        modelVersionId: 2,
        utf16Length: 4,
      },
      status: "committed",
    });
    expect(registered.handle.release()).toEqual({
      reason: "settlement-required",
      status: "blocked",
    });
    expect(subject.snapshots.registeredSourceCount()).toBe(1);
    expect(registered.handle.currentRevision()).toMatchObject({
      contentVersion: 2,
      mode: "incremental",
    });
  });

  it("releases a retained source only after its holder settles and only once", () => {
    const exactAuthority = authority();
    const content = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(content);
    const calls: string[] = [];
    const ingress = new LiveModelIngressCoordinator(
      {
        commitSettlement: (permit) => content.commitSettlement(permit),
        cancelLiveContent: (lease) => content.cancelLiveContent(lease),
        inspect: (lease) => content.inspect(lease),
        prepareSettlement: (lease, discard) => content.prepareSettlement(lease, discard),
        recordLiveChange: (lease, event) => content.recordLiveChange(lease, event),
        releaseLiveContentHolder: (lease) => {
          calls.push("holder");
          return content.releaseLiveContentHolder(lease);
        },
        requestDispose: (lease) => content.requestDispose(lease),
        reserveLiveContent: (exactAuthority, base, holder) =>
          content.reserveLiveContent(exactAuthority, base, holder),
      },
      {
        registerSource: (lease, source) => broker.registerSource(lease, source),
        releaseSource: (sourceRegistration) => {
          calls.push("source");
          return broker.releaseSource(sourceRegistration);
        },
        settleSourceRelease: (sourceRegistration, settle) =>
          broker.settleSourceRelease(sourceRegistration, () => {
            const settled = settle();
            if (settled) calls.push("source");
            return settled;
          }),
      },
    );
    const source = new FakeSource(exactAuthority.modelIncarnation);
    const registered = ingress.register(registration(exactAuthority, source));
    if (registered.status !== "registered") throw new Error("registration failed");

    expect(registered.handle.release()).toEqual({ status: "released" });
    expect(calls).toEqual(["holder", "source"]);
    expect(registered.handle.release()).toEqual({ status: "stale" });
    expect(registered.handle.currentRevision()).toBeNull();
  });

  it("releases a shared live holder but retains the final dirty source", () => {
    const exactAuthority = authority("inode:shared");
    const subject = harness(exactAuthority);
    const first = subject.ingress.register(
      registration(exactAuthority, subject.source, Object.freeze({})),
    );
    const second = subject.ingress.register(
      registration(exactAuthority, subject.source, Object.freeze({})),
    );
    if (first.status !== "registered" || second.status !== "registered") {
      throw new Error("registration failed");
    }
    subject.source.append();
    expect(first.handle.recordChange(change(2, 3)).status).toBe("committed");
    expect(second.handle.recordChange(change(2, 3))).toEqual({ status: "stale" });

    expect(first.handle.release()).toEqual({ status: "released" });
    expect(subject.snapshots.registeredSourceCount()).toBe(1);
    expect(second.handle.currentRevision()).toMatchObject({ contentVersion: 2 });
    expect(second.handle.release()).toEqual({
      reason: "settlement-required",
      status: "blocked",
    });
    expect(subject.snapshots.registeredSourceCount()).toBe(1);
    subject.source.append();
    expect(second.handle.recordChange(change(3, 4)).status).toBe("committed");
  });

  it("retains a dirty binding and source when settlement commit fails, then retries", () => {
    const exactAuthority = authority("inode:retry-settlement");
    const content = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(content);
    let rejectSettlement = true;
    const ingress = new LiveModelIngressCoordinator(
      {
        commitSettlement: (permit) => {
          if (rejectSettlement) {
            rejectSettlement = false;
            return false;
          }
          return content.commitSettlement(permit);
        },
        cancelLiveContent: (lease) => content.cancelLiveContent(lease),
        cancelSettlement: (permit) => content.cancelSettlement(permit),
        inspect: (lease) => content.inspect(lease),
        prepareSettlement: (lease, discard) => content.prepareSettlement(lease, discard),
        recordLiveChange: (lease, event) => content.recordLiveChange(lease, event),
        releaseLiveContentHolder: (lease) => content.releaseLiveContentHolder(lease),
        requestDispose: (lease) => content.requestDispose(lease),
        reserveLiveContent: (authority, base, holder) =>
          content.reserveLiveContent(authority, base, holder),
      },
      broker,
      broker,
    );
    const source = new FakeSource(exactAuthority.modelIncarnation);
    const registered = ingress.register(registration(exactAuthority, source));
    if (registered.status !== "registered") throw new Error("registration failed");
    source.append();
    expect(registered.handle.recordChange(change(2, 3)).status).toBe("committed");
    const retained = ingress.capture(
      registered.handle,
      "change-hunks",
      new AbortController().signal,
    );
    expect(retained.status).toBe("captured");

    expect(ingress.discard(registered.handle)).toBe(false);
    expect(registered.handle.currentRevision()).toMatchObject({ contentVersion: 2 });
    expect(broker.registeredSourceCount()).toBe(1);
    if (retained.status === "captured") {
      expect(ingress.consumeCurrent(registered.handle, retained.snapshot)).toBe(true);
    }
    const pendingRetire = ingress.capture(
      registered.handle,
      "change-hunks",
      new AbortController().signal,
    );
    expect(pendingRetire.status).toBe("captured");

    expect(ingress.discard(registered.handle)).toBe(true);
    expect(registered.handle.currentRevision()).toBeNull();
    expect(broker.registeredSourceCount()).toBe(0);
    if (pendingRetire.status === "captured") {
      expect(broker.release(pendingRetire.snapshot)).toBe(false);
    }
  });

  it("retains a binding when source settlement admission fails, then retries", () => {
    const exactAuthority = authority("inode:retry-source");
    const content = new LiveDocumentContentCoordinator();
    const broker = new LiveDocumentSnapshotBroker(content);
    let rejectSourceSettlement = true;
    const ingress = new LiveModelIngressCoordinator(content, {
      registerSource: (lease, source) => broker.registerSource(lease, source),
      releaseSource: (sourceRegistration) => broker.releaseSource(sourceRegistration),
      settleSourceRelease: (sourceRegistration, settle) => {
        if (rejectSourceSettlement) {
          rejectSourceSettlement = false;
          return false;
        }
        return broker.settleSourceRelease(sourceRegistration, settle);
      },
    });
    const source = new FakeSource(exactAuthority.modelIncarnation);
    const registered = ingress.register(registration(exactAuthority, source));
    if (registered.status !== "registered") throw new Error("registration failed");

    expect(registered.handle.release()).toEqual({ status: "stale" });
    expect(registered.handle.currentRevision()).toMatchObject({ mode: "retained" });
    expect(broker.registeredSourceCount()).toBe(1);

    expect(registered.handle.release()).toEqual({ status: "released" });
    expect(registered.handle.currentRevision()).toBeNull();
    expect(broker.registeredSourceCount()).toBe(0);
  });

  it("fences an old handle after same-key A-B-A replacement", () => {
    const firstAuthority = authority("inode:aba");
    const subject = harness(firstAuthority);
    const first = subject.ingress.register(registration(firstAuthority, subject.source));
    if (first.status !== "registered") throw new Error("registration failed");
    expect(first.handle.release()).toEqual({ status: "released" });

    const nextAuthority = authority("inode:aba", {
      documentIncarnation: Object.freeze({}),
      modelIncarnation: Object.freeze({}),
      ownerGeneration: 2,
      ownerIncarnation: Object.freeze({}),
    });
    const nextSource = new FakeSource(nextAuthority.modelIncarnation);
    const next = subject.ingress.register(registration(nextAuthority, nextSource));
    if (next.status !== "registered") throw new Error("replacement failed");

    expect(first.handle.currentRevision()).toBeNull();
    expect(first.handle.recordChange(change(2, 3))).toEqual({ status: "stale" });
    expect(first.handle.release()).toEqual({ status: "stale" });
    expect(next.handle.currentRevision()).toMatchObject({ mode: "retained" });
  });
});
