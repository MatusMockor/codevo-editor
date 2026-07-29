import { describe, expect, it, vi } from "vitest";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenRequest,
} from "../domain/incrementalLanguageServerDocumentSync";
import {
  BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS,
  TauriIncrementalLanguageServerDocumentSyncGateway,
} from "./tauriIncrementalLanguageServerDocumentSyncGateway";

describe("TauriIncrementalLanguageServerDocumentSyncGateway", () => {
  it("invokes the three static lifecycle commands with exact bounded requests", async () => {
    const invoke = vi.fn<InvokeCommand>(async (command) =>
      command === BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS.didOpen
        ? { kind: "admitted", lifecycleToken: "server-token-a" }
        : { kind: "admitted" },
    );
    const gateway = new TauriIncrementalLanguageServerDocumentSyncGateway(invoke, () => true);

    await expect(gateway.didOpen(openRequest())).resolves.toEqual({
      kind: "admitted",
      lifecycleToken: "server-token-a",
    });
    await expect(gateway.didChange(changeRequest())).resolves.toEqual({ kind: "admitted" });
    await expect(gateway.didClose(closeRequest())).resolves.toEqual({ kind: "admitted" });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS.didOpen,
      BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS.didChange,
      BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS.didClose,
    ]);
    for (const [, args] of invoke.mock.calls) {
      expect(Object.keys(args)).toEqual(["request"]);
      expect(args.request).toMatchObject({
        authority: { modelIncarnation: "model-a" },
        expectedSessionId: 7,
        rootPath: "/workspace",
      });
    }
    expect(
      (invoke.mock.calls[0]![1].request as BoundedLanguageServerDidOpenRequest).authority,
    ).not.toHaveProperty("lifecycleToken");
    expect(
      (invoke.mock.calls[1]![1].request as BoundedLanguageServerDidChangeRequest).authority,
    ).toHaveProperty("lifecycleToken", "server-token-a");
  });

  it("validates every request before checking runtime availability or invoking", async () => {
    const invoke = vi.fn<InvokeCommand>(async () => ({ kind: "admitted" }));
    const gateway = new TauriIncrementalLanguageServerDocumentSyncGateway(invoke, () => false);
    const malformed = {
      ...changeRequest(),
      authority: { ...authority(), unexpected: true },
    };

    await expect(gateway.didChange(malformed as never)).rejects.toThrow(
      "authority fields are malformed",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns staleSession outside Tauri without leaking a request", async () => {
    const invoke = vi.fn<InvokeCommand>(async () => ({ kind: "admitted" }));
    const gateway = new TauriIncrementalLanguageServerDocumentSyncGateway(invoke, () => false);

    await expect(gateway.didOpen(openRequest())).resolves.toEqual({ kind: "staleSession" });
    await expect(gateway.didChange(changeRequest())).resolves.toEqual({
      kind: "staleSession",
    });
    await expect(gateway.didClose(closeRequest())).resolves.toEqual({
      kind: "staleSession",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["busy", "notOpen", "staleAuthority", "staleSession", "staleVersion"] as const)(
    "preserves the closed %s failure receipt",
    async (kind) => {
      const gateway = new TauriIncrementalLanguageServerDocumentSyncGateway(
        vi.fn(async () => ({ kind })),
        () => true,
      );
      await expect(gateway.didChange(changeRequest())).resolves.toEqual({ kind });
    },
  );

  it("fails closed on malformed backend responses and propagates transport errors", async () => {
    const malformed = new TauriIncrementalLanguageServerDocumentSyncGateway(
      vi.fn(async () => ({ ok: true })),
      () => true,
    );
    await expect(malformed.didOpen(openRequest())).rejects.toThrow("malformed receipt");

    const missingToken = new TauriIncrementalLanguageServerDocumentSyncGateway(
      vi.fn(async () => ({ kind: "admitted" })),
      () => true,
    );
    await expect(missingToken.didOpen(openRequest())).rejects.toThrow("malformed receipt");

    const transportFailure = new Error("IPC unavailable");
    const rejected = new TauriIncrementalLanguageServerDocumentSyncGateway(
      vi.fn(async () => {
        throw transportFailure;
      }),
      () => true,
    );
    await expect(rejected.didClose(closeRequest())).rejects.toBe(transportFailure);
  });

  it("keeps close/reopen model incarnations and sync generations distinct", async () => {
    let openCount = 0;
    const invoke = vi.fn<InvokeCommand>(async (command) => {
      if (command !== BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS.didOpen) {
        return { kind: "admitted" };
      }
      openCount += 1;
      return { kind: "admitted", lifecycleToken: `server-token-${openCount}` };
    });
    const gateway = new TauriIncrementalLanguageServerDocumentSyncGateway(invoke, () => true);
    const first = openRequest();
    const close = closeRequest();
    const reopened = {
      ...openRequest(),
      authority: {
        ...first.authority,
        modelIncarnation: "model-b",
        syncGeneration: first.authority.syncGeneration + 1,
      },
      predecessorLifecycleToken: "server-token-1",
    };

    await gateway.didOpen(first);
    await gateway.didClose(close);
    await gateway.didOpen(reopened);

    expect(
      invoke.mock.calls.map(([, args]) => {
        const request = args.request as BoundedLanguageServerDidOpenRequest;
        return [request.authority.modelIncarnation, request.authority.syncGeneration];
      }),
    ).toEqual([
      ["model-a", 3],
      ["model-a", 3],
      ["model-b", 4],
    ]);
  });
});

function authority() {
  return {
    documentIncarnation: "document-a",
    modelIncarnation: "model-a",
    ownerGeneration: 2,
    ownerIncarnation: "owner-a",
    ownerKey: "workspace-a",
    syncGeneration: 3,
  };
}

function lifecycleAuthority() {
  return {
    ...authority(),
    lifecycleToken: "server-token-a",
  };
}

function openRequest(): BoundedLanguageServerDidOpenRequest {
  return {
    authority: authority(),
    expectedSessionId: 7,
    languageId: "typescript",
    path: "/workspace/a.ts",
    predecessorLifecycleToken: null,
    rootPath: "/workspace",
    text: "const value = 1;",
    version: 1,
  };
}

function changeRequest(): BoundedLanguageServerDidChangeRequest {
  return {
    authority: lifecycleAuthority(),
    change: {
      changes: [
        {
          kind: "incremental",
          range: {
            end: { character: 0, line: 0 },
            start: { character: 0, line: 0 },
          },
          rangeLength: 0,
          text: "x",
        },
      ],
      kind: "incremental",
      path: "/workspace/a.ts",
      version: 2,
    },
    expectedSessionId: 7,
    rootPath: "/workspace",
  };
}

function closeRequest(): BoundedLanguageServerDidCloseRequest {
  return {
    authority: lifecycleAuthority(),
    expectedSessionId: 7,
    path: "/workspace/a.ts",
    rootPath: "/workspace",
    version: 2,
  };
}

type InvokeCommand = (command: string, args: { readonly request: unknown }) => Promise<unknown>;
