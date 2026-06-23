// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchNotice } from "../application/workbenchNotice";
import { ProblemsPanel } from "./ProblemsPanel";

describe("ProblemsPanel", () => {
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

  function render(
    notices: Parameters<typeof ProblemsPanel>[0]["notices"],
    onOpenNotice = vi.fn(),
  ) {
    act(() => {
      root.render(
        <ProblemsPanel
          isActive
          notices={notices}
          onOpenNotice={onOpenNotice}
        />,
      );
    });
  }

  it("renders an empty state when there are no notices", () => {
    render([]);

    expect(host.textContent).toContain("No problems");
  });

  it("renders ordinary notices without the overflow treatment", () => {
    render([createWorkbenchNotice("error", "phpactor", "boom")]);

    expect(host.querySelector(".problem-row.overflow")).toBeNull();
    expect(host.querySelector('[data-testid="diagnostics-overflow"]')).toBeNull();
  });

  it("visually distinguishes the diagnostics overflow notice", () => {
    render([
      createWorkbenchNotice("error", "phpactor", "boom", "diagnostics:a"),
      createWorkbenchNotice(
        "info",
        "phpactor",
        "21 more diagnostics not shown (open the file to see all markers).",
        "diagnostics:a",
        undefined,
        "overflow",
      ),
    ]);

    const overflowRow = host.querySelector(
      '[data-testid="diagnostics-overflow"]',
    );

    expect(overflowRow).not.toBeNull();
    expect(overflowRow?.classList.contains("overflow")).toBe(true);
  });
});
