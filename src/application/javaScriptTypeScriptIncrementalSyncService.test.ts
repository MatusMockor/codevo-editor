import { describe, expect, it, vi } from "vitest";
import { normalizeDocumentSyncCapability } from "../domain/incrementalDocumentSync";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenRequest,
  BoundedLanguageServerDidOpenReceipt,
  BoundedLanguageServerDocumentSyncReceipt,
  IncrementalLanguageServerDocumentSyncGateway,
} from "../domain/incrementalLanguageServerDocumentSync";
import { IncrementalDocumentSyncCoordinator } from "./incrementalDocumentSyncCoordinator";
import {
  JavaScriptTypeScriptIncrementalSyncService,
  type JavaScriptTypeScriptIncrementalSyncAuthority,
  type JavaScriptTypeScriptIncrementalSyncBinding,
  type JavaScriptTypeScriptIncrementalSyncOpenRequest,
  type JavaScriptTypeScriptIncrementalSyncOpenResult,
  type JavaScriptTypeScriptIncrementalSyncScheduler,
  type JavaScriptTypeScriptIncrementalSyncServiceOptions,
} from "./javaScriptTypeScriptIncrementalSyncService";

class FakeGateway implements IncrementalLanguageServerDocumentSyncGateway {
  readonly calls: Array<{ readonly kind: "change" | "close" | "open"; readonly value: unknown }> =
    [];
  readonly changeResults: Array<BoundedLanguageServerDocumentSyncReceipt | Error> = [];
  readonly closeResults: Array<BoundedLanguageServerDocumentSyncReceipt | Error> = [];
  readonly openResults: Array<BoundedLanguageServerDidOpenReceipt | Error> = [];
  onChange: (() => void) | null = null;
  onClose:
    | ((
        request: BoundedLanguageServerDidCloseRequest,
      ) => Promise<BoundedLanguageServerDocumentSyncReceipt>)
    | null = null;
  onOpen:
    | ((
        request: BoundedLanguageServerDidOpenRequest,
      ) => Promise<BoundedLanguageServerDidOpenReceipt>)
    | null = null;
  private nextLifecycleToken = 1;

  async didChange(
    request: BoundedLanguageServerDidChangeRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    this.calls.push({ kind: "change", value: request });
    this.onChange?.();
    return result(this.changeResults.shift());
  }

  async didClose(
    request: BoundedLanguageServerDidCloseRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    this.calls.push({ kind: "close", value: request });
    if (this.onClose) return this.onClose(request);
    return result(this.closeResults.shift());
  }

  async didOpen(
    request: BoundedLanguageServerDidOpenRequest,
  ): Promise<BoundedLanguageServerDidOpenReceipt> {
    this.calls.push({ kind: "open", value: request });
    if (this.onOpen) return this.onOpen(request);
    const queued = this.openResults.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return {
      kind: "admitted",
      lifecycleToken: `lifecycle-${this.nextLifecycleToken++}`,
    };
  }
}

class ManualScheduler implements JavaScriptTypeScriptIncrementalSyncScheduler {
  private readonly queued = new Set<() => void>();

  schedule(callback: () => void): () => void {
    this.queued.add(callback);
    return () => this.queued.delete(callback);
  }

  flush(): void {
    const callbacks = [...this.queued];
    this.queued.clear();
    callbacks.forEach((callback) => callback());
  }
}

describe("JavaScriptTypeScriptIncrementalSyncService", () => {
  it("coalesces 100 ordered edits and suppresses legacy only after one admitted batch", async () => {
    const scheduler = new ManualScheduler();
    const gateway = new FakeGateway();
    const read = vi.fn(() => "never");
    const service = subject(gateway, scheduler);
    const opened = await service.open(openRequest({ read }));
    const binding = requireBinding(opened);
    const decisions = Array.from({ length: 100 }, (_, index) =>
      service.acceptChange(binding, insertion(index + 2, 10 + index, index + 1)),
    );

    expect(gateway.calls.filter(({ kind }) => kind === "change")).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
    scheduler.flush();
    await expect(service.drainBeforeSave(binding, 101)).resolves.toEqual({
      revision: 101,
      serverVersion: 2,
      status: "incremental-accepted",
    });
    await expect(Promise.all(decisions)).resolves.toEqual(
      Array.from({ length: 100 }, (_, index) => ({
        revision: index + 2,
        serverVersion: 2,
        status: "incremental-accepted",
      })),
    );

    const changes = gateway.calls.filter(({ kind }) => kind === "change");
    expect(changes).toHaveLength(1);
    const request = changes[0]?.value as BoundedLanguageServerDidChangeRequest;
    expect(request.change).toMatchObject({ kind: "incremental", version: 2 });
    if (request.change.kind !== "incremental") throw new Error("Expected incremental envelope");
    expect(request.change.changes).toHaveLength(100);
    expect(request.change.changes.map(({ text }) => text)).toEqual(
      Array.from({ length: 100 }, (_, index) => String((index + 1) % 10)),
    );
    expect(request.authority).not.toHaveProperty("modelId");
    expect(request.authority.modelIncarnation).toMatch(/^js-ts-model-\d+$/);
    expect(request.authority.lifecycleToken).toBe("lifecycle-1");
    expect(binding).not.toHaveProperty("lifecycleToken");
    expect(read).not.toHaveBeenCalled();
  });

  it.each([1, 2, 4])(
    "joins %i panes on one model, one open, and one exact revision",
    async (paneCount) => {
      const scheduler = new ManualScheduler();
      const gateway = new FakeGateway();
      const service = subject(gateway, scheduler);
      const model = {};
      const requests = Array.from({ length: paneCount }, () =>
        service.open(openRequest({ model })),
      );
      const bindings = (await Promise.all(requests)).map(requireBinding);

      const decisions = bindings.map((binding) =>
        service.acceptChange(binding, insertion(2, 10, 1)),
      );
      await service.drainBeforeSave(bindings[0]!, 2);
      expect(await Promise.all(decisions)).toEqual(
        Array.from({ length: paneCount }, () => ({
          revision: 2,
          serverVersion: 2,
          status: "incremental-accepted",
        })),
      );
      expect(gateway.calls.filter(({ kind }) => kind === "open")).toHaveLength(1);
      expect(gateway.calls.filter(({ kind }) => kind === "change")).toHaveLength(1);

      for (const binding of bindings.slice(0, -1)) {
        await expect(service.release(binding)).resolves.toEqual({
          channel: "retained",
          status: "released",
        });
        await expect(service.acceptChange(binding, insertion(3, 11, 2))).resolves.toEqual({
          reason: "shared-lifecycle",
          revision: 3,
          status: "suppressed",
        });
        await expect(service.drainBeforeSave(binding, 2)).resolves.toEqual({
          reason: "shared-lifecycle",
          revision: 2,
          status: "suppressed",
        });
      }
      expect(gateway.calls.filter(({ kind }) => kind === "close")).toHaveLength(0);
      await service.release(bindings[bindings.length - 1]!);
      expect(gateway.calls.filter(({ kind }) => kind === "close")).toHaveLength(1);
    },
  );

  it("retires one stale joined holder without disabling the current shared model", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    const model = {};
    let firstCurrent = true;
    const first = requireBinding(
      await service.open(openRequest({ isCurrent: () => firstCurrent, model })),
    );
    const second = requireBinding(await service.open(openRequest({ model })));
    firstCurrent = false;

    await expect(service.acceptChange(first, insertion(2, 10, 1))).resolves.toEqual({
      reason: "shared-lifecycle",
      revision: 2,
      status: "suppressed",
    });
    const accepted = service.acceptChange(second, insertion(2, 10, 1));
    await service.drainBeforeSave(second, 2);
    await expect(accepted).resolves.toMatchObject({ status: "incremental-accepted" });
    await expect(service.acceptChange(second, insertion(2, 10, 1))).resolves.toEqual({
      revision: 2,
      serverVersion: 2,
      status: "incremental-accepted",
    });
    expect(gateway.calls.filter(({ kind }) => kind === "change")).toHaveLength(1);
  });

  it("suppresses a stale original opener when a joined exact holder keeps ownership", async () => {
    const gateway = new FakeGateway();
    const lateOpen = deferred<BoundedLanguageServerDidOpenReceipt>();
    gateway.onOpen = () => lateOpen.promise;
    const service = subject(gateway, new ManualScheduler());
    const model = {};
    let originalCurrent = true;
    const original = service.open(openRequest({ isCurrent: () => originalCurrent, model }));
    await Promise.resolve();
    const joined = service.open(openRequest({ model }));
    originalCurrent = false;
    lateOpen.resolve({ kind: "admitted", lifecycleToken: "shared-open" });

    await expect(original).resolves.toEqual({
      reason: "shared-lifecycle",
      status: "suppressed",
    });
    await expect(joined).resolves.toMatchObject({
      ownership: "incremental-lifecycle",
      status: "incremental",
    });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open"]);
  });

  it("suppresses stale joined save drain without closing the current peer", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    const model = {};
    let firstCurrent = true;
    const first = requireBinding(
      await service.open(openRequest({ isCurrent: () => firstCurrent, model })),
    );
    const second = requireBinding(await service.open(openRequest({ model })));
    firstCurrent = false;

    await expect(service.drainBeforeSave(first, 1)).resolves.toEqual({
      reason: "shared-lifecycle",
      revision: 1,
      status: "suppressed",
    });
    const accepted = service.acceptChange(second, insertion(2, 10, 1));
    await service.drainBeforeSave(second, 2);
    await expect(accepted).resolves.toMatchObject({ status: "incremental-accepted" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "change"]);
  });

  it("waits for exact close before fallback under reentrant authority loss", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    let reentrant = false;
    let checks = 0;
    const isCurrent = () => {
      if (!reentrant) return true;
      checks += 1;
      return checks === 1;
    };
    const recordBinding = requireBinding(await service.open(openRequest({ isCurrent, model: {} })));
    reentrant = true;
    checks = 0;

    await expect(service.acceptChange(recordBinding, insertion(2, 10, 1))).resolves.toMatchObject({
      status: "legacy-fallback",
    });
    expect(gateway.calls[gateway.calls.length - 1]?.kind).toBe("close");
  });

  it("suppresses an invalid save revision while the lifecycle remains owned", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    const binding = requireBinding(await service.open(openRequest()));

    await expect(service.drainBeforeSave(binding, 0)).resolves.toEqual({
      reason: "invalid-event",
      revision: 0,
      status: "suppressed",
    });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open"]);
  });

  it("rechecks the channel after a reentrant authority callback replaces it", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    let trigger = false;
    let checks = 0;
    let replacement: Promise<JavaScriptTypeScriptIncrementalSyncOpenResult> | null = null;
    const isCurrent = () => {
      if (trigger) {
        checks += 1;
        if (checks === 2) {
          replacement = service.open(
            openRequest({
              authority: authority({
                documentIncarnation: "reentrant-replacement",
                ownerGeneration: 2,
              }),
              model: {},
            }),
          );
        }
      }
      return true;
    };
    const binding = requireBinding(await service.open(openRequest({ isCurrent })));
    trigger = true;

    await expect(service.acceptChange(binding, insertion(2, 10, 1))).resolves.toMatchObject({
      status: "legacy-fallback",
    });
    expect(replacement).not.toBeNull();
    await expect(replacement!).resolves.toMatchObject({ status: "incremental" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "close", "open"]);
  });

  it("fails old A closed across A to B to A and model replacement", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    const firstA = requireBinding(
      await service.open(
        openRequest({
          authority: authority({ documentIncarnation: "doc-a-1", ownerGeneration: 1 }),
          model: {},
        }),
      ),
    );
    const b = requireBinding(
      await service.open(
        openRequest({
          authority: authority({
            documentIncarnation: "doc-b",
            ownerGeneration: 2,
            ownerIncarnation: "owner-b",
          }),
          model: {},
        }),
      ),
    );
    const nextA = requireBinding(
      await service.open(
        openRequest({
          authority: authority({
            documentIncarnation: "doc-a-2",
            ownerGeneration: 3,
            ownerIncarnation: "owner-a-2",
          }),
          model: {},
        }),
      ),
    );

    await expect(service.acceptChange(firstA, insertion(2, 10, 1))).resolves.toMatchObject({
      status: "legacy-fallback",
    });
    await expect(service.acceptChange(b, insertion(2, 10, 1))).resolves.toMatchObject({
      status: "legacy-fallback",
    });
    const nextDecision = service.acceptChange(nextA, insertion(2, 10, 1));
    await service.drainBeforeSave(nextA, 2);
    await expect(nextDecision).resolves.toEqual({
      revision: 2,
      serverVersion: 2,
      status: "incremental-accepted",
    });
    expect(gateway.calls.filter(({ kind }) => kind === "open")).toHaveLength(3);
    expect(
      gateway.calls
        .filter(({ kind }) => kind === "open")
        .map(
          ({ value }) => (value as BoundedLanguageServerDidOpenRequest).predecessorLifecycleToken,
        ),
    ).toEqual([null, "lifecycle-1", "lifecycle-2"]);
  });

  it("rolls back identical prepared bytes on throw and busy before admission", async () => {
    const gateway = new FakeGateway();
    gateway.changeResults.push(new Error("transport"), { kind: "busy" }, { kind: "admitted" });
    const service = subject(gateway, new ManualScheduler(), { maxBusyRetries: 3 });
    const binding = requireBinding(await service.open(openRequest()));
    const decision = service.acceptChange(binding, insertion(2, 10, 1));

    await service.drainBeforeSave(binding, 2);
    await expect(decision).resolves.toEqual({
      revision: 2,
      serverVersion: 2,
      status: "incremental-accepted",
    });
    const requests = gateway.calls
      .filter(({ kind }) => kind === "change")
      .map(({ value }) => value as BoundedLanguageServerDidChangeRequest);
    expect(requests).toHaveLength(3);
    expect(requests.map(({ change }) => change)).toEqual([
      requests[0]!.change,
      requests[0]!.change,
      requests[0]!.change,
    ]);
  });

  it("drains change before close and uses the admitted server version", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    const binding = requireBinding(await service.open(openRequest()));
    const decision = service.acceptChange(binding, insertion(2, 10, 1));

    await expect(service.drainBeforeSave(binding, 2)).resolves.toEqual({
      revision: 2,
      serverVersion: 2,
      status: "incremental-accepted",
    });
    await expect(service.closeDocument(binding)).resolves.toEqual({
      channel: "closed",
      status: "released",
    });
    await expect(decision).resolves.toMatchObject({ status: "incremental-accepted" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "change", "close"]);
    expect(gateway.calls[2]?.value).toMatchObject({
      authority: { lifecycleToken: "lifecycle-1" },
      version: 2,
    });

    const reopened = await service.open(
      openRequest({
        authority: authority({
          documentIncarnation: "document-reopened",
          ownerGeneration: 2,
          syncGeneration: 2,
        }),
        model: {},
      }),
    );
    expect(reopened.status).toBe("incremental");
    expect(gateway.calls[3]?.value).toMatchObject({
      predecessorLifecycleToken: "lifecycle-1",
    });
  });

  it("fails a late restart result closed and admits only the new sync generation", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    let oldCurrent = true;
    const old = requireBinding(
      await service.open(
        openRequest({
          authority: authority({ syncGeneration: 1 }),
          isCurrent: () => oldCurrent,
        }),
      ),
    );
    gateway.onChange = () => {
      oldCurrent = false;
    };
    const staleDecision = service.acceptChange(old, insertion(2, 10, 1));
    await service.drainBeforeSave(old, 2);
    await expect(staleDecision).resolves.toEqual({
      reason: "authority-stale",
      revision: 2,
      status: "legacy-fallback",
    });

    gateway.onChange = null;
    const current = requireBinding(
      await service.open(
        openRequest({
          authority: authority({
            documentIncarnation: "doc-restarted",
            ownerGeneration: 2,
            syncGeneration: 2,
          }),
          model: {},
        }),
      ),
    );
    const accepted = service.acceptChange(current, insertion(2, 10, 1));
    await service.drainBeforeSave(current, 2);
    await expect(accepted).resolves.toMatchObject({ status: "incremental-accepted" });
  });

  it("reads one EOL snapshot total even when the prepared transaction retries", async () => {
    const gateway = new FakeGateway();
    gateway.changeResults.push({ kind: "busy" }, { kind: "admitted" });
    const read = vi.fn(() => "complete snapshot");
    const service = subject(gateway, new ManualScheduler());
    const binding = requireBinding(
      await service.open(openRequest({ read, snapshotLength: "complete snapshot".length })),
    );
    const decision = service.acceptChange(binding, {
      ...insertion(2, 10, 1),
      isEolChange: true,
    });

    await service.drainBeforeSave(binding, 2);
    await expect(decision).resolves.toMatchObject({ status: "incremental-accepted" });
    expect(read).toHaveBeenCalledOnce();
    const changes = gateway.calls
      .filter(({ kind }) => kind === "change")
      .map(({ value }) => (value as BoundedLanguageServerDidChangeRequest).change);
    expect(changes).toEqual([
      { kind: "full", path: "/workspace/server.ts", text: "complete snapshot", version: 2 },
      { kind: "full", path: "/workspace/server.ts", text: "complete snapshot", version: 2 },
    ]);
  });

  it("serializes replacement behind a late didOpen and compensates it before reopen", async () => {
    const gateway = new FakeGateway();
    const lateOpen = deferred<BoundedLanguageServerDidOpenReceipt>();
    let openCount = 0;
    gateway.onOpen = async () => {
      openCount += 1;
      return openCount === 1
        ? lateOpen.promise
        : { kind: "admitted", lifecycleToken: "replacement-token" };
    };
    const service = subject(gateway, new ManualScheduler());
    const firstOpen = service.open(
      openRequest({
        authority: authority({ documentIncarnation: "late-a" }),
        model: {},
      }),
    );
    await Promise.resolve();
    const replacementOpen = service.open(
      openRequest({
        authority: authority({
          documentIncarnation: "replacement-b",
          ownerGeneration: 2,
          ownerIncarnation: "owner-b",
        }),
        model: {},
      }),
    );

    lateOpen.resolve({ kind: "admitted", lifecycleToken: "late-token" });
    await expect(firstOpen).resolves.toMatchObject({
      reason: "authority-stale",
      status: "legacy-fallback",
    });
    await expect(replacementOpen).resolves.toMatchObject({
      ownership: "incremental-lifecycle",
      status: "incremental",
    });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "close", "open"]);
    expect(gateway.calls[1]?.value).toMatchObject({
      authority: { lifecycleToken: "late-token" },
      version: 1,
    });
    expect(gateway.calls[2]?.value).toMatchObject({
      predecessorLifecycleToken: "late-token",
    });
  });

  it("compensates an admitted didOpen when authority becomes stale after await", async () => {
    const gateway = new FakeGateway();
    const lateOpen = deferred<BoundedLanguageServerDidOpenReceipt>();
    gateway.onOpen = () => lateOpen.promise;
    const service = subject(gateway, new ManualScheduler());
    let current = true;
    const opening = service.open(openRequest({ isCurrent: () => current }));
    await Promise.resolve();
    current = false;
    lateOpen.resolve({ kind: "admitted", lifecycleToken: "stale-after-await" });

    await expect(opening).resolves.toEqual({
      reason: "authority-stale",
      status: "legacy-fallback",
    });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "close"]);
    expect(gateway.calls[1]?.value).toMatchObject({
      authority: { lifecycleToken: "stale-after-await" },
    });
  });

  it("closes the exact incremental lifecycle after permanent change rejection", async () => {
    const gateway = new FakeGateway();
    gateway.changeResults.push({ kind: "staleAuthority" });
    const service = subject(gateway, new ManualScheduler(), { maxBusyRetries: 0 });
    const binding = requireBinding(await service.open(openRequest()));
    const decision = service.acceptChange(binding, insertion(2, 10, 1));

    await expect(service.drainBeforeSave(binding, 2)).resolves.toMatchObject({
      status: "legacy-fallback",
    });
    await expect(decision).resolves.toMatchObject({ status: "legacy-fallback" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "change", "close"]);
    expect(gateway.calls[2]?.value).toMatchObject({
      authority: { lifecycleToken: "lifecycle-1" },
      version: 1,
    });
  });

  it("keeps an uncertain close blocked and never issues a same-session reopen", async () => {
    const gateway = new FakeGateway();
    gateway.closeResults.push({ kind: "busy" }, { kind: "busy" });
    const service = subject(gateway, new ManualScheduler(), { maxBusyRetries: 0 });
    const binding = requireBinding(await service.open(openRequest()));

    await expect(service.closeDocument(binding)).resolves.toEqual({
      reason: "close-uncertain",
      status: "blocked",
    });
    await expect(
      service.open(
        openRequest({
          authority: authority({
            documentIncarnation: "replacement",
            ownerGeneration: 2,
          }),
          model: {},
        }),
      ),
    ).resolves.toEqual({ reason: "close-uncertain", status: "blocked" });
    expect(gateway.calls.filter(({ kind }) => kind === "open")).toHaveLength(1);

    await expect(
      service.open(
        openRequest({
          authority: authority({
            documentIncarnation: "replacement",
            ownerGeneration: 2,
          }),
          model: {},
        }),
      ),
    ).resolves.toMatchObject({
      ownership: "incremental-lifecycle",
      status: "incremental",
    });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual([
      "open",
      "close",
      "close",
      "close",
      "open",
    ]);
  });

  it("publishes blocked, never legacy fallback, when change and compensating close are uncertain", async () => {
    const gateway = new FakeGateway();
    gateway.changeResults.push({ kind: "staleAuthority" });
    gateway.closeResults.push({ kind: "busy" });
    const service = subject(gateway, new ManualScheduler(), { maxBusyRetries: 0 });
    const binding = requireBinding(await service.open(openRequest()));
    const decision = service.acceptChange(binding, insertion(2, 10, 1));

    const drain = service.drainBeforeSave(binding, 2);
    await expect(decision).resolves.toEqual({
      reason: "close-uncertain",
      revision: 2,
      status: "blocked",
    });
    await expect(drain).resolves.toMatchObject({ status: "blocked" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "change", "close"]);
  });

  it("shares one exact didClose across concurrent final release and document close", async () => {
    const gateway = new FakeGateway();
    const close = deferred<BoundedLanguageServerDocumentSyncReceipt>();
    gateway.onClose = () => close.promise;
    const service = subject(gateway, new ManualScheduler());
    const binding = requireBinding(await service.open(openRequest()));

    const documentClose = service.closeDocument(binding);
    const finalRelease = service.release(binding);
    await vi.waitFor(() => {
      expect(gateway.calls.filter(({ kind }) => kind === "close")).toHaveLength(1);
    });
    close.resolve({ kind: "admitted" });
    await expect(documentClose).resolves.toEqual({ channel: "closed", status: "released" });
    await expect(finalRelease).resolves.toEqual({ channel: "closed", status: "released" });
  });

  it("contains a throwing fallback snapshot and closes before authorizing legacy", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());
    const binding = requireBinding(
      await service.open(
        openRequest({
          read: () => {
            throw new Error("snapshot failed");
          },
        }),
      ),
    );
    const decision = service.acceptChange(binding, {
      ...insertion(2, 10, 1),
      isEolChange: true,
    });

    const drain = service.drainBeforeSave(binding, 2);
    await expect(decision).resolves.toEqual({
      reason: "gateway-rejected",
      revision: 2,
      status: "legacy-fallback",
    });
    await expect(drain).resolves.toMatchObject({ status: "legacy-fallback" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "close"]);
  });

  it("bounds configuration and compensates a didOpen that settles after its deadline", async () => {
    expect(
      () =>
        new JavaScriptTypeScriptIncrementalSyncService(
          new IncrementalDocumentSyncCoordinator(),
          new FakeGateway(),
          { maxChannels: 129 },
        ),
    ).toThrow(TypeError);

    vi.useFakeTimers();
    try {
      const gateway = new FakeGateway();
      const lateOpen = deferred<BoundedLanguageServerDidOpenReceipt>();
      gateway.onOpen = () => lateOpen.promise;
      const service = subject(gateway, new ManualScheduler(), { gatewayTimeoutMs: 1 });
      const opening = service.open(openRequest());
      await vi.advanceTimersByTimeAsync(1);
      await expect(opening).resolves.toEqual({
        reason: "close-uncertain",
        status: "blocked",
      });
      lateOpen.resolve({ kind: "admitted", lifecycleToken: "late-timeout-token" });
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "close"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats unmount during didOpen as stale and leaves no backend lifecycle open", async () => {
    const gateway = new FakeGateway();
    const lateOpen = deferred<BoundedLanguageServerDidOpenReceipt>();
    gateway.onOpen = () => lateOpen.promise;
    const service = subject(gateway, new ManualScheduler());
    let mounted = true;
    const opening = service.open(openRequest({ isCurrent: () => mounted }));
    await Promise.resolve();
    mounted = false;
    lateOpen.resolve({ kind: "admitted", lifecycleToken: "unmounted-token" });

    await expect(opening).resolves.toMatchObject({ status: "legacy-fallback" });
    expect(gateway.calls.map(({ kind }) => kind)).toEqual(["open", "close"]);
  });

  it("returns immediate legacy fallback for unsupported or inactive authorities", async () => {
    const gateway = new FakeGateway();
    const service = subject(gateway, new ManualScheduler());

    await expect(
      service.open(
        openRequest({
          capability: normalizeDocumentSyncCapability(1),
        }),
      ),
    ).resolves.toEqual({ reason: "unsupported", status: "legacy-fallback" });
    await expect(
      service.open(
        openRequest({
          isCurrent: () => false,
        }),
      ),
    ).resolves.toEqual({ reason: "authority-stale", status: "legacy-fallback" });
    expect(gateway.calls).toHaveLength(0);
  });
});

function subject(
  gateway: FakeGateway,
  scheduler: ManualScheduler,
  options: JavaScriptTypeScriptIncrementalSyncServiceOptions = {},
): JavaScriptTypeScriptIncrementalSyncService {
  return new JavaScriptTypeScriptIncrementalSyncService(
    new IncrementalDocumentSyncCoordinator(),
    gateway,
    { debounceMs: 1, scheduler, ...options },
  );
}

function openRequest(
  overrides: {
    readonly authority?: JavaScriptTypeScriptIncrementalSyncAuthority;
    readonly capability?: ReturnType<typeof normalizeDocumentSyncCapability>;
    readonly isCurrent?: () => boolean;
    readonly model?: object;
    readonly read?: () => string;
    readonly snapshotLength?: number;
  } = {},
): JavaScriptTypeScriptIncrementalSyncOpenRequest {
  return {
    alternativeVersionId: 1,
    authority: overrides.authority ?? authority(),
    capability:
      overrides.capability ??
      normalizeDocumentSyncCapability({
        change: 2,
        openClose: true,
        save: true,
      }),
    initialText: "0123456789",
    isCurrent: overrides.isCurrent ?? (() => true),
    languageId: "typescript",
    model: overrides.model ?? {},
    snapshotReader: {
      getUtf16Length: () => overrides.snapshotLength ?? 10,
      read: overrides.read ?? (() => "0123456789"),
    },
    utf16Length: 10,
    versionId: 1,
  };
}

function authority(
  overrides: Partial<JavaScriptTypeScriptIncrementalSyncAuthority> = {},
): JavaScriptTypeScriptIncrementalSyncAuthority {
  return {
    documentIncarnation: "document-1",
    expectedSessionId: 1,
    ownerGeneration: 1,
    ownerIncarnation: "owner-incarnation-1",
    ownerKey: "workspace-owner",
    path: "/workspace/server.ts",
    rootPath: "/workspace",
    syncGeneration: 1,
    ...overrides,
  };
}

function insertion(versionId: number, offset: number, digit: number) {
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
        text: String(digit % 10),
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

function requireBinding(
  result: JavaScriptTypeScriptIncrementalSyncOpenResult,
): JavaScriptTypeScriptIncrementalSyncBinding {
  if (result.status !== "incremental") throw new Error("Expected incremental binding");
  return result.binding;
}

function result(
  value: BoundedLanguageServerDocumentSyncReceipt | Error | undefined,
): BoundedLanguageServerDocumentSyncReceipt {
  if (value instanceof Error) throw value;
  return value ?? { kind: "admitted" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
