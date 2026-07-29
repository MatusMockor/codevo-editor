import { describe, expect, it } from "vitest";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenRequest,
} from "../domain/incrementalLanguageServerDocumentSync";
import {
  decodeBoundedDidOpenReceipt,
  decodeBoundedDocumentSyncReceipt,
  encodeBoundedLanguageServerDidChangeRequest,
  encodeBoundedLanguageServerDidCloseRequest,
  encodeBoundedLanguageServerDidOpenRequest,
  MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_COUNT,
  MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_TEXT_BYTES,
  MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF16_UNITS,
  MAX_BOUNDED_DOCUMENT_SYNC_PATH_BYTES,
  MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES,
} from "./tauriIncrementalLanguageServerDocumentSyncIpcContract";

describe("bounded language-server document-sync IPC contract", () => {
  it("deep-copies and freezes exact open, change, and close requests", () => {
    const open = openRequest("const value = 1;");
    const change = changeRequest(2);
    const close = closeRequest();

    const encodedOpen = encodeBoundedLanguageServerDidOpenRequest(open);
    const encodedChange = encodeBoundedLanguageServerDidChangeRequest(change);
    const encodedClose = encodeBoundedLanguageServerDidCloseRequest(close);

    expect(encodedOpen).not.toBe(open);
    expect(encodedOpen.authority).not.toBe(open.authority);
    expect(encodedOpen.predecessorLifecycleToken).toBeNull();
    expect(Object.isFrozen(encodedOpen)).toBe(true);
    expect(encodedChange.change.kind).toBe("incremental");
    if (encodedChange.change.kind !== "incremental") throw new Error("Expected incremental");
    expect(encodedChange.change.changes.map((item) => item.text)).toEqual(["0", "1"]);
    expect(Object.isFrozen(encodedChange.change.changes)).toBe(true);
    expect(encodedClose).toEqual(close);
    expect(Object.isFrozen(encodedClose)).toBe(true);
  });

  it.each([
    ["didOpen", encodeBoundedLanguageServerDidOpenRequest, openRequest("x")],
    ["didChange", encodeBoundedLanguageServerDidChangeRequest, changeRequest(1)],
    ["didClose", encodeBoundedLanguageServerDidCloseRequest, closeRequest()],
  ] as const)("rejects unknown outer and authority fields for %s", (_, encode, fixture) => {
    const unknownOuter = structuredClone(fixture) as unknown as Record<string, unknown>;
    unknownOuter.extra = true;
    expect(() => encode(unknownOuter as never)).toThrow(/request fields are malformed/);

    const unknownAuthority = structuredClone(fixture) as unknown as Record<string, unknown>;
    (unknownAuthority.authority as Record<string, unknown>).extra = true;
    expect(() => encode(unknownAuthority as never)).toThrow(/authority fields are malformed/);
  });

  it("accepts only the four JS/TS language identifiers", () => {
    for (const languageId of [
      "javascript",
      "javascriptreact",
      "typescript",
      "typescriptreact",
    ] as const) {
      expect(
        encodeBoundedLanguageServerDidOpenRequest({ ...openRequest("x"), languageId }),
      ).toMatchObject({ languageId });
    }
    expect(() =>
      encodeBoundedLanguageServerDidOpenRequest({
        ...openRequest("x"),
        languageId: "php" as "typescript",
      }),
    ).toThrow("languageId is unsupported");
  });

  it("bounds open and full-recovery text in UTF-16 units and UTF-8 bytes", () => {
    const exactUtf16 = "😀".repeat(MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF16_UNITS / 2);
    expect(encodeBoundedLanguageServerDidOpenRequest(openRequest(exactUtf16))).toBeTruthy();
    expect(() => encodeBoundedLanguageServerDidOpenRequest(openRequest(`${exactUtf16}x`))).toThrow(
      "full text exceeds",
    );

    const exactMultibyte = "€".repeat(MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF16_UNITS);
    expect(
      encodeBoundedLanguageServerDidChangeRequest(fullChangeRequest(exactMultibyte)),
    ).toBeTruthy();
    expect(() =>
      encodeBoundedLanguageServerDidChangeRequest(fullChangeRequest(`${exactMultibyte}x`)),
    ).toThrow("full text exceeds");

    expect(() => encodeBoundedLanguageServerDidOpenRequest(openRequest("\ud800"))).toThrow(
      "full text exceeds",
    );
    const malformedInsertion = mutableChangeRequest();
    malformedInsertion.change.changes[0]!.text = "\udc00";
    expect(() => encodeBoundedLanguageServerDidChangeRequest(malformedInsertion as never)).toThrow(
      "malformed or oversized",
    );
  });

  it("rejects high-only, low-only, and mixed unpaired surrogates but preserves a valid pair", () => {
    for (const text of ["\ud800", "\udc00", "a\ud800b\udc00c"]) {
      expect(() => encodeBoundedLanguageServerDidOpenRequest(openRequest(text))).toThrow(
        "full text exceeds",
      );
      const insertion = mutableChangeRequest();
      insertion.change.changes[0]!.text = text;
      expect(() => encodeBoundedLanguageServerDidChangeRequest(insertion as never)).toThrow(
        "malformed or oversized",
      );
    }

    const validPair = "\ud83d\ude00";
    expect(encodeBoundedLanguageServerDidOpenRequest(openRequest(validPair)).text).toBe(validPair);
    const insertion = mutableChangeRequest();
    insertion.change.changes[0]!.text = validPair;
    const encoded = encodeBoundedLanguageServerDidChangeRequest(insertion as never);
    expect(encoded.change.kind).toBe("incremental");
    if (encoded.change.kind === "incremental") {
      expect(encoded.change.changes[0]!.text).toBe(validPair);
    }
  });

  it("measures path and opaque authority token bounds in UTF-8 bytes", () => {
    const pathPrefix = "/workspace/";
    const pathBudget = MAX_BOUNDED_DOCUMENT_SYNC_PATH_BYTES - pathPrefix.length;
    expect(
      encodeBoundedLanguageServerDidCloseRequest({
        ...closeRequest(),
        path: `${pathPrefix}${"é".repeat(pathBudget / 2)}`,
      }),
    ).toBeTruthy();
    expect(() =>
      encodeBoundedLanguageServerDidCloseRequest({
        ...closeRequest(),
        path: `${pathPrefix}${"é".repeat(Math.floor(pathBudget / 2) + 1)}`,
      }),
    ).toThrow("path is not a valid bounded path");

    expect(() =>
      encodeBoundedLanguageServerDidOpenRequest({
        ...openRequest("x"),
        authority: {
          ...authority(),
          modelIncarnation: "😀".repeat(MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES / 4 + 1),
        },
      }),
    ).toThrow("modelIncarnation is not a valid bounded token");
  });

  it("requires a bounded server-issued lifecycle token only after didOpen", () => {
    const openWithForgedToken = structuredClone(openRequest("x")) as unknown as Record<
      string,
      unknown
    >;
    (openWithForgedToken.authority as Record<string, unknown>).lifecycleToken = "forged";
    expect(() => encodeBoundedLanguageServerDidOpenRequest(openWithForgedToken as never)).toThrow(
      "authority fields are malformed",
    );

    const missingToken = structuredClone(changeRequest(1)) as unknown as Record<string, unknown>;
    delete (missingToken.authority as Record<string, unknown>).lifecycleToken;
    expect(() => encodeBoundedLanguageServerDidChangeRequest(missingToken as never)).toThrow(
      "authority fields are malformed",
    );

    const oversizedToken = structuredClone(closeRequest()) as {
      authority: { lifecycleToken: string };
    } & BoundedLanguageServerDidCloseRequest;
    oversizedToken.authority.lifecycleToken = "é".repeat(
      MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES / 2 + 1,
    );
    expect(() => encodeBoundedLanguageServerDidCloseRequest(oversizedToken)).toThrow(
      "lifecycleToken is not a valid bounded token",
    );

    expect(
      encodeBoundedLanguageServerDidOpenRequest({
        ...openRequest("x"),
        predecessorLifecycleToken: "server-token-a",
      }),
    ).toMatchObject({ predecessorLifecycleToken: "server-token-a" });
    const missingPredecessor = structuredClone(openRequest("x")) as unknown as Record<
      string,
      unknown
    >;
    delete missingPredecessor.predecessorLifecycleToken;
    expect(() => encodeBoundedLanguageServerDidOpenRequest(missingPredecessor as never)).toThrow(
      "request fields are malformed",
    );
  });

  it("rejects stale/foreign-shaped authority, path, session, and version values", () => {
    const cases = [
      mutate(changeRequest(1), (value) => (value.expectedSessionId = 0)),
      mutate(changeRequest(1), (value) => (value.authority.syncGeneration = 0)),
      mutate(changeRequest(1), (value) => (value.change.path = "/foreign/a.ts")),
      mutate(closeRequest(), (value) => (value.version = 2_147_483_648)),
      mutate(openRequest("x"), (value) => (value.path = "relative.ts")),
      mutate(openRequest("x"), (value) => (value.rootPath = "relative")),
    ];
    for (const value of cases) {
      const operation =
        "change" in value
          ? encodeBoundedLanguageServerDidChangeRequest
          : "text" in value
            ? encodeBoundedLanguageServerDidOpenRequest
            : encodeBoundedLanguageServerDidCloseRequest;
      expect(() => operation(value as never)).toThrow(/^Invalid bounded language-server/);
    }
  });

  it("rejects malformed ranges, unknown nested fields, and oversized Unicode insertions", () => {
    const reversed = mutableChangeRequest();
    reversed.change.changes[0]!.range.start.line = 2;
    reversed.change.changes[0]!.range.end.line = 1;
    expect(() => encodeBoundedLanguageServerDidChangeRequest(reversed as never)).toThrow(
      "range is reversed",
    );

    const unknown = mutableChangeRequest();
    (unknown.change.changes[0]!.range as Record<string, unknown>).extra = true;
    expect(() => encodeBoundedLanguageServerDidChangeRequest(unknown as never)).toThrow(
      "range is malformed",
    );

    const oversized = mutableChangeRequest();
    oversized.change.changes[0]!.text = "ž".repeat(
      MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_TEXT_BYTES / 2 + 1,
    );
    expect(() => encodeBoundedLanguageServerDidChangeRequest(oversized as never)).toThrow(
      "malformed or oversized",
    );
  });

  it("accepts N incremental changes and rejects N+1", () => {
    expect(
      encodeBoundedLanguageServerDidChangeRequest(
        changeRequest(MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_COUNT),
      ),
    ).toBeTruthy();
    expect(() =>
      encodeBoundedLanguageServerDidChangeRequest(
        changeRequest(MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_COUNT + 1),
      ),
    ).toThrow("incremental change fields or count");
  });

  it.each([
    "admitted",
    "busy",
    "notOpen",
    "staleAuthority",
    "staleSession",
    "staleVersion",
  ] as const)("decodes and freezes the closed %s receipt", (kind) => {
    const receipt = decodeBoundedDocumentSyncReceipt({ kind });
    expect(receipt).toEqual({ kind });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("fails closed on malformed, expanded, or unknown receipts", () => {
    for (const value of [
      undefined,
      null,
      { kind: "unknown" },
      { kind: "admitted", extra: true },
      { kind: "busy", retryAfter: 1 },
    ]) {
      expect(() => decodeBoundedDocumentSyncReceipt(value)).toThrow("malformed receipt");
    }
  });

  it("decodes a bounded didOpen token and rejects missing, expanded, or oversized tokens", () => {
    expect(
      decodeBoundedDidOpenReceipt({
        kind: "admitted",
        lifecycleToken: "server-token-a",
      }),
    ).toEqual({ kind: "admitted", lifecycleToken: "server-token-a" });

    for (const value of [
      { kind: "admitted" },
      { kind: "admitted", lifecycleToken: "" },
      { kind: "admitted", lifecycleToken: "server-token-a", extra: true },
      {
        kind: "admitted",
        lifecycleToken: "é".repeat(MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES / 2 + 1),
      },
    ]) {
      expect(() => decodeBoundedDidOpenReceipt(value)).toThrow("malformed receipt");
    }
    expect(decodeBoundedDidOpenReceipt({ kind: "busy" })).toEqual({ kind: "busy" });
    expect(() => decodeBoundedDidOpenReceipt({ kind: "notOpen" })).toThrow("malformed receipt");
  });
});

function authority() {
  return {
    documentIncarnation: "document-a",
    modelIncarnation: "model-incarnation-a",
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

function openRequest(text: string): BoundedLanguageServerDidOpenRequest {
  return {
    authority: authority(),
    expectedSessionId: 7,
    languageId: "typescript",
    path: "/workspace/a.ts",
    predecessorLifecycleToken: null,
    rootPath: "/workspace",
    text,
    version: 1,
  };
}

function changeRequest(changeCount: number): BoundedLanguageServerDidChangeRequest {
  return {
    authority: lifecycleAuthority(),
    change: {
      changes: Array.from({ length: changeCount }, (_, index) => rangedChange(String(index))),
      kind: "incremental",
      path: "/workspace/a.ts",
      version: 2,
    },
    expectedSessionId: 7,
    rootPath: "/workspace",
  };
}

function fullChangeRequest(text: string): BoundedLanguageServerDidChangeRequest {
  return {
    ...changeRequest(1),
    change: { kind: "full", path: "/workspace/a.ts", text, version: 2 },
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

function rangedChange(text: string) {
  return {
    kind: "incremental" as const,
    range: {
      end: { character: 0, line: 0 },
      start: { character: 0, line: 0 },
    },
    rangeLength: 0,
    text,
  };
}

function mutableChangeRequest() {
  return structuredClone(changeRequest(1)) as unknown as {
    change: {
      changes: Array<{
        range: {
          end: { character: number; line: number };
          start: { character: number; line: number };
        };
        text: string;
      }>;
    };
  };
}

function mutate<T>(value: T, callback: (value: any) => void): T {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
