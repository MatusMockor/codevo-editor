import { describe, expect, it, vi } from "vitest";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenRequest,
  BoundedLanguageServerDidOpenReceipt,
  BoundedLanguageServerDocumentSyncReceipt,
  IncrementalLanguageServerDocumentSyncGateway,
} from "../domain/incrementalLanguageServerDocumentSync";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";
import { DocumentSessionStore } from "./documentSessionStore";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import {
  EditorSessionDocumentAuthoritySidecar,
  type EditorGroupDocumentSessionAuthority,
} from "./editorSessionDocumentAuthority";
import { IncrementalDocumentSyncCoordinator } from "./incrementalDocumentSyncCoordinator";
import { JavaScriptTypeScriptIncrementalSyncService } from "./javaScriptTypeScriptIncrementalSyncService";
import {
  JavaScriptTypeScriptIncrementalSyncProductionCoordinator,
  MAX_JAVASCRIPT_TYPESCRIPT_INCREMENTAL_LSP_INITIAL_UTF16_UNITS,
  type EditorJavaScriptTypeScriptIncrementalSyncAttachment,
  type EditorJavaScriptTypeScriptIncrementalSyncSource,
  type JavaScriptTypeScriptIncrementalRuntimeAuthority,
} from "./javaScriptTypeScriptIncrementalSyncProduction";

const ROOT = "/workspace";
const PATH = "/workspace/src/server.ts";
const CAPABILITY = Object.freeze({
  changeKind: "incremental" as const,
  openClose: true,
  save: Object.freeze({ includeText: true, kind: "supported" as const }),
});

describe("JavaScriptTypeScriptIncrementalSyncProductionCoordinator", () => {
  it("claims an edit synchronously while legacy close and bounded open are pending", async () => {
    const close = deferred<void>();
    const fixture = productionFixture({
      closeLegacy: () => close.promise,
    });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    expect(attachment).not.toBeNull();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(true);
    expect(fixture.source.captureCurrentContent).toHaveBeenCalledOnce();

    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    const claim = fixture.production.claimLegacyChange(PATH);
    expect(claim?.revision).toBe(2);
    expect(fixture.gateway.openRequests).toHaveLength(0);

    close.resolve();
    await settle();
    expect(fixture.gateway.openRequests).toHaveLength(1);
    expect(await fixture.production.drainBeforeSave(lifecycleLease(fixture.production))).toBe(true);
    await expect(claim?.suppressLegacy()).resolves.toBe(true);
    expect(fixture.gateway.changeRequests).toHaveLength(1);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.source.captureCurrentContent).toHaveBeenCalledOnce();
  });

  it.each([1, 2, 4])(
    "joins %i exact panes and restores legacy only after the admitted final close",
    async (paneCount) => {
      const fixture = productionFixture();
      const attachments = Array.from({ length: paneCount }, () =>
        fixture.production.attach(fixture.authority, fixture.source, () => fixture.current),
      );
      expect(attachments.every(Boolean)).toBe(true);
      await settle();
      expect(fixture.legacyClose).toHaveBeenCalledOnce();
      expect(fixture.gateway.openRequests).toHaveLength(1);
      expect(fixture.source.captureCurrentContent).toHaveBeenCalledOnce();

      for (const attachment of attachments.slice(0, -1)) {
        await fixture.production.release(attachment!);
      }
      expect(fixture.gateway.closeRequests).toHaveLength(0);
      expect(fixture.legacyOpen).not.toHaveBeenCalled();

      await fixture.production.release(attachments[attachments.length - 1]!);
      expect(fixture.gateway.closeRequests).toHaveLength(1);
      expect(fixture.legacyOpen).toHaveBeenCalledOnce();
    },
  );

  it.each([3, 5, 10])(
    "keeps %i MiB documents explicitly degraded without a full read or failed didOpen",
    async (sizeMiB) => {
      const fixture = productionFixture({ initialText: "a".repeat(sizeMiB * 1024 * 1024) });
      const attachments = Array.from({ length: 4 }, () =>
        fixture.production.attach(fixture.authority, fixture.source, () => fixture.current),
      );

      expect(attachments.every(Boolean)).toBe(true);
      expect(
        attachments.every((attachment) => attachment?.semanticMode === "degraded-large-file"),
      ).toBe(true);
      expect(fixture.source.captureCurrentContent).not.toHaveBeenCalled();
      expect(fixture.gateway.openRequests).toHaveLength(0);
      expect(fixture.legacyClose).not.toHaveBeenCalled();

      for (let index = 0; index < 100; index += 1) {
        expect(
          fixture.production.observe(
            attachments[index % attachments.length]!,
            insertion(index + 2, sizeMiB * 1024 * 1024 + index, "x"),
          ),
        ).toEqual({ status: "authoritative" });
      }
      await settle();
      expect(fixture.source.captureCurrentContent).not.toHaveBeenCalled();
      expect(fixture.gateway.openRequests).toHaveLength(0);
      expect(fixture.gateway.changeRequests).toHaveLength(0);
    },
  );

  it("admits the exact LSP boundary and preflights one UTF-16 unit above it", async () => {
    const exact = productionFixture({
      initialText: "a".repeat(MAX_JAVASCRIPT_TYPESCRIPT_INCREMENTAL_LSP_INITIAL_UTF16_UNITS),
    });
    const exactAttachment = exact.production.attach(
      exact.authority,
      exact.source,
      () => exact.current,
    );
    expect(exactAttachment?.semanticMode).toBe("incremental");
    expect(exact.source.captureCurrentContent).toHaveBeenCalledOnce();
    await settle();
    expect(exact.gateway.openRequests).toHaveLength(1);

    const oversized = productionFixture({
      initialText: "a".repeat(MAX_JAVASCRIPT_TYPESCRIPT_INCREMENTAL_LSP_INITIAL_UTF16_UNITS + 1),
    });
    const oversizedAttachment = oversized.production.attach(
      oversized.authority,
      oversized.source,
      () => oversized.current,
    );
    expect(oversizedAttachment?.semanticMode).toBe("degraded-large-file");
    expect(oversized.source.captureCurrentContent).not.toHaveBeenCalled();
    await settle();
    expect(oversized.gateway.openRequests).toHaveLength(0);
  });

  it("invalidates the issuing pane lease when a joined peer survives its release", async () => {
    const fixture = productionFixture();
    const first = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    const second = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();
    const firstLease = lifecycleLease(fixture.production);

    await fixture.production.release(first!);

    expect(fixture.production.isLeaseCurrent(firstLease)).toBe(false);
    await expect(fixture.production.prepareSave(firstLease)).resolves.toBeNull();
    await expect(fixture.production.closeDocument(firstLease)).resolves.toBe(false);
    expect(fixture.gateway.closeRequests).toHaveLength(0);
    const survivingLease = lifecycleLease(fixture.production);
    expect(fixture.production.isLeaseCurrent(survivingLease)).toBe(true);

    fixture.production.observe(second!, insertion(2, 10, "x"));
    expect(fixture.production.claimLegacyChange(PATH)?.revision).toBe(2);
  });

  it.each([2, 4])(
    "joins %i panes behind one unsettled legacy close before bounded open",
    async (paneCount) => {
      const close = deferred<void>();
      const fixture = productionFixture({ closeLegacy: () => close.promise });
      const attachments = Array.from({ length: paneCount }, () =>
        fixture.production.attach(fixture.authority, fixture.source, () => fixture.current),
      );

      expect(attachments.every(Boolean)).toBe(true);
      expect(fixture.legacyClose).toHaveBeenCalledOnce();
      expect(fixture.gateway.openRequests).toHaveLength(0);
      expect(fixture.source.captureCurrentContent).toHaveBeenCalledOnce();

      close.resolve();
      await settle();
      expect(fixture.gateway.openRequests).toHaveLength(1);
    },
  );

  it("retains the exact accepted revision for a later save drain", async () => {
    const fixture = productionFixture();
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    const claim = fixture.production.claimLegacyChange(PATH);

    const saveLease = lifecycleLease(fixture.production);
    expect(await fixture.production.drainBeforeSave(saveLease)).toBe(true);
    await expect(claim?.suppressLegacy()).resolves.toBe(true);
    expect(await fixture.production.drainBeforeSave(saveLease)).toBe(true);
    expect(fixture.gateway.changeRequests).toHaveLength(1);
  });

  it("coalesces 100 large-model edits with no legacy writer or LSP snapshot read", async () => {
    const fixture = productionFixture({ initialText: "a".repeat(1024 * 1024) });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();
    const claims = Array.from({ length: 100 }, (_, index) => {
      const revision = index + 2;
      fixture.production.observe(
        attachment!,
        insertion(revision, 1024 * 1024 + index, String(index % 10)),
      );
      return fixture.production.claimLegacyChange(PATH)!;
    });

    expect(await fixture.production.drainBeforeSave(lifecycleLease(fixture.production))).toBe(true);
    await expect(Promise.all(claims.map((claim) => claim.suppressLegacy()))).resolves.toEqual(
      Array.from({ length: 100 }, () => true),
    );
    expect(fixture.gateway.changeRequests).toHaveLength(1);
    const envelope = fixture.gateway.changeRequests[0]?.change;
    expect(envelope?.kind).toBe("incremental");
    if (envelope?.kind !== "incremental") throw new Error("Expected incremental envelope");
    expect(envelope.changes).toHaveLength(100);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.source.captureCurrentContent).toHaveBeenCalledOnce();
  });

  it("does not resume legacy after an uncertain final close", async () => {
    const gateway = new FakeIncrementalGateway();
    gateway.close = () => new Promise(() => undefined);
    const fixture = productionFixture({ gateway, gatewayTimeoutMs: 1 });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();

    await fixture.production.release(attachment!);
    expect(fixture.gateway.closeRequests).toHaveLength(1);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(true);
  });

  it("falls back once only after bounded open proves no lifecycle ownership", async () => {
    const gateway = new FakeIncrementalGateway();
    gateway.openResults.push({ kind: "staleAuthority" });
    const fixture = productionFixture({ gateway });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    const claim = fixture.production.claimLegacyChange(PATH);
    await settle();

    await expect(claim?.suppressLegacy()).resolves.toBe(false);
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(false);
  });

  it("blocks both writers when the legacy close outcome is uncertain", async () => {
    const fixture = productionFixture({
      closeLegacy: async () => {
        throw new Error("close response lost");
      },
    });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    const claim = fixture.production.claimLegacyChange(PATH);
    await settle();

    await expect(claim?.suppressLegacy()).resolves.toBe(true);
    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(true);
  });

  it("never restores legacy after an explicit close while handoff is pending", async () => {
    const close = deferred<void>();
    const fixture = productionFixture({ closeLegacy: () => close.promise });
    expect(
      fixture.production.attach(fixture.authority, fixture.source, () => fixture.current),
    ).not.toBeNull();

    await expect(
      fixture.production.closeDocument(lifecycleLease(fixture.production)),
    ).resolves.toBe(true);
    close.resolve();
    await settle();

    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
  });

  it("never restores legacy after an explicit root close while handoff is pending", async () => {
    const close = deferred<void>();
    const fixture = productionFixture({ closeLegacy: () => close.promise });
    expect(
      fixture.production.attach(fixture.authority, fixture.source, () => fixture.current),
    ).not.toBeNull();

    const closing = fixture.production.closeRoot(ROOT);
    close.resolve();
    await closing;
    await settle();

    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
  });

  it("starts a fresh legacy handoff after a closed model is reopened", async () => {
    const fixture = productionFixture();
    const first = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();
    await fixture.production.release(first!);
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();

    const replacementSource = {
      ...fixture.source,
      model: {},
    };
    expect(
      fixture.production.attach(fixture.authority, replacementSource, () => fixture.current),
    ).not.toBeNull();
    await settle();

    expect(fixture.legacyClose).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a required exact snapshot becomes unavailable", async () => {
    const fixture = productionFixture({ initialText: "" });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();
    vi.mocked(fixture.source.captureCurrentContent).mockReturnValue(null);

    fixture.production.observe(attachment!, {
      ...insertion(2, 0, ""),
      changes: [],
      isFlush: true,
    });
    const claim = fixture.production.claimLegacyChange(PATH);
    await expect(claim?.suppressLegacy()).resolves.toBe(false);

    expect(fixture.gateway.changeRequests).toHaveLength(0);
    expect(fixture.gateway.closeRequests).toHaveLength(1);
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();
  });

  it("retains the latest exact fallback until its publisher admits restoration", async () => {
    const gateway = new FakeIncrementalGateway();
    gateway.change = async () => ({ kind: "staleAuthority" });
    let admitPublication = false;
    const publishLegacyFallback = vi.fn(() => admitPublication);
    const fixture = productionFixture({ gateway, publishLegacyFallback });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();

    fixture.setText("0123456789x");
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    expect(await fixture.production.drainBeforeSave(lifecycleLease(fixture.production))).toBe(
      false,
    );
    await settle();

    expect(publishLegacyFallback).toHaveBeenCalledOnce();
    expect(publishLegacyFallback).toHaveBeenLastCalledWith("0123456789x");
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(true);

    admitPublication = true;
    fixture.setText("0123456789xy");
    expect(fixture.production.observe(attachment!, insertion(3, 11, "y"))).toEqual({
      status: "authoritative",
    });
    await settle();

    expect(publishLegacyFallback).toHaveBeenCalledTimes(2);
    expect(publishLegacyFallback).toHaveBeenLastCalledWith("0123456789xy");
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(false);
  });

  it("keeps a throwing fallback publisher blocked and never restores stale authority", async () => {
    const gateway = new FakeIncrementalGateway();
    gateway.change = async () => ({ kind: "staleAuthority" });
    const publishLegacyFallback = vi.fn(() => {
      throw new Error("projection rejected");
    });
    const fixture = productionFixture({ gateway, publishLegacyFallback });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    await settle();

    fixture.setText("0123456789x");
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    expect(await fixture.production.drainBeforeSave(lifecycleLease(fixture.production))).toBe(
      false,
    );
    await settle();
    expect(publishLegacyFallback).toHaveBeenCalledOnce();
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(true);

    fixture.current = false;
    fixture.setText("0123456789xy");
    expect(fixture.production.observe(attachment!, insertion(3, 11, "y"))).toEqual({
      status: "legacy-required",
    });
    expect(publishLegacyFallback).toHaveBeenCalledOnce();
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
  });

  it("rejects reentrant fallback admission and retries the newest exact content", async () => {
    const gateway = new FakeIncrementalGateway();
    gateway.change = async () => ({ kind: "staleAuthority" });
    const reentrantState: {
      attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment | null;
      fixture: ReturnType<typeof productionFixture> | null;
    } = { attachment: null, fixture: null };
    let reenter = true;
    const publishLegacyFallback = vi.fn(() => {
      if (reenter) {
        reenter = false;
        reentrantState.fixture?.setText("0123456789xy");
        reentrantState.fixture?.production.observe(
          reentrantState.attachment!,
          insertion(3, 11, "y"),
        );
      }
      return true;
    });
    const fixture = productionFixture({ gateway, publishLegacyFallback });
    const attachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => fixture.current,
    );
    reentrantState.fixture = fixture;
    reentrantState.attachment = attachment;
    await settle();

    fixture.setText("0123456789x");
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    expect(await fixture.production.drainBeforeSave(lifecycleLease(fixture.production))).toBe(
      false,
    );
    await settle();

    expect(publishLegacyFallback).toHaveBeenCalledOnce();
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
    expect(fixture.production.ownsLifecycle(PATH)).toBe(true);

    fixture.setText("0123456789xyz");
    fixture.production.observe(attachment!, insertion(4, 12, "z"));
    await settle();
    expect(publishLegacyFallback).toHaveBeenCalledTimes(2);
    expect(publishLegacyFallback).toHaveBeenLastCalledWith("0123456789xyz");
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();
  });

  it("rejects unsupported languages without reading model content", () => {
    const fixture = productionFixture();
    const source = {
      ...fixture.source,
      languageId: "plaintext",
    };

    expect(fixture.production.attach(fixture.authority, source, () => fixture.current)).toBeNull();
    expect(source.captureCurrentContent).not.toHaveBeenCalled();
  });

  it("keeps an opaque reconciliation identity stable for fresh equivalent authority objects", () => {
    const fixture = productionFixture({ freshRuntimeAuthority: true });
    const first = fixture.production.reconciliationIdentity();
    expect(fixture.production.reconciliationIdentity()).toBe(first);

    fixture.setRuntimeAuthority({
      ...fixture.runtimeAuthority,
      sessionId: fixture.runtimeAuthority.sessionId + 1,
    });
    const switched = fixture.production.reconciliationIdentity();
    expect(switched).not.toBe(first);
    fixture.setRuntimeAuthority({ ...fixture.runtimeAuthority });
    expect(fixture.production.reconciliationIdentity()).not.toBe(first);
  });

  it("rejects an exact save permit after negotiated sync capability replacement", async () => {
    const fixture = productionFixture();
    expect(fixture.production.attach(fixture.authority, fixture.source, () => true)).not.toBeNull();
    await settle();
    const prepared = await fixture.production.prepareSave(lifecycleLease(fixture.production));
    fixture.setRuntimeAuthority({
      ...fixture.runtimeAuthority,
      capability: {
        ...CAPABILITY,
        save: { kind: "unsupported" },
      },
    });

    expect(fixture.production.confirmSave(prepared!.permit)).toBe(false);
  });

  it("never consumes a stale old-model claim for a replacement model", async () => {
    const close = deferred<void>();
    const fixture = productionFixture({ closeLegacy: () => close.promise });
    let oldModelCurrent = true;
    const oldAttachment = fixture.production.attach(
      fixture.authority,
      fixture.source,
      () => oldModelCurrent,
    );
    fixture.production.observe(oldAttachment!, insertion(2, 10, "old"));

    oldModelCurrent = false;
    expect(fixture.production.claimLegacyChange(PATH)).toBeNull();

    const replacementSource = {
      ...fixture.source,
      model: {},
      versionId: 2,
    };
    const replacement = fixture.production.attach(fixture.authority, replacementSource, () => true);
    fixture.production.observe(replacement!, insertion(3, 10, "new"));
    expect(fixture.production.claimLegacyChange(PATH)?.revision).toBe(3);

    close.resolve();
    await settle();
  });

  it("bounds active production channels before reading a rejected model", () => {
    const fixture = productionFixture();
    for (let index = 0; index < 32; index += 1) {
      const path = `${ROOT}/src/file-${index}.ts`;
      const source = {
        ...fixture.source,
        captureCurrentContent: vi.fn(() => "0123456789"),
        model: {},
        modelId: path,
      };
      expect(fixture.production.attach(groupAuthority(path), source, () => true)).not.toBeNull();
    }
    const rejectedPath = `${ROOT}/src/rejected.ts`;
    const rejectedSource = {
      ...fixture.source,
      captureCurrentContent: vi.fn(() => "0123456789"),
      model: {},
      modelId: rejectedPath,
    };

    expect(
      fixture.production.attach(groupAuthority(rejectedPath), rejectedSource, () => true),
    ).toBeNull();
    expect(rejectedSource.captureCurrentContent).not.toHaveBeenCalled();
  });

  it("fences late A drain and restore after a B to new-A runtime replacement", async () => {
    const change = deferred<BoundedLanguageServerDocumentSyncReceipt>();
    const gateway = new FakeIncrementalGateway();
    gateway.change = () => change.promise;
    const fixture = productionFixture({ gateway });
    const oldAttachment = fixture.production.attach(fixture.authority, fixture.source, () => true);
    await settle();
    fixture.production.observe(oldAttachment!, insertion(2, 10, "old"));
    const oldClaim = fixture.production.claimLegacyChange(PATH);
    const oldDrain = fixture.production.drainBeforeSave(lifecycleLease(fixture.production));
    await settle();

    fixture.setRuntimeAuthority(null);
    const replacementAuthority = {
      ...fixture.runtimeAuthority,
      syncGeneration: fixture.runtimeAuthority.syncGeneration + 1,
    };
    fixture.setRuntimeAuthority(replacementAuthority);
    const replacementSource = {
      ...fixture.source,
      model: {},
      versionId: 2,
    };
    expect(
      fixture.production.attach(fixture.authority, replacementSource, () => true),
    ).not.toBeNull();

    change.resolve({ kind: "staleAuthority" });
    await expect(oldDrain).resolves.toBe(false);
    await expect(oldClaim?.suppressLegacy()).resolves.toBe(true);
    await settle();
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
  });

  it("rejects a stale exact lifecycle lease after a same-path runtime replacement", async () => {
    const fixture = productionFixture();
    expect(fixture.production.attach(fixture.authority, fixture.source, () => true)).not.toBeNull();
    await settle();
    const staleLease = lifecycleLease(fixture.production);

    fixture.setRuntimeAuthority(null);
    const replacementAuthority = {
      ...fixture.runtimeAuthority,
      syncGeneration: fixture.runtimeAuthority.syncGeneration + 1,
    };
    fixture.setRuntimeAuthority(replacementAuthority);
    expect(
      fixture.production.attach(
        fixture.authority,
        { ...fixture.source, model: {}, versionId: 2 },
        () => true,
      ),
    ).not.toBeNull();
    await settle();
    const replacementLease = lifecycleLease(fixture.production);

    await expect(fixture.production.closeDocument(staleLease)).resolves.toBe(false);
    expect(fixture.production.isLeaseCurrent(replacementLease)).toBe(true);
  });

  it("issues single-use exact save permits and rejects them after replacement", async () => {
    const fixture = productionFixture();
    const attachment = fixture.production.attach(fixture.authority, fixture.source, () => true);
    expect(attachment).not.toBeNull();
    await settle();
    const prepared = await fixture.production.prepareSave(lifecycleLease(fixture.production));
    expect(prepared?.content).toBe("0123456789");
    expect(fixture.production.confirmSave(prepared!.permit)).toBe(true);
    expect(fixture.production.confirmSave(prepared!.permit)).toBe(false);

    const stalePrepared = await fixture.production.prepareSave(lifecycleLease(fixture.production));
    fixture.production.observe(attachment!, insertion(2, 10, "x"));
    expect(fixture.production.confirmSave(stalePrepared!.permit)).toBe(false);

    const replacementPrepared = await fixture.production.prepareSave(
      lifecycleLease(fixture.production),
    );
    fixture.setRuntimeAuthority({
      ...fixture.runtimeAuthority,
      syncGeneration: fixture.runtimeAuthority.syncGeneration + 1,
    });
    expect(fixture.production.confirmSave(replacementPrepared!.permit)).toBe(false);
  });

  it("retains a blocking claim for the overflow revision until exact close restores legacy", async () => {
    const close = deferred<BoundedLanguageServerDocumentSyncReceipt>();
    const gateway = new FakeIncrementalGateway();
    gateway.close = () => close.promise;
    const fixture = productionFixture({ gateway });
    const attachment = fixture.production.attach(fixture.authority, fixture.source, () => true);
    await settle();
    for (let revision = 2; revision <= 258; revision += 1) {
      fixture.production.observe(attachment!, insertion(revision, 10, "x"));
    }
    const claim = fixture.production.claimLegacyChange(PATH);
    expect(claim?.revision).toBe(258);
    let settled = false;
    void claim?.suppressLegacy().then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();

    close.resolve({ kind: "admitted" });
    await expect(claim?.suppressLegacy()).resolves.toBe(false);
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();
  });

  it("keeps overflow fail-closed when exact incremental close is uncertain", async () => {
    const gateway = new FakeIncrementalGateway();
    gateway.close = () => new Promise(() => undefined);
    const fixture = productionFixture({ gateway, gatewayTimeoutMs: 1 });
    const attachment = fixture.production.attach(fixture.authority, fixture.source, () => true);
    await settle();
    for (let revision = 2; revision <= 258; revision += 1) {
      fixture.production.observe(attachment!, insertion(revision, 10, "x"));
    }
    const claim = fixture.production.claimLegacyChange(PATH);

    await expect(claim?.suppressLegacy()).resolves.toBe(true);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();
  });

  it("blocks the overflow revision while the legacy handoff close is still opening", async () => {
    const close = deferred<void>();
    const fixture = productionFixture({ closeLegacy: () => close.promise });
    const attachment = fixture.production.attach(fixture.authority, fixture.source, () => true);
    for (let revision = 2; revision <= 258; revision += 1) {
      fixture.production.observe(attachment!, insertion(revision, 10, "x"));
    }
    const claim = fixture.production.claimLegacyChange(PATH);
    expect(claim?.revision).toBe(258);
    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.legacyOpen).not.toHaveBeenCalled();

    close.resolve();
    const suppressLegacy = await claim?.suppressLegacy();
    expect({
      legacyOpenCalls: fixture.legacyOpen.mock.calls.length,
      ownsLifecycle: fixture.production.ownsLifecycle(PATH),
      suppressLegacy,
    }).toEqual({
      legacyOpenCalls: 1,
      ownsLifecycle: false,
      suppressLegacy: false,
    });
    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.legacyOpen).toHaveBeenCalledOnce();
  });
});

class FakeIncrementalGateway implements IncrementalLanguageServerDocumentSyncGateway {
  readonly changeRequests: BoundedLanguageServerDidChangeRequest[] = [];
  readonly closeRequests: BoundedLanguageServerDidCloseRequest[] = [];
  readonly openRequests: BoundedLanguageServerDidOpenRequest[] = [];
  readonly openResults: BoundedLanguageServerDidOpenReceipt[] = [];
  close: (
    request: BoundedLanguageServerDidCloseRequest,
  ) => Promise<BoundedLanguageServerDocumentSyncReceipt> = async () => ({
    kind: "admitted",
  });
  change: (
    request: BoundedLanguageServerDidChangeRequest,
  ) => Promise<BoundedLanguageServerDocumentSyncReceipt> = async () => ({
    kind: "admitted",
  });

  async didChange(
    request: BoundedLanguageServerDidChangeRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    this.changeRequests.push(request);
    return this.change(request);
  }

  didClose(
    request: BoundedLanguageServerDidCloseRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    this.closeRequests.push(request);
    return this.close(request);
  }

  async didOpen(
    request: BoundedLanguageServerDidOpenRequest,
  ): Promise<BoundedLanguageServerDidOpenReceipt> {
    this.openRequests.push(request);
    return (
      this.openResults.shift() ?? {
        kind: "admitted",
        lifecycleToken: "lifecycle-1",
      }
    );
  }
}

function productionFixture(
  options: {
    closeLegacy?: () => Promise<void>;
    freshRuntimeAuthority?: boolean;
    gateway?: FakeIncrementalGateway;
    gatewayTimeoutMs?: number;
    initialText?: string;
    publishLegacyFallback?: (content: string) => boolean;
  } = {},
) {
  const authority = groupAuthority();
  const gateway = options.gateway ?? new FakeIncrementalGateway();
  const runtimeAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority = {
    capability: CAPABILITY,
    rootPath: ROOT,
    sessionId: 7,
    syncGeneration: 3,
  };
  let currentRuntimeAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority | null =
    runtimeAuthority;
  const legacyOpen = vi.fn(async () => undefined);
  const model = {};
  let text = options.initialText ?? "0123456789";
  const source: EditorJavaScriptTypeScriptIncrementalSyncSource = {
    alternativeVersionId: 1,
    captureCurrentContent: vi.fn(() => text),
    currentUtf16Length: () => text.length,
    languageId: "typescript",
    model,
    modelId: PATH,
    ...(options.publishLegacyFallback
      ? { publishLegacyFallback: options.publishLegacyFallback }
      : {}),
    utf16Length: text.length,
    versionId: 1,
  };
  const legacyClose = vi.fn(options.closeLegacy ?? (async () => undefined));
  const production = new JavaScriptTypeScriptIncrementalSyncProductionCoordinator(
    new JavaScriptTypeScriptIncrementalSyncService(
      new IncrementalDocumentSyncCoordinator(),
      gateway,
      {
        debounceMs: 1,
        gatewayTimeoutMs: options.gatewayTimeoutMs,
      },
    ),
    {
      current: () =>
        currentRuntimeAuthority && options.freshRuntimeAuthority
          ? { ...currentRuntimeAuthority }
          : currentRuntimeAuthority,
      isCurrent: (candidate) =>
        !!currentRuntimeAuthority &&
        candidate.rootPath === currentRuntimeAuthority.rootPath &&
        candidate.sessionId === currentRuntimeAuthority.sessionId &&
        candidate.syncGeneration === currentRuntimeAuthority.syncGeneration &&
        candidate.capability.changeKind === currentRuntimeAuthority.capability.changeKind &&
        candidate.capability.openClose === currentRuntimeAuthority.capability.openClose &&
        candidate.capability.save.kind === currentRuntimeAuthority.capability.save.kind &&
        (candidate.capability.save.kind !== "supported" ||
          (currentRuntimeAuthority.capability.save.kind === "supported" &&
            candidate.capability.save.includeText ===
              currentRuntimeAuthority.capability.save.includeText)),
    },
    {
      close: legacyClose,
      open: legacyOpen,
    },
  );
  return {
    authority,
    current: true,
    gateway,
    legacyClose,
    legacyOpen,
    production,
    runtimeAuthority,
    setRuntimeAuthority: (value: JavaScriptTypeScriptIncrementalRuntimeAuthority | null) => {
      currentRuntimeAuthority = value;
    },
    source,
    setText: (value: string) => {
      text = value;
    },
  };
}

function groupAuthority(path = PATH): EditorGroupDocumentSessionAuthority {
  const store = new DocumentSessionStore();
  const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
  const document: EditorDocument = {
    content: "0123456789",
    language: "typescript",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    savedContent: "0123456789",
  };
  expect(
    sidecar.activateOwner(
      {
        canonicalRoot: ROOT,
        ownerKey: createEditorSessionOwnerKey("workspace", ROOT),
        rootPath: ROOT,
        workspaceId: "workspace",
      },
      (_rootPath, candidatePath) =>
        candidatePath === path
          ? createRegisteredDocumentSaveIdentity("workspace", ROOT, path.slice(ROOT.length + 1))
          : null,
      { [path]: document },
    ),
  ).toBe(true);
  const lifecycle = sidecar.resolveLifecycle(path);
  const authority = lifecycle
    ? sidecar.createGroupAuthority(lifecycle, "editor-main", path, Object.freeze({}))
    : null;
  if (!authority) throw new Error("Expected exact editor authority");
  return authority;
}

function insertion(versionId: number, offset: number, text: string) {
  return {
    alternativeVersionId: versionId,
    changes: [
      {
        range: {
          endColumn: offset + 1,
          endLineNumber: 1,
          startColumn: offset + 1,
          startLineNumber: 1,
        },
        rangeLength: 0,
        rangeOffset: offset,
        text,
      },
    ],
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    versionId,
  };
}

function lifecycleLease(production: JavaScriptTypeScriptIncrementalSyncProductionCoordinator) {
  const lease = production.requestLifecycleLease(PATH);
  if (!lease) throw new Error("Expected exact incremental lifecycle lease");
  return lease;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settlePromise) => {
    resolve = settlePromise;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
