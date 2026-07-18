import { describe, expect, it, vi } from "vitest";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type { PhpChangeSignatureDocument } from "../domain/phpChangeSignature";
import { PhpChangeSignatureWorkflow } from "./phpChangeSignatureWorkflow";

const rootPath = "/workspace";
const declarationPath = "/workspace/src/Service.php";
const callPath = "/workspace/src/Caller.php";
const declarationSource =
  "<?php final class Service { public function total(int $count = 1): int { return $count; } }";
const callSource = "<?php $service->total(2);";

describe("PhpChangeSignatureWorkflow", () => {
  it("prepares, previews, and applies a versioned open-buffer transaction", async () => {
    const documents = documentMap();
    const applyWorkspaceEdit = vi.fn().mockResolvedValue({ kind: "accepted" });
    const workflow = new PhpChangeSignatureWorkflow({
      applyWorkspaceEdit,
      currentRootPath: () => rootPath,
      flushDocument: vi.fn().mockResolvedValue(undefined),
      getOpenDocument: (path) => documents.get(path) ?? null,
      isWorkspaceTrusted: () => true,
      isReferenceIndexComplete: () => true,
      notifyClosedDocumentsChanged: vi.fn(),
      readClosedDocument: async () => null,
      searchReferencePaths: async () => ({
        complete: true,
        paths: [...documents.keys()],
      }),
      subscribeChangedDocuments: () => () => undefined,
      languageServer: {
        references: vi
          .fn()
          .mockResolvedValue([
            location(declarationPath, declarationSource.indexOf("total")),
            location(callPath, callSource.indexOf("total")),
          ]),
      },
    });

    const prepared = await workflow.prepare({
      offset: declarationSource.indexOf("total"),
      path: declarationPath,
      rootPath,
    });
    expect("kind" in prepared).toBe(false);
    if ("kind" in prepared) return;

    const rows = prepared.rows.map((row) => ({ ...row, name: "items" }));
    const plan = workflow.plan(prepared, rows);
    expect(plan).toMatchObject({
      kind: "ready",
      preview: {
        filesChanged: 2,
        referencesChanged: 1,
        signature: "(int $items = 1)",
      },
    });
    await expect(workflow.apply(prepared, rows)).resolves.toEqual({
      kind: "applied",
    });
    expect(applyWorkspaceEdit).toHaveBeenCalledOnce();
  });

  it("applies a mixed open and closed transaction with a native hash precondition", async () => {
    const documents = documentMap();
    documents.delete(callPath);
    const applyWorkspaceEdit = vi.fn().mockResolvedValue({ kind: "accepted" });
    const notifyClosedDocumentsChanged = vi.fn();
    const workflow = new PhpChangeSignatureWorkflow({
      applyWorkspaceEdit,
      currentRootPath: () => rootPath,
      flushDocument: vi.fn(),
      getOpenDocument: (path) => documents.get(path) ?? null,
      isWorkspaceTrusted: () => true,
      isReferenceIndexComplete: () => true,
      notifyClosedDocumentsChanged,
      readClosedDocument: async (path) =>
        path === callPath
          ? {
              content: callSource,
              contentHash: "12345",
              path: callPath,
              version: null,
            }
          : null,
      searchReferencePaths: async () => ({
        complete: true,
        paths: [declarationPath, callPath],
      }),
      subscribeChangedDocuments: () => () => undefined,
      languageServer: {
        references: vi
          .fn()
          .mockResolvedValue([
            location(declarationPath, declarationSource.indexOf("total")),
            location(callPath, callSource.indexOf("total")),
          ]),
      },
    });

    const prepared = await workflow.prepare({
      offset: declarationSource.indexOf("total"),
      path: declarationPath,
      rootPath,
    });
    if ("kind" in prepared) throw new Error(prepared.message);
    await expect(workflow.apply(prepared, prepared.rows)).resolves.toEqual({
      kind: "applied",
    });
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      expect.anything(),
      rootPath,
      [declarationPath],
      { [callPath]: "12345" },
    );
    expect(notifyClosedDocumentsChanged).toHaveBeenCalledWith(rootPath, [
      callPath,
    ]);
  });

  it("rechecks the workspace and document versions before apply", async () => {
    let currentRoot = rootPath;
    const documents = documentMap();
    const workflow = new PhpChangeSignatureWorkflow({
      applyWorkspaceEdit: vi.fn(),
      currentRootPath: () => currentRoot,
      flushDocument: vi.fn(),
      getOpenDocument: (path) => documents.get(path) ?? null,
      isWorkspaceTrusted: () => true,
      isReferenceIndexComplete: () => true,
      notifyClosedDocumentsChanged: vi.fn(),
      readClosedDocument: async () => null,
      searchReferencePaths: async () => ({
        complete: true,
        paths: [...documents.keys()],
      }),
      subscribeChangedDocuments: () => () => undefined,
      languageServer: {
        references: vi
          .fn()
          .mockResolvedValue([
            location(declarationPath, declarationSource.indexOf("total")),
            location(callPath, callSource.indexOf("total")),
          ]),
      },
    });
    const prepared = await workflow.prepare({
      offset: declarationSource.indexOf("total"),
      path: declarationPath,
      rootPath,
    });
    if ("kind" in prepared) throw new Error("Expected prepared session");
    currentRoot = "/other";
    await expect(
      workflow.apply(prepared, prepared.rows),
    ).resolves.toMatchObject({ kind: "invalid" });
  });

  it("rejects prepare and apply when workspace trust is missing or revoked", async () => {
    let trusted = false;
    const documents = documentMap();
    const references = vi
      .fn()
      .mockResolvedValue([
        location(declarationPath, declarationSource.indexOf("total")),
        location(callPath, callSource.indexOf("total")),
      ]);
    const workflow = new PhpChangeSignatureWorkflow({
      applyWorkspaceEdit: vi.fn(),
      currentRootPath: () => rootPath,
      flushDocument: vi.fn(),
      getOpenDocument: (path) => documents.get(path) ?? null,
      isWorkspaceTrusted: () => trusted,
      isReferenceIndexComplete: () => true,
      notifyClosedDocumentsChanged: vi.fn(),
      readClosedDocument: async () => null,
      searchReferencePaths: async () => ({
        complete: true,
        paths: [...documents.keys()],
      }),
      subscribeChangedDocuments: () => () => undefined,
      languageServer: { references },
    });

    await expect(
      workflow.prepare({
        offset: declarationSource.indexOf("total"),
        path: declarationPath,
        rootPath,
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "untrustedWorkspace",
    });
    expect(references).not.toHaveBeenCalled();

    trusted = true;
    const prepared = await workflow.prepare({
      offset: declarationSource.indexOf("total"),
      path: declarationPath,
      rootPath,
    });
    if ("kind" in prepared) throw new Error("Expected prepared session");
    trusted = false;
    await expect(workflow.apply(prepared, prepared.rows)).resolves.toEqual({
      kind: "invalid",
      message: "Workspace trust changed. No files were modified.",
    });
  });

  it("rejects a declaration buffer changed while references load", async () => {
    const documents = documentMap();
    let resolveReferences!: (value: ReturnType<typeof location>[]) => void;
    const references = new Promise<ReturnType<typeof location>[]>((resolve) => {
      resolveReferences = resolve;
    });
    const workflow = new PhpChangeSignatureWorkflow({
      applyWorkspaceEdit: vi.fn(),
      currentRootPath: () => rootPath,
      flushDocument: vi.fn(),
      getOpenDocument: (path) => documents.get(path) ?? null,
      isWorkspaceTrusted: () => true,
      isReferenceIndexComplete: () => true,
      notifyClosedDocumentsChanged: vi.fn(),
      readClosedDocument: async () => null,
      searchReferencePaths: async () => ({
        complete: true,
        paths: [...documents.keys()],
      }),
      subscribeChangedDocuments: () => () => undefined,
      languageServer: { references: vi.fn().mockReturnValue(references) },
    });
    const preparing = workflow.prepare({
      offset: declarationSource.indexOf("total"),
      path: declarationPath,
      rootPath,
    });
    documents.set(declarationPath, {
      content: `${declarationSource}\n// changed`,
      path: declarationPath,
      version: 2,
    });
    resolveReferences([
      location(declarationPath, declarationSource.indexOf("total")),
    ]);

    await expect(preparing).resolves.toMatchObject({
      kind: "rejected",
      reason: "staleDocument",
    });
  });

  it("rejects discovery while the workspace index is incomplete", async () => {
    const documents = documentMap();
    const references = vi.fn();
    const workflow = new PhpChangeSignatureWorkflow({
      applyWorkspaceEdit: vi.fn(),
      currentRootPath: () => rootPath,
      flushDocument: vi.fn(),
      getOpenDocument: (path) => documents.get(path) ?? null,
      isWorkspaceTrusted: () => true,
      isReferenceIndexComplete: () => false,
      languageServer: { references },
      notifyClosedDocumentsChanged: vi.fn(),
      readClosedDocument: async () => null,
      searchReferencePaths: async () => ({ complete: true, paths: [] }),
      subscribeChangedDocuments: () => () => undefined,
    });

    await expect(
      workflow.prepare({
        offset: declarationSource.indexOf("total"),
        path: declarationPath,
        rootPath,
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "incompleteReferenceIndex",
    });
    expect(references).not.toHaveBeenCalled();
  });

  it("rejects virtual hierarchy methods without a completeness proof", async () => {
    const source = declarationSource.replace("final class", "class");
    const documents = new Map<string, PhpChangeSignatureDocument>([
      [declarationPath, { content: source, path: declarationPath, version: 1 }],
    ]);
    const workflow = workflowFor(documents, [
      locationFor(declarationPath, source, source.indexOf("total")),
    ]);

    await expect(
      workflow.prepare({
        offset: source.indexOf("total"),
        path: declarationPath,
        rootPath,
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "hierarchyAmbiguity",
    });
  });

  it("rejects callable arrays and other non-direct reference shapes", async () => {
    const callablePath = "/workspace/src/Callable.php";
    const callableSource = "<?php $callable = [Service::class, 'total'];";
    const documents = documentMap();
    documents.set(callablePath, {
      content: callableSource,
      path: callablePath,
      version: 1,
    });
    const workflow = workflowFor(documents, [
      location(declarationPath, declarationSource.indexOf("total")),
      location(callPath, callSource.indexOf("total")),
      locationFor(callablePath, callableSource, callableSource.indexOf("total")),
    ]);

    await expect(
      workflow.prepare({
        offset: declarationSource.indexOf("total"),
        path: declarationPath,
        rootPath,
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "dynamicOrAmbiguousReference",
    });
  });
});

function workflowFor(
  documents: Map<string, PhpChangeSignatureDocument>,
  references: ReturnType<typeof location>[],
) {
  return new PhpChangeSignatureWorkflow({
    applyWorkspaceEdit: vi.fn(),
    currentRootPath: () => rootPath,
    flushDocument: vi.fn(),
    getOpenDocument: (path) => documents.get(path) ?? null,
    isWorkspaceTrusted: () => true,
    isReferenceIndexComplete: () => true,
    languageServer: { references: vi.fn().mockResolvedValue(references) },
    notifyClosedDocumentsChanged: vi.fn(),
    readClosedDocument: async () => null,
    searchReferencePaths: async () => ({
      complete: true,
      paths: [...documents.keys()],
    }),
    subscribeChangedDocuments: () => () => undefined,
  });
}

function documentMap(): Map<string, PhpChangeSignatureDocument> {
  return new Map([
    [
      declarationPath,
      { content: declarationSource, path: declarationPath, version: 1 },
    ],
    [callPath, { content: callSource, path: callPath, version: 1 }],
  ]);
}

function location(path: string, offset: number) {
  const source = path === declarationPath ? declarationSource : callSource;
  const before = source.slice(0, offset).split("\n");
  const line = before.length - 1;
  const character = before[before.length - 1]?.length ?? 0;
  return {
    range: {
      start: { character, line },
      end: { character: character + 5, line },
    },
    uri: fileUriFromPath(path),
  };
}

function locationFor(path: string, source: string, offset: number) {
  const before = source.slice(0, offset).split("\n");
  const line = before.length - 1;
  const character = before[before.length - 1]?.length ?? 0;
  return {
    range: {
      start: { character, line },
      end: { character: character + 5, line },
    },
    uri: fileUriFromPath(path),
  };
}
