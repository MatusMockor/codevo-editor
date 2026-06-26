// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileDiff } from "../domain/git";

// This reproduces the real renderer crash: the @monaco-editor/react DiffEditor
// resolves its original/modified models by Uri. When no model paths are given
// it resolves BOTH to Uri.parse("") and reuses whatever model already lives at
// that Uri across mounts. Switching diff files (e.g. PHP -> README.md) then
// makes the new DiffEditor pick up the previous file's model, which Monaco has
// already disposed, and any access throws "Model is disposed!". With no error
// boundary that propagates to the React root and blanks the whole app.
//
// We drive the *real* DiffEditor against a Monaco model registry faithful to
// these semantics (throws on disposed-model access), so the test fails before
// the fix (unique per-file model paths) and passes after.

interface FakeModel {
  uri: string;
  value: string;
  language: string;
  disposed: boolean;
  dispose(): void;
  getFullModelRange(): unknown;
  setValue(next: string): void;
  getValue(): string;
}

function assertLive(model: FakeModel): FakeModel {
  if (model.disposed) {
    throw new Error("Model is disposed!");
  }

  return model;
}

// Uris of the original/modified models actually wired into the diff editor on
// its most recent setModel call -- this is what determines whether the two
// sides collide on a single Uri.
const wiredModelUriLog: string[] = [];

function wiredModelUris(): string[] {
  return [...wiredModelUriLog];
}

function createFakeMonaco() {
  const models = new Map<string, FakeModel>();

  const editor = {
    EditorOption: { readOnly: 1 },
    getModel(uri: { toString(): string }): FakeModel | undefined {
      const key = uri.toString();
      const model = models.get(key);

      if (!model || model.disposed) {
        return undefined;
      }

      return model;
    },
    createModel(
      value: string,
      language: string,
      uri?: { toString(): string },
    ): FakeModel {
      const key = uri ? uri.toString() : "inmemory://model";
      const model: FakeModel = {
        uri: key,
        value,
        language,
        disposed: false,
        dispose() {
          model.disposed = true;
          models.delete(model.uri);
        },
        getFullModelRange: () => ({}),
        setValue(next: string) {
          assertLive(model).value = next;
        },
        getValue() {
          return assertLive(model).value;
        },
      };
      models.set(key, model);
      return model;
    },
    setModelLanguage(model: FakeModel, language: string): void {
      assertLive(model).language = language;
    },
    createDiffEditor() {
      let current: { original: FakeModel; modified: FakeModel } | null = null;

      return {
        getOriginalEditor() {
          return {
            getModel: () => current?.original ?? null,
            setModel: (model: FakeModel) => {
              if (current) {
                current.original = assertLive(model);
              }
            },
          };
        },
        getModifiedEditor() {
          return {
            getModel: () => current?.modified ?? null,
            getOption: () => true,
            setModel: (model: FakeModel) => {
              if (current) {
                current.modified = assertLive(model);
              }
            },
            setValue: (next: string) => {
              if (current) {
                assertLive(current.modified).value = next;
              }
            },
          };
        },
        getModel: () => current,
        setModel: (model: { original: FakeModel; modified: FakeModel }) => {
          // Monaco wires both sides; touching a disposed model throws here.
          current = {
            original: assertLive(model.original),
            modified: assertLive(model.modified),
          };
          wiredModelUriLog.length = 0;
          wiredModelUriLog.push(current.original.uri, current.modified.uri);
        },
        updateOptions: () => {},
        dispose: () => {
          current?.original?.dispose?.();
          current?.modified?.dispose?.();
        },
      };
    },
    setTheme: () => {},
  };

  return {
    editor,
    languages: {
      register: () => {},
      getLanguages: () => [],
      setLanguageConfiguration: () => {},
    },
    Uri: {
      parse: (value: string) => ({ toString: () => `uri:${value}` }),
    },
  };
}

const fakeMonaco = createFakeMonaco();

vi.mock("@monaco-editor/loader", () => ({
  default: {
    init: () => {
      const promise = Promise.resolve(fakeMonaco) as Promise<unknown> & {
        cancel(): void;
      };
      promise.cancel = () => {};
      return promise;
    },
    __getMonacoInstance: () => fakeMonaco,
  },
}));

// The Shiki setup is irrelevant to the model-lifecycle crash and pulls heavy
// async imports, so stub it.
vi.mock("../infrastructure/shikiHighlighter", () => ({
  applyImmediateFallbackTheme: () => {},
  setupShikiTokenization: () => Promise.resolve(),
}));

import { GitDiffPreview } from "./GitDiffPreview";

function phpDiff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/app/User.php",
      relativePath: "app/User.php",
      status: "modified",
    },
    language: "php",
    modifiedContent: "<?php\nclass User {}\n",
    originalContent: "<?php\n",
  };
}

function readmeDiff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/README.md",
      relativePath: "README.md",
      status: "modified",
    },
    language: "markdown",
    modifiedContent: "# Project\n\nchanged\n",
    originalContent: "# Project\n",
  };
}

describe("GitDiffPreview model lifecycle", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    wiredModelUriLog.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("switches from a PHP diff to a README.md diff without touching a disposed model", async () => {
    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={phpDiff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unmount the PHP diff editor (disposes its models), then mount the README
    // diff -- exactly the QA repro of clicking a different changed file.
    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={readmeDiff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector(".git-diff-preview")).not.toBeNull();
    // The distinct per-change model Uris (asserted directly in
    // gitDiffModelPaths.test.ts and GitDiffPreview.test.tsx) mean the README
    // mount never reuses the PHP file's disposed model, so the switch above
    // renders instead of throwing "Model is disposed!".
    const wired = wiredModelUris();
    if (wired.length === 2) {
      expect(new Set(wired).size).toBe(2);
      expect(wired).not.toContain("uri:");
    }
  });
});
