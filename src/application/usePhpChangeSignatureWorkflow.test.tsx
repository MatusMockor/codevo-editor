// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type { PhpChangeSignatureDocument } from "../domain/phpChangeSignature";
import { usePhpChangeSignatureWorkflow } from "./usePhpChangeSignatureWorkflow";
import type { PhpChangeSignatureWorkflowPorts } from "./phpChangeSignatureWorkflow";

const firstRoot = "/workspace-one";
const secondRoot = "/workspace-two";
const firstPath = `${firstRoot}/Service.php`;
const secondPath = `${secondRoot}/Service.php`;
const source =
  "<?php final class Service { public function total(int $count): int { return $count; } }";
const offset = source.indexOf("total");

describe("usePhpChangeSignatureWorkflow", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => host.remove());

  it("ignores an older prepare result after another project opens", async () => {
    let currentRoot = firstRoot;
    const documents = new Map<string, PhpChangeSignatureDocument>([
      [firstPath, phpDocument(firstPath)],
      [secondPath, phpDocument(secondPath)],
    ]);
    const firstReferences = deferred<ReturnType<typeof location>[]>();
    const secondReferences = deferred<ReturnType<typeof location>[]>();
    const ports = portsFor({
      currentRoot: () => currentRoot,
      documents,
      references: (rootPath) =>
        rootPath === firstRoot
          ? firstReferences.promise
          : secondReferences.promise,
    });
    const harness = renderWorkflow(host, ports);

    let firstOpen!: Promise<void>;
    await act(async () => {
      firstOpen = harness.current.open({
        offset,
        path: firstPath,
        rootPath: firstRoot,
      });
      await Promise.resolve();
    });
    currentRoot = secondRoot;
    let secondOpen!: Promise<void>;
    await act(async () => {
      secondOpen = harness.current.open({
        offset,
        path: secondPath,
        rootPath: secondRoot,
      });
      secondReferences.resolve([location(secondPath)]);
      await secondOpen;
    });
    expect(harness.current.state.error).toBeNull();
    expect(harness.current.state.rows).toHaveLength(1);

    await act(async () => {
      firstReferences.resolve([location(firstPath)]);
      await firstOpen;
    });
    expect(harness.current.state.error).toBeNull();
    expect(harness.current.state.rows).toHaveLength(1);
    await harness.unmount();
  });

  it("allows only one apply operation while React is scheduling state", async () => {
    const documents = new Map<string, PhpChangeSignatureDocument>([
      [firstPath, phpDocument(firstPath)],
    ]);
    const applied = deferred<{ kind: "accepted" }>();
    const applyWorkspaceEdit = vi.fn().mockReturnValue(applied.promise);
    const harness = renderWorkflow(
      host,
      portsFor({
        applyWorkspaceEdit,
        currentRoot: () => firstRoot,
        documents,
        references: async () => [location(firstPath)],
      }),
    );

    await act(async () => {
      await harness.current.open({
        offset,
        path: firstPath,
        rootPath: firstRoot,
      });
    });
    let firstApply!: Promise<void>;
    let secondApply!: Promise<void>;
    await act(async () => {
      firstApply = harness.current.apply();
      secondApply = harness.current.apply();
      await Promise.resolve();
    });
    expect(applyWorkspaceEdit).toHaveBeenCalledOnce();
    applied.resolve({ kind: "accepted" });
    await act(async () => {
      await Promise.all([firstApply, secondApply]);
    });
    expect(harness.current.state.isOpen).toBe(false);
    await harness.unmount();
  });

  it("cancels an open preview when an affected buffer changes", async () => {
    const documents = new Map<string, PhpChangeSignatureDocument>([
      [firstPath, phpDocument(firstPath)],
    ]);
    let changed!: (paths: readonly string[]) => void;
    const harness = renderWorkflow(
      host,
      portsFor({
        currentRoot: () => firstRoot,
        documents,
        references: async () => [location(firstPath)],
        subscribeChangedDocuments: (listener) => {
          changed = listener;
          return () => undefined;
        },
      }),
    );

    await act(async () => {
      await harness.current.open({
        offset,
        path: firstPath,
        rootPath: firstRoot,
      });
    });
    expect(harness.current.state.isOpen).toBe(true);
    act(() => changed([firstPath]));
    expect(harness.current.state.isOpen).toBe(false);
    await harness.unmount();
  });

  it("cancels an open preview after a project switch", async () => {
    let currentRoot = firstRoot;
    const documents = new Map<string, PhpChangeSignatureDocument>([
      [firstPath, phpDocument(firstPath)],
    ]);
    const harness = renderWorkflow(
      host,
      portsFor({
        currentRoot: () => currentRoot,
        documents,
        references: async () => [location(firstPath)],
      }),
    );

    await act(async () => {
      await harness.current.open({
        offset,
        path: firstPath,
        rootPath: firstRoot,
      });
    });
    currentRoot = secondRoot;
    await harness.rerender();
    expect(harness.current.state.isOpen).toBe(false);
    await harness.unmount();
  });

  it("cancels an open preview when workspace trust is revoked", async () => {
    let trusted = true;
    const documents = new Map<string, PhpChangeSignatureDocument>([
      [firstPath, phpDocument(firstPath)],
    ]);
    const basePorts = portsFor({
      currentRoot: () => firstRoot,
      documents,
      references: async () => [location(firstPath)],
    });
    const harness = renderWorkflow(host, {
      ...basePorts,
      isWorkspaceTrusted: () => trusted,
    });

    await act(async () => {
      await harness.current.open({
        offset,
        path: firstPath,
        rootPath: firstRoot,
      });
    });
    trusted = false;
    await harness.rerender();
    expect(harness.current.state.isOpen).toBe(false);
    expect(harness.current.state.rows).toEqual([]);
    await harness.unmount();
  });
});

function renderWorkflow(
  host: HTMLDivElement,
  ports: PhpChangeSignatureWorkflowPorts,
) {
  const root = createRoot(host);
  let current!: ReturnType<typeof usePhpChangeSignatureWorkflow>;
  function Harness() {
    current = usePhpChangeSignatureWorkflow(ports);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    get current() {
      return current;
    },
    async unmount() {
      await act(async () => root.unmount());
    },
    async rerender() {
      await act(async () => root.render(<Harness />));
    },
  };
}

function portsFor(options: {
  applyWorkspaceEdit?: PhpChangeSignatureWorkflowPorts["applyWorkspaceEdit"];
  currentRoot(): string;
  documents: Map<string, PhpChangeSignatureDocument>;
  references(
    rootPath: string,
  ): ReturnType<
    PhpChangeSignatureWorkflowPorts["languageServer"]["references"]
  >;
  subscribeChangedDocuments?: PhpChangeSignatureWorkflowPorts["subscribeChangedDocuments"];
}): PhpChangeSignatureWorkflowPorts {
  return {
    applyWorkspaceEdit:
      options.applyWorkspaceEdit ??
      (async () => ({ kind: "accepted" as const })),
    currentRootPath: options.currentRoot,
    flushDocument: async () => undefined,
    getOpenDocument: (path) => options.documents.get(path) ?? null,
    isWorkspaceTrusted: () => true,
    isReferenceIndexComplete: () => true,
    languageServer: {
      references: (rootPath) => options.references(rootPath),
    },
    notifyClosedDocumentsChanged: async () => undefined,
    readClosedDocument: async () => null,
    searchReferencePaths: async (rootPath) => ({
      complete: true,
      paths: [...options.documents.keys()].filter(
        (path) => path === rootPath || path.startsWith(`${rootPath}/`),
      ),
    }),
    subscribeChangedDocuments:
      options.subscribeChangedDocuments ?? (() => () => undefined),
  };
}

function phpDocument(path: string): PhpChangeSignatureDocument {
  return { content: source, path, version: 1 };
}

function location(path: string) {
  return {
    range: {
      end: { character: offset + 5, line: 0 },
      start: { character: offset, line: 0 },
    },
    uri: fileUriFromPath(path),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
