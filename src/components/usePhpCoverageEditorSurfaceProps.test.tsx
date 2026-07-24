// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PhpCloverCoverageReport } from "../domain/phpCloverCoverage";
import type { EditorDocument } from "../domain/workspace";
import { usePhpCoverageEditorSurfaceProps } from "./usePhpCoverageEditorSurfaceProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const report: PhpCloverCoverageReport = {
  files: [
    {
      firstUncoveredLine: 8,
      lines: [
        { hits: 2, lineNumber: 2 },
        { hits: 0, lineNumber: 8 },
      ],
      path: "src/HomePresenter.php",
      summary: { covered: 1, percentage: 50, total: 2 },
    },
  ],
  summary: { covered: 1, percentage: 50, total: 2 },
};
const document: EditorDocument = {
  content: "<?php",
  language: "php",
  name: "HomePresenter.php",
  path: "/workspace/src/HomePresenter.php",
  savedContent: "<?php",
};
const cleanups = new Set<() => void>();

afterEach(() => {
  for (const cleanup of [...cleanups]) cleanup();
});

function renderHook(initialReport: PhpCloverCoverageReport | null) {
  const container = window.document.createElement("div");
  const root = createRoot(container);
  let current: ReturnType<typeof usePhpCoverageEditorSurfaceProps> | undefined;

  function Harness({ value }: { readonly value: PhpCloverCoverageReport | null }) {
    current = usePhpCoverageEditorSurfaceProps({
      report: value,
      rootPath: "/workspace",
      workspaceId: "workspace-id",
    });
    return null;
  }

  const render = (value: PhpCloverCoverageReport | null) =>
    act(() => root.render(<Harness value={value} />));
  const unmount = () => {
    cleanups.delete(unmount);
    act(() => root.unmount());
  };
  cleanups.add(unmount);
  render(initialReport);
  return {
    current: () => {
      if (!current) throw new Error("hook not mounted");
      return current;
    },
    render,
  };
}

describe("usePhpCoverageEditorSurfaceProps", () => {
  it("publishes only a clean active reported document under workspace ownership", () => {
    const hook = renderHook(report);
    const publication = hook.current()(document, true);

    expect(publication).toEqual({
      phpCoverageActiveOwner: {
        ownerKey: '["workspace-id","/workspace"]',
        revision: 1,
      },
      phpCoveragePublication: {
        documentPath: "/workspace/src/HomePresenter.php",
        lines: [
          { hits: 2, lineNumber: 2, status: "covered" },
          { hits: 0, lineNumber: 8, status: "uncovered" },
        ],
        ownerKey: '["workspace-id","/workspace"]',
        revision: 1,
      },
    });
    expect(hook.current()(document, false).phpCoveragePublication).toBeNull();
    expect(
      hook.current()({ ...document, content: "<?php // dirty" }, true).phpCoveragePublication,
    ).toBeNull();
  });

  it("increments the revision only when report identity changes, including clear", () => {
    const hook = renderHook(report);
    const revision = () => hook.current()(document, true).phpCoverageActiveOwner?.revision;

    expect(revision()).toBe(1);
    hook.render(report);
    expect(revision()).toBe(1);
    hook.render({ ...report });
    expect(revision()).toBe(2);
    hook.render(null);
    expect(hook.current()(document, true).phpCoveragePublication).toBeNull();
    hook.render(report);
    expect(revision()).toBe(4);
  });
});
