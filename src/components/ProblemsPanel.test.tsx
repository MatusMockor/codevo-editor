// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
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

function problemNotice(
  id: string,
  path: string,
  lineNumber: number,
  severity: WorkbenchNotice["severity"],
  message: string,
): WorkbenchNotice {
  return {
    id,
    message,
    navigationTarget: {
      path,
      range: {
        end: { column: 1, lineNumber },
        start: { column: 1, lineNumber },
      },
    },
    severity,
    source: "test",
  };
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) {
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
    workspaceRoot = "/workspace",
  ) {
    act(() => {
      root.render(
        <ProblemsPanel
          isActive
          notices={notices}
          onOpenNotice={onOpenNotice}
          workspaceRoot={workspaceRoot}
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
    const groupKey =
      "language-server-diagnostics:file:///workspace/src/User.php";
    render([
      createWorkbenchNotice("error", "phpactor", "boom", groupKey),
      createWorkbenchNotice(
        "info",
        "phpactor",
        "21 more diagnostics not shown (open the file to see all markers).",
        groupKey,
        undefined,
        "overflow",
      ),
    ]);

    const overflowRow = host.querySelector(
      '[data-testid="diagnostics-overflow"]',
    );

    expect(overflowRow).not.toBeNull();
    expect(overflowRow?.classList.contains("overflow")).toBe(true);
    expect(host.querySelectorAll(".problems-file-header")).toHaveLength(1);
    expect(host.querySelector(".problems-file-header")?.textContent).toContain(
      "src/User.php",
    );
    expect(host.querySelectorAll(".problems-file-group .problem-row")).toHaveLength(
      2,
    );
  });

  it("renders no-target crash and index notices as flat general rows", () => {
    render([
      createWorkbenchNotice("error", "PHP", "Language server stopped"),
      createWorkbenchNotice("info", "Index", "Index is warming up"),
    ]);

    const general = host.querySelector(".problems-general");
    expect(general?.querySelectorAll(".problem-row")).toHaveLength(2);
    expect(general?.textContent).toContain("Language server stopped");
    expect(general?.textContent).toContain("Index is warming up");
    expect(host.querySelector(".problems-file-header")).toBeNull();
  });

  it("does not include the global overflow sentinel in the warning badge", () => {
    render([
      {
        groupKey: "workbench-notice-overflow",
        id: "global-overflow",
        kind: "overflow",
        message: "More notices hidden",
        severity: "warning",
        source: "Notices",
      },
    ]);

    expect(
      host.querySelector('button[aria-label="Warnings (0)"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("More notices hidden");
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

  it("renders file groups with relative paths and per-file severity counts", () => {
    render([
      problemNotice("warning", "/workspace/src/User.php", 8, "warning", "warn"),
      problemNotice("error", "/workspace/src/User.php", 2, "error", "boom"),
      problemNotice("other", "/workspace/tests/UserTest.php", 1, "error", "fail"),
    ]);

    const headers = Array.from(host.querySelectorAll(".problems-file-header"));
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toContain("src/User.php");
    expect(headers[0].textContent).toContain("1 error");
    expect(headers[0].textContent).toContain("1 warning");
    expect(headers[1].textContent).toContain("tests/UserTest.php");
  });

  it("collapses and expands a file group", () => {
    render([problemNotice("error", "/workspace/src/User.php", 2, "error", "boom")]);

    const header = host.querySelector<HTMLButtonElement>(".problems-file-header");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".problem-row")).not.toBeNull();

    act(() => header?.click());

    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".problem-row")).toBeNull();
  });

  it("filters with severity toggles and case-insensitive text search", () => {
    render([
      problemNotice("error", "/workspace/src/User.php", 2, "error", "Missing method"),
      problemNotice("warning", "/workspace/src/Service.php", 4, "warning", "Unused value"),
    ]);

    const errorsToggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Errors (1)"]',
    );
    act(() => errorsToggle?.click());
    expect(errorsToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).not.toContain("Missing method");
    expect(host.textContent).toContain("Unused value");

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Filter problems"]');
    act(() => {
      setInputValue(input, "SERVICE.PHP");
    });
    expect(host.textContent).toContain("Unused value");

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Clear filter"]')?.click());
    expect(input?.value).toBe("");
  });

  it("shows the filtered empty state", () => {
    render([problemNotice("error", "/workspace/src/User.php", 2, "error", "boom")]);

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Filter problems"]');
    act(() => {
      setInputValue(input, "no match");
    });

    expect(host.textContent).toContain("No problems match the current filters");
  });

  it("uses the filters empty state when severity toggles hide all notices", () => {
    render([
      problemNotice("error", "/workspace/src/User.php", 2, "error", "boom"),
    ]);

    act(() => {
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Errors (1)"]',
      )?.click();
    });

    expect(host.textContent).toContain("No problems match the current filters");
  });

  it("exposes severity toggles as a labeled accessibility group", () => {
    render([]);

    const group = host.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Problem severities");
  });

  it("defines distinct theme-aware focus outlines for toggles and file headers", () => {
    const css = readFileSync("src/App.css", "utf8");

    expect(css).toMatch(
      /\.problems-severity-toggle:focus-visible\s*\{[^}]*outline:\s*\d+px solid var\(--color-accent\)/s,
    );
    expect(css).toMatch(
      /\.problems-file-header:focus-visible\s*\{[^}]*outline:\s*\d+px solid var\(--color-accent\)/s,
    );
  });

  it("resets filter, severity, and collapse state when the workspace root changes", () => {
    const first = problemNotice("first", "/workspace/src/User.php", 2, "error", "first");
    render([first]);

    act(() => host.querySelector<HTMLButtonElement>(".problems-file-header")?.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Errors (1)"]')?.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Filter problems"]');
    act(() => {
      setInputValue(input, "hidden");
    });

    const second = problemNotice("second", "/other/src/Other.php", 3, "error", "visible");
    render([second], vi.fn(), "/other");

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Filter problems"]')?.value).toBe("");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Errors (1)"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLButtonElement>(".problems-file-header")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("visible");
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
          workspaceRoot="/workspace"
        />
      );
    }

    act(() => {
      root.render(<Parent />);
    });

    expect(errorIconRenders).toHaveBeenCalledTimes(2);

    act(() => {
      forceParentRender(1);
    });

    // React.memo skips the re-render because every prop is referentially
    // unchanged, so the rows (and their severity icons) are never rebuilt.
    expect(errorIconRenders).toHaveBeenCalledTimes(2);
  });
});
