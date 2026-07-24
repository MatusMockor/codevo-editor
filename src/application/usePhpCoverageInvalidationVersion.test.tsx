// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument, WorkspaceFileRevision } from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  usePhpCloverCoverage,
  type PhpCloverCoveragePortResult,
  type PhpCloverCoverageState,
} from "./usePhpCloverCoverage";
import {
  createPhpTestCoverageInvalidationStore,
  type PhpTestCoverageInvalidationStore,
} from "./phpTestCoverageInvalidationStore";
import {
  useOpenPhpDocumentCoverageVersion,
  usePhpCoverageInvalidationVersion,
} from "./usePhpCoverageInvalidationVersion";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cleanups = new Set<() => void>();

afterEach(() => {
  for (const cleanup of [...cleanups]) cleanup();
});

describe("useOpenPhpDocumentCoverageVersion", () => {
  it("advances for content and revision changes, but not opening or closing", () => {
    const hook = renderOpenDocuments([]);
    expect(hook.current()).toBe(0);

    hook.render([document()]);
    expect(hook.current()).toBe(0);
    hook.render([document({ content: "<?php // dirty" })]);
    expect(hook.current()).toBe(1);
    hook.render([
      document({
        content: "<?php // dirty",
        revision: revision({ contentHash: "saved" }),
        savedContent: "<?php // dirty",
      }),
    ]);
    expect(hook.current()).toBe(2);
    hook.render([]);
    expect(hook.current()).toBe(2);
    hook.render([document({ content: "<?php // reopened", savedContent: "<?php // reopened" })]);
    expect(hook.current()).toBe(2);
  });

  it("ignores non-PHP document mutations", () => {
    const hook = renderOpenDocuments([document({ language: "typescript" })]);
    hook.render([document({ content: "changed", language: "typescript" })]);
    expect(hook.current()).toBe(0);
  });
});

describe("usePhpCoverageInvalidationVersion", () => {
  it("combines file changes, open-document mutations, and run requests monotonically", () => {
    const fileChangeStore = createPhpTestCoverageInvalidationStore();
    const hook = renderCombined({
      documents: [document()],
      fileChangeStore,
      runRequestVersion: 7,
    });
    expect(hook.current()).toBe(0);

    hook.render({
      documents: [document({ content: "<?php // edit" })],
      fileChangeStore,
      runRequestVersion: 7,
    });
    expect(hook.current()).toBe(1);
    act(() => {
      fileChangeStore.handleWorkspaceFileChange(fileChange("src/Changed.php"));
    });
    expect(hook.current()).toBe(2);
    hook.render({
      documents: [document({ content: "<?php // edit" })],
      fileChangeStore,
      runRequestVersion: 8,
    });
    expect(hook.current()).toBe(3);
  });

  it("rejects a pending report when an open PHP document is edited", async () => {
    const pending = deferred<PhpCloverCoveragePortResult>();
    const port = { runAndReadReport: vi.fn(() => pending.promise) };
    const fileChangeStore = createPhpTestCoverageInvalidationStore();
    const root = createRoot(window.document.createElement("div"));
    const owner = createWorkspaceRuntimeOwner("workspace", "/workspace");
    let documents: readonly EditorDocument[] = [document()];
    let coverage!: PhpCloverCoverageState;
    function Harness() {
      const invalidationVersion = usePhpCoverageInvalidationVersion({
        documents,
        fileChangeStore,
        runRequestVersion: 0,
      });
      coverage = usePhpCloverCoverage({
        invalidationVersion,
        isWorkspaceCurrent: (candidate) => candidate === owner,
        port,
        workspaceOwner: owner,
        workspaceTrusted: true,
      });
      return null;
    }
    const render = () => act(() => root.render(<Harness />));
    const unmount = () => {
      cleanups.delete(unmount);
      act(() => root.unmount());
    };
    cleanups.add(unmount);
    render();
    let running!: Promise<boolean>;
    act(() => {
      running = coverage.run();
    });
    await vi.waitFor(() => expect(port.runAndReadReport).toHaveBeenCalledOnce());

    documents = [document({ content: "<?php // edited" })];
    render();
    pending.resolve({
      content:
        '<coverage><project><file name="/workspace/src/Home.php"><line num="1" count="1"/></file></project></coverage>',
      status: "ok",
    });

    await act(async () => expect(await running).toBe(false));
    expect(coverage.report).toBeNull();
  });

  it("does not resurrect a published report after edit then save-clean", async () => {
    const port = {
      runAndReadReport: vi.fn(async () => ({
        content:
          '<coverage><project><file name="/workspace/src/Home.php"><line num="1" type="stmt" count="1"/></file></project></coverage>',
        status: "ok" as const,
      })),
    };
    const fileChangeStore = createPhpTestCoverageInvalidationStore();
    const root = createRoot(window.document.createElement("div"));
    const owner = createWorkspaceRuntimeOwner("workspace", "/workspace");
    let documents: readonly EditorDocument[] = [document()];
    let coverage!: PhpCloverCoverageState;
    function Harness() {
      coverage = usePhpCloverCoverage({
        invalidationVersion: usePhpCoverageInvalidationVersion({
          documents,
          fileChangeStore,
          runRequestVersion: 0,
        }),
        isWorkspaceCurrent: (candidate) => candidate === owner,
        port,
        workspaceOwner: owner,
        workspaceTrusted: true,
      });
      return null;
    }
    const render = () => act(() => root.render(<Harness />));
    const unmount = () => {
      cleanups.delete(unmount);
      act(() => root.unmount());
    };
    cleanups.add(unmount);
    render();
    await act(async () => expect(await coverage.run()).toBe(true));
    expect(coverage.report).not.toBeNull();

    documents = [document({ content: "<?php // edited" })];
    render();
    expect(coverage.report).toBeNull();
    documents = [
      document({
        content: "<?php // edited",
        revision: revision({ contentHash: "saved-edit" }),
        savedContent: "<?php // edited",
      }),
    ];
    render();
    expect(coverage.report).toBeNull();
  });
});

function renderOpenDocuments(initial: readonly EditorDocument[]) {
  return renderHook(initial, (documents) => useOpenPhpDocumentCoverageVersion(documents));
}

function renderCombined(initial: {
  readonly documents: readonly EditorDocument[];
  readonly fileChangeStore: PhpTestCoverageInvalidationStore;
  readonly runRequestVersion: number;
}) {
  return renderHook(initial, usePhpCoverageInvalidationVersion);
}

function renderHook<Props, Value>(initial: Props, useValue: (props: Props) => Value) {
  const root = createRoot(window.document.createElement("div"));
  let current: Value | undefined;
  function Harness({ value }: { readonly value: Props }) {
    current = useValue(value);
    return null;
  }
  const render = (value: Props) => act(() => root.render(<Harness value={value} />));
  const unmount = () => {
    cleanups.delete(unmount);
    act(() => root.unmount());
  };
  cleanups.add(unmount);
  render(initial);
  return {
    current: () => {
      if (current === undefined) throw new Error("hook not mounted");
      return current;
    },
    render,
  };
}

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "<?php",
    language: "php",
    name: "Home.php",
    path: "/workspace/src/Home.php",
    savedContent: "<?php",
    ...overrides,
  };
}

function revision(overrides: Partial<WorkspaceFileRevision> = {}): WorkspaceFileRevision {
  return {
    contentHash: "initial",
    device: "1",
    inode: "2",
    modifiedNanoseconds: 0,
    modifiedSeconds: 1,
    size: 5,
    ...overrides,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fileChange(relativePath: string) {
  return {
    kind: "modified" as const,
    path: `/workspace/${relativePath}`,
    relativePath,
    rootPath: "/workspace",
  };
}
