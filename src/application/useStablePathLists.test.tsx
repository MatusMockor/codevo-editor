// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useStableDocumentPaths, useStableNavigationHistoryPaths } from "./useStablePathLists";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useStableDocumentPaths", () => {
  it("preserves its result identity while only document objects change", () => {
    const harness = renderDocumentPathsHook([
      { content: "first", path: "/workspace/first.ts" },
      { content: "second", path: "/workspace/second.ts" },
    ]);
    const initialPaths = harness.result();

    harness.rerender([
      { content: "changed", path: "/workspace/first.ts" },
      { content: "second", path: "/workspace/second.ts" },
    ]);

    expect(harness.result()).toBe(initialPaths);
    expect(harness.result()).toEqual(["/workspace/first.ts", "/workspace/second.ts"]);
    harness.unmount();
  });

  it("replaces its result when the ordered document paths change", () => {
    const harness = renderDocumentPathsHook([{ path: "/workspace/first.ts" }]);
    const initialPaths = harness.result();

    harness.rerender([{ path: "/workspace/second.ts" }]);

    expect(harness.result()).not.toBe(initialPaths);
    expect(harness.result()).toEqual(["/workspace/second.ts"]);
    harness.unmount();
  });
});

describe("useStableNavigationHistoryPaths", () => {
  it("deduplicates paths and preserves identity for equivalent history", () => {
    const harness = renderNavigationHistoryPathsHook(
      [{ path: "/workspace/first.ts" }, { path: "/workspace/second.ts" }],
      [{ path: "/workspace/first.ts" }],
    );
    const initialPaths = harness.result();

    harness.rerender(
      [
        { path: "/workspace/first.ts" },
        { path: "/workspace/second.ts" },
        { path: "/workspace/first.ts" },
      ],
      [],
    );

    expect(harness.result()).toBe(initialPaths);
    expect(harness.result()).toEqual(["/workspace/first.ts", "/workspace/second.ts"]);
    harness.unmount();
  });
});

interface PathValue {
  content?: string;
  path: string;
}

function renderDocumentPathsHook(initialDocuments: readonly PathValue[]) {
  let documents = initialDocuments;
  let result: string[] = [];
  const root = createRoot(appendContainer());

  function Harness() {
    result = useStableDocumentPaths(documents);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    result: () => result,
    rerender(nextDocuments: readonly PathValue[]) {
      documents = nextDocuments;
      act(() => root.render(<Harness />));
    },
    unmount: () => act(() => root.unmount()),
  };
}

function renderNavigationHistoryPathsHook(
  initialBackStack: readonly PathValue[],
  initialForwardStack: readonly PathValue[],
) {
  let backStack = initialBackStack;
  let forwardStack = initialForwardStack;
  let result: string[] = [];
  const root = createRoot(appendContainer());

  function Harness() {
    result = useStableNavigationHistoryPaths(backStack, forwardStack);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    result: () => result,
    rerender(nextBackStack: readonly PathValue[], nextForwardStack: readonly PathValue[]) {
      backStack = nextBackStack;
      forwardStack = nextForwardStack;
      act(() => root.render(<Harness />));
    },
    unmount: () => act(() => root.unmount()),
  };
}

function appendContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}
