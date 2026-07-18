import { describe, expect, it } from "vitest";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type { PhpChangeSignatureDocument } from "../domain/phpChangeSignature";
import { PhpChangeSignatureTransaction } from "./phpChangeSignatureTransaction";

const ROOT = "/project";
const DECLARATION_PATH = `${ROOT}/src/Service.php`;
const CALL_PATH = `${ROOT}/src/Use.php`;
const declarationContent = "<?php function send(string $to): void {}";
const callContent = "<?php send('a@b.test');";

describe("PhpChangeSignatureTransaction", () => {
  it("builds a previewed, versioned workspace edit", () => {
    const documents = docs();
    const transaction = PhpChangeSignatureTransaction.plan({
      declaration: {
        offset: declarationContent.indexOf("send"),
        path: DECLARATION_PATH,
        role: "declaration",
      },
      documents,
      parameters: [{ declaration: "string $recipient", sourceName: "to" }],
      references: [
        { offset: callContent.indexOf("send"), path: CALL_PATH, role: "call" },
      ],
      resolution: completeResolution,
      rootPath: ROOT,
    });
    expect(transaction).toBeInstanceOf(PhpChangeSignatureTransaction);
    if (!(transaction instanceof PhpChangeSignatureTransaction)) return;
    expect(transaction.preview).toMatchObject({
      filesChanged: 2,
      referencesChanged: 1,
    });

    const result = transaction.commit({
      currentOpenDocuments: documents,
      currentRootPath: ROOT,
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.action.workspaceRoot).toBe(ROOT);
    expect(result.action.workspaceEdit?.documentVersions).toEqual({
      [fileUriFromPath(DECLARATION_PATH)]: 3,
      [fileUriFromPath(CALL_PATH)]: 7,
    });
  });

  it("rejects project switches and stale dirty buffers", () => {
    const documents = docs();
    const transaction = planned(documents);
    expect(
      transaction.commit({
        currentOpenDocuments: documents,
        currentRootPath: "/other",
      }),
    ).toEqual({ kind: "rejected", reason: "inactiveWorkspace" });
    expect(
      transaction.commit({
        currentOpenDocuments: documents.map((document) =>
          document.path === CALL_PATH
            ? {
                ...document,
                content: `${document.content}\n// dirty`,
                version: 8,
              }
            : document,
        ),
        currentRootPath: ROOT,
      }),
    ).toEqual({ kind: "rejected", reason: "staleDocument" });
  });

  it.each([
    ["content", { content: `${callContent}\n// dirty`, version: 7 }],
    ["version", { content: callContent, version: 8 }],
  ])("rejects stale %s independently", (_label, replacement) => {
    const documents = docs();
    const transaction = planned(documents);
    expect(
      transaction.commit({
        currentOpenDocuments: documents.map((document) =>
          document.path === CALL_PATH
            ? { ...document, ...replacement }
            : document,
        ),
        currentRootPath: ROOT,
      }),
    ).toEqual({ kind: "rejected", reason: "staleDocument" });
  });

  it("rejects a document closed between preview and commit", () => {
    const documents = docs();
    const transaction = planned(documents);
    expect(
      transaction.commit({
        currentOpenDocuments: documents.filter(
          (document) => document.path !== CALL_PATH,
        ),
        currentRootPath: ROOT,
      }),
    ).toEqual({ kind: "rejected", reason: "staleDocument" });
  });

  it("keeps the captured preview immutable until commit", () => {
    const documents = docs();
    const transaction = planned(documents);
    const originalEdits = [...transaction.preview.edits];

    expect(() => {
      (transaction.preview.edits as Array<(typeof originalEdits)[number]>).push(
        {
          end: 1,
          path: DECLARATION_PATH,
          start: 0,
          text: "corrupt",
          version: 3,
        },
      );
    }).toThrow();

    const result = transaction.commit({
      currentOpenDocuments: documents,
      currentRootPath: ROOT,
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.preview.edits).toEqual(originalEdits);
  });

  it("rejects incomplete or ambiguous semantic reference discovery", () => {
    const documents = docs();
    for (const resolution of [
      { complete: false, dynamicOrAmbiguous: false },
      { complete: true, dynamicOrAmbiguous: true },
    ]) {
      expect(
        PhpChangeSignatureTransaction.plan({
          declaration: {
            offset: declarationContent.indexOf("send"),
            path: DECLARATION_PATH,
            role: "declaration",
          },
          documents,
          parameters: [{ declaration: "string $recipient", sourceName: "to" }],
          references: [],
          resolution,
          rootPath: ROOT,
        }),
      ).toEqual({ kind: "rejected", reason: "incompleteReferenceSet" });
    }
  });

  it.each([
    [`${ROOT}/vendor/acme/Package.php`, "vendor"],
    ["/other/Service.php", "outside root"],
    [`${ROOT}/src/Service.txt`, "non-PHP"],
  ])("rejects %s targets (%s)", (path) => {
    const document = { content: declarationContent, path, version: 1 };
    expect(
      PhpChangeSignatureTransaction.plan({
        declaration: {
          offset: declarationContent.indexOf("send"),
          path,
          role: "declaration",
        },
        documents: [document],
        parameters: [{ declaration: "string $to", sourceName: "to" }],
        references: [],
        resolution: completeResolution,
        rootPath: ROOT,
      }),
    ).toEqual({ kind: "rejected", reason: "unsupportedTarget" });
  });

  it("emits a hash precondition for a closed file", () => {
    const documents = docs().map((document) =>
      document.path === CALL_PATH
        ? { ...document, contentHash: "456", version: null }
        : document,
    );
    const transaction = planned(documents);
    const result = transaction.commit({
      currentOpenDocuments: documents.filter(
        (document) => document.version !== null,
      ),
      currentRootPath: ROOT,
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.expectedClosedFileHashes).toEqual({ [CALL_PATH]: "456" });
    expect(result.action.workspaceEdit?.documentVersions).toEqual({
      [fileUriFromPath(DECLARATION_PATH)]: 3,
    });
  });

  it("rejects a closed file without a native hash", () => {
    const documents = docs().map((document) =>
      document.path === CALL_PATH ? { ...document, version: null } : document,
    );
    expect(plannedResult(documents)).toEqual({
      kind: "rejected",
      reason: "unversionedDocument",
    });
  });

  it("rejects conflicting aliases for the same document", () => {
    const documents = [
      ...docs(),
      {
        content: `${callContent}\n// conflicting alias`,
        path: `file://${CALL_PATH}`,
        version: 7,
      },
    ];
    expect(
      PhpChangeSignatureTransaction.plan({
        declaration: {
          offset: declarationContent.indexOf("send"),
          path: DECLARATION_PATH,
          role: "declaration",
        },
        documents,
        parameters: [{ declaration: "string $recipient", sourceName: "to" }],
        references: [
          {
            offset: callContent.indexOf("send"),
            path: CALL_PATH,
            role: "call",
          },
        ],
        resolution: completeResolution,
        rootPath: ROOT,
      }),
    ).toEqual({ kind: "rejected", reason: "unsupportedTarget" });
  });
});

const completeResolution = { complete: true, dynamicOrAmbiguous: false };

function docs(): PhpChangeSignatureDocument[] {
  return [
    { content: declarationContent, path: DECLARATION_PATH, version: 3 },
    { content: callContent, path: CALL_PATH, version: 7 },
  ];
}

function plannedResult(documents: readonly PhpChangeSignatureDocument[]) {
  return PhpChangeSignatureTransaction.plan({
    declaration: {
      offset: declarationContent.indexOf("send"),
      path: DECLARATION_PATH,
      role: "declaration",
    },
    documents,
    parameters: [{ declaration: "string $recipient", sourceName: "to" }],
    references: [
      { offset: callContent.indexOf("send"), path: CALL_PATH, role: "call" },
    ],
    resolution: completeResolution,
    rootPath: ROOT,
  });
}

function planned(documents: readonly PhpChangeSignatureDocument[]) {
  const result = plannedResult(documents);
  if (!(result instanceof PhpChangeSignatureTransaction))
    throw new Error("Expected transaction");
  return result;
}
