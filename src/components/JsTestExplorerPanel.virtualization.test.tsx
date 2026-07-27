// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import { buildJsTestExplorerTree } from "../domain/jsTestExplorerTree";
import type { TestGutterTarget } from "../domain/testGutterTargets";
import { JsTestCoverageReportView } from "./JsTestCoverageReport";
import { JsTestExplorerVirtualizedTree } from "./JsTestExplorerVirtualizedTree";

describe("large JavaScript test and coverage projections", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders fewer than 50 tree rows for 20k tests and keeps end navigation accessible", async () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      Array.from({ length: 20_000 }, (_, index) => ({
        filePath: "src/large.test.ts",
        suitePath: ["large"],
        target: target(`case ${String(index).padStart(5, "0")}`, index + 1),
      })),
      "workspace-a",
    );

    await act(async () => {
      root.render(
        <JsTestExplorerVirtualizedTree
          debugDisabled={false}
          disabled={false}
          onDebugNode={vi.fn()}
          onOpenTest={vi.fn()}
          onRunScope={vi.fn()}
          root={tree}
          rootPath="/workspace"
        />,
      );
    });

    const renderedRows = host.querySelectorAll('[role="treeitem"]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(50);
    const first = renderedRows.item(0) as HTMLElement;
    expect(first.getAttribute("aria-level")).toBe("1");
    expect(first.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      first.focus();
      first.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
      await nextFrame();
    });

    const last = host.querySelector<HTMLElement>('[aria-label="Test case 19999"]');
    expect(last).not.toBeNull();
    expect(last?.getAttribute("aria-level")).toBe("4");
    expect(document.activeElement).toBe(last);
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeLessThan(50);
  });

  it("renders fewer than 50 coverage files for a 20k-file report and supports Home/End", async () => {
    const files = Array.from({ length: 20_000 }, (_, index) => ({
      branches: { covered: 1, percentage: 100, total: 1 },
      firstUncoveredLine: 1,
      functions: { covered: 1, percentage: 100, total: 1 },
      lines: [{ hits: 1, lineNumber: 1 }],
      path: `src/file-${String(index).padStart(5, "0")}.ts`,
      summary: { covered: 1, percentage: 100, total: 1 },
    }));
    const report: JsTestCoverageReport = {
      branches: { covered: 20_000, percentage: 100, total: 20_000 },
      files,
      functions: { covered: 20_000, percentage: 100, total: 20_000 },
      summary: { covered: 20_000, percentage: 100, total: 20_000 },
      truncated: false,
    };

    await act(async () => {
      root.render(<JsTestCoverageReportView onOpenFile={vi.fn()} report={report} />);
    });

    const list = host.querySelector('[aria-label="JavaScript coverage files"]');
    expect(list?.querySelectorAll("li").length).toBeLessThan(50);
    const first = list?.querySelector<HTMLElement>("li");
    expect(first?.tabIndex).toBe(0);

    await act(async () => {
      first?.focus();
      first?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
      await nextFrame();
    });

    const last = host.querySelector<HTMLElement>('[aria-label="Coverage file src/file-19999.ts"]');
    expect(last).not.toBeNull();
    expect(document.activeElement).toBe(last);
    expect(last?.getAttribute("aria-posinset")).toBe("20000");
    expect(last?.getAttribute("aria-setsize")).toBe("20000");
    expect(list?.querySelectorAll("li").length).toBeLessThan(50);
  });

  it("resets expansion and focus state for each exact workspace tree owner", async () => {
    const discovery = {
      filePath: "src/same.test.ts",
      suitePath: ["same"],
      target: target("same test", 1),
    };
    const treeA = buildJsTestExplorerTree("/workspace", [discovery], "workspace-a");
    const treeB = buildJsTestExplorerTree("/workspace", [discovery], "workspace-b");
    const renderTree = async (tree: typeof treeA) => {
      await act(async () => {
        root.render(
          <JsTestExplorerVirtualizedTree
            debugDisabled={false}
            disabled={false}
            onDebugNode={vi.fn()}
            onOpenTest={vi.fn()}
            onRunScope={vi.fn()}
            root={tree}
            rootPath="/workspace"
          />,
        );
      });
    };

    await renderTree(treeA);
    const rootA = host.querySelector<HTMLElement>('[role="treeitem"]');
    await act(async () => {
      rootA?.focus();
      rootA?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
    });
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);

    await renderTree(treeB);
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(1);
    expect(host.querySelector<HTMLElement>('[role="treeitem"]')?.tabIndex).toBe(0);

    await renderTree(treeA);
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(1);
    expect(host.querySelector<HTMLElement>('[role="treeitem"]')?.tabIndex).toBe(0);
  });
});

function target(filter: string, lineNumber: number): TestGutterTarget {
  return {
    filter,
    kind: "method",
    label: `Run ${filter}`,
    match: "description",
    position: { column: 1, lineNumber },
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
