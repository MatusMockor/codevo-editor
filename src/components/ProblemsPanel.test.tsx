// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkbenchNotice,
  type WorkbenchNotice,
  type WorkbenchNoticeNavigationTarget,
} from "../application/workbenchNotice";
import { ProblemsPanel } from "./ProblemsPanel";

const errorIconRenders = vi.fn();

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  const ActualAlertCircle = actual.AlertCircle;
  return {
    ...actual,
    AlertCircle: (props: Record<string, unknown>) => {
      errorIconRenders();
      return <ActualAlertCircle {...props} />;
    },
  };
});

function navigableNotice(message: string): WorkbenchNotice {
  const navigationTarget: WorkbenchNoticeNavigationTarget = {
    path: "/workspace/src/User.php",
    range: {
      end: { column: 1, lineNumber: 1 },
      start: { column: 1, lineNumber: 1 },
    },
  };

  return createWorkbenchNotice(
    "error",
    "phpactor",
    message,
    undefined,
    navigationTarget,
  );
}

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

  it("opens a notice when a navigable problem row is clicked", () => {
    const notice = navigableNotice("boom");
    const onOpenNotice = vi.fn();
    render([notice], onOpenNotice);

    act(() => {
      host.querySelector<HTMLButtonElement>("button.problem-row")?.click();
    });

    expect(onOpenNotice).toHaveBeenCalledWith(notice);
  });

  it("does not re-render rows when the parent re-renders with identical props", () => {
    const notices = [navigableNotice("boom")];
    const onOpenNotice = vi.fn();
    errorIconRenders.mockClear();

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return (
        <ProblemsPanel
          isActive
          notices={notices}
          onOpenNotice={onOpenNotice}
        />
      );
    }

    act(() => {
      root.render(<Parent />);
    });

    expect(errorIconRenders).toHaveBeenCalledTimes(1);

    act(() => {
      forceParentRender(1);
    });

    // React.memo skips the re-render because every prop is referentially
    // unchanged, so the rows (and their severity icons) are never rebuilt.
    expect(errorIconRenders).toHaveBeenCalledTimes(1);
  });
});
