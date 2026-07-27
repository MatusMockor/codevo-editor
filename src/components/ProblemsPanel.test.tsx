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
import type { WorkspacePackageManifestInput } from "../domain/workspacePackageGraph";
import type { WorkspacePackageAuthority } from "../application/useWorkspacePackageGraph";

const errorIconRenders = vi.fn();
const packageAttributionBuilds = vi.fn();

vi.mock("../domain/problemsPackageAttribution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domain/problemsPackageAttribution")>();

  return {
    ...actual,
    createProblemsPackageAttribution: (
      ...args: Parameters<typeof actual.createProblemsPackageAttribution>
    ) => {
      packageAttributionBuilds();
      return actual.createProblemsPackageAttribution(...args);
    },
  };
});

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

  return createWorkbenchNotice("error", "phpactor", message, undefined, navigationTarget);
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

const WORKSPACE_PACKAGE_MANIFESTS: readonly WorkspacePackageManifestInput[] = [
  {
    packageJson: { name: "@repo/api" },
    relativeDirPath: "packages/api",
  },
  {
    packageJson: { name: "@repo/web" },
    relativeDirPath: "packages/web",
  },
];

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) {
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  function render(
    notices: Parameters<typeof ProblemsPanel>[0]["notices"],
    onOpenNotice = vi.fn(),
    workspaceRoot = "/workspace",
    workspacePackageManifests: readonly WorkspacePackageManifestInput[] = [],
    workspacePackageAuthority: WorkspacePackageAuthority = "complete",
    workspacePackageIncompleteDirectories: readonly string[] = [],
    workspacePackageUnscopedAuthorityUncertain = false,
  ) {
    act(() => {
      root.render(
        <ProblemsPanel
          isActive
          notices={notices}
          onOpenNotice={onOpenNotice}
          workspacePackageAuthority={workspacePackageAuthority}
          workspacePackageIncompleteDirectories={workspacePackageIncompleteDirectories}
          workspacePackageManifests={workspacePackageManifests}
          workspacePackageUnscopedAuthorityUncertain={
            workspacePackageUnscopedAuthorityUncertain
          }
          workspaceRoot={workspaceRoot}
        />,
      );
    });
  }

  it("moves keyboard focus from a package header into its own rows", () => {
    render(
      [
        problemNotice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api"),
        problemNotice("web", "/workspace/packages/web/src/index.ts", 1, "error", "web"),
      ],
      vi.fn(),
      "/workspace",
      WORKSPACE_PACKAGE_MANIFESTS,
    );

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]')?.click();
    });
    const headers = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".problems-package-header"),
    );
    headers[0].focus();

    act(() => {
      headers[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    const apiRow = host.querySelector<HTMLElement>('[data-package-key="@repo/api"] .problem-row');
    expect(document.activeElement).toBe(apiRow);

    act(() => {
      headers[0].focus();
      headers[0].click();
    });

    expect(headers[0].getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(headers[0]);
    expect(headers[0].getAttribute("aria-label")).toContain("@repo/api");
  });

  it("computes package assignment once per invalidation rather than per render", () => {
    const notices = [
      problemNotice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api"),
    ];
    packageAttributionBuilds.mockClear();
    render(notices, vi.fn(), "/workspace", WORKSPACE_PACKAGE_MANIFESTS);

    expect(packageAttributionBuilds).toHaveBeenCalledTimes(1);

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]')?.click();
    });
    act(() => {
      host.querySelector<HTMLButtonElement>(".problems-package-header")?.click();
    });

    expect(packageAttributionBuilds).toHaveBeenCalledTimes(1);

    render([...notices], vi.fn(), "/workspace", WORKSPACE_PACKAGE_MANIFESTS);

    expect(packageAttributionBuilds).toHaveBeenCalledTimes(2);
  });

  it("filters the panel to one package", () => {
    render(
      [
        problemNotice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api problem"),
        problemNotice("web", "/workspace/packages/web/src/index.ts", 1, "error", "web problem"),
      ],
      vi.fn(),
      "/workspace",
      WORKSPACE_PACKAGE_MANIFESTS,
    );
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by package"]');

    act(() => {
      if (!select) {
        return;
      }

      select.value = "@repo/api";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(host.textContent).toContain("api problem");
    expect(host.textContent).not.toContain("web problem");
  });

  it("filters the panel to the synthesized No package option", () => {
    render(
      [
        problemNotice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api problem"),
        problemNotice("outside", "/workspace/tools/release.ts", 1, "error", "outside problem"),
      ],
      vi.fn(),
      "/workspace",
      WORKSPACE_PACKAGE_MANIFESTS,
    );
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by package"]');
    const noPackageOption = Array.from(select?.options ?? []).find(
      (option) => option.textContent === "No package",
    );

    act(() => {
      if (!select || !noPackageOption) return;
      select.value = noPackageOption.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(select?.value).toBe(":no-package");
    expect(host.textContent).toContain("outside problem");
    expect(host.textContent).not.toContain("api problem");
  });

  it("resets an unavailable package filter for both the control and the view", () => {
    const api = problemNotice(
      "api",
      "/workspace/packages/api/src/index.ts",
      1,
      "error",
      "api problem",
    );
    const web = problemNotice(
      "web",
      "/workspace/packages/web/src/index.ts",
      1,
      "error",
      "web problem",
    );
    render([api, web], vi.fn(), "/workspace", WORKSPACE_PACKAGE_MANIFESTS);
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by package"]');

    act(() => {
      if (!select) return;
      select.value = "@repo/api";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    render([web], vi.fn(), "/workspace", WORKSPACE_PACKAGE_MANIFESTS);

    expect(select?.value).toBe("");
    expect(host.textContent).toContain("web problem");
    expect(host.textContent).not.toContain("No problems match");
  });

  it("labels bounded package authority as unknown and marks package controls degraded", () => {
    render(
      [problemNotice("unknown", "/workspace/tools/release.ts", 1, "error", "unknown owner")],
      vi.fn(),
      "/workspace",
      [],
      "bounded",
      [],
      true,
    );
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by package"]');
    const grouping = host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]');

    expect(select?.textContent).toContain("Package unknown (workspace scan bounded)");
    expect(select?.dataset.degraded).toBe("true");
    expect(grouping?.dataset.degraded).toBe("true");

    act(() => grouping?.click());

    expect(host.querySelector(".problems-package-header")?.textContent).toContain(
      "Package unknown (workspace scan bounded)",
    );
    expect(host.textContent).not.toContain("No package");
  });

  it("labels initial package discovery as loading without claiming a bounded scan", () => {
    render(
      [problemNotice("pending", "/workspace/tools/release.ts", 1, "error", "pending owner")],
      vi.fn(),
      "/workspace",
      [],
      "loading",
    );
    const grouping = host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]');

    expect(grouping?.textContent).toBe("Package");
    expect(grouping?.dataset.degraded).toBeUndefined();
    expect(host.textContent).toContain("Package pending (workspace scan loading)");
    expect(host.textContent).not.toContain("workspace scan bounded");
  });

  it("keeps parsed package attribution while degrading only an incomplete manifest directory", () => {
    render(
      [
        problemNotice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api problem"),
        problemNotice("bad", "/workspace/packages/bad/src/index.ts", 1, "error", "bad problem"),
        problemNotice("outside", "/workspace/tools/release.ts", 1, "error", "outside problem"),
      ],
      vi.fn(),
      "/workspace",
      WORKSPACE_PACKAGE_MANIFESTS,
      "bounded",
      ["packages/bad"],
    );

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]')?.click();
    });
    const headers = Array.from(
      host.querySelectorAll(".problems-package-header"),
      (header) => header.textContent,
    );

    expect(headers).toEqual([
      expect.stringContaining("@repo/api"),
      expect.stringContaining("No package"),
      expect.stringContaining("Package unknown (workspace scan bounded)"),
    ]);
    expect(host.querySelector('[data-package-key="@repo/api"]')?.textContent).toContain(
      "api problem",
    );
    expect(host.querySelector('[data-package-key=":no-package"]')?.textContent).toContain(
      "outside problem",
    );
    expect(host.querySelector('[data-package-key=":package-unknown"]')?.textContent).toContain(
      "bad problem",
    );
  });

  it("bounds mounted problem rows and reports the window truthfully", () => {
    render(
      Array.from({ length: 250 }, (_, index) =>
        problemNotice(
          `problem-${index}`,
          "/workspace/src/index.ts",
          index + 1,
          "error",
          `Problem ${index}`,
        ),
      ),
    );

    expect(host.querySelectorAll(".problem-row")).toHaveLength(200);
    expect(host.textContent).toContain("Showing 200 of 250 problem rows");
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector("button")?.textContent).not.toBe("Show more");
    const showMore = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Show more",
    );

    act(() => showMore?.click());

    expect(host.querySelectorAll(".problem-row")).toHaveLength(250);
  });

  it("names fully hidden packages before Show more reveals them", () => {
    const notices = [
      ...Array.from({ length: 200 }, (_, index) =>
        problemNotice(
          `api-${index}`,
          `/workspace/packages/api/src/file-${index}.ts`,
          1,
          "error",
          `api ${index}`,
        ),
      ),
      ...Array.from({ length: 25 }, (_, index) =>
        problemNotice(
          `web-${index}`,
          `/workspace/packages/web/src/file-${index}.ts`,
          1,
          "error",
          `web ${index}`,
        ),
      ),
    ];
    render(notices, vi.fn(), "/workspace", WORKSPACE_PACKAGE_MANIFESTS);
    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]')?.click();
    });

    expect(host.textContent).toContain("Fully hidden packages: @repo/web.");
    expect(
      Array.from(host.querySelectorAll(".problems-package-header"), (header) => header.textContent),
    ).toEqual([expect.stringContaining("@repo/api"), expect.stringContaining("@repo/web")]);
    expect(host.querySelector('[data-package-key="@repo/web"] .problem-row')).toBeNull();
  });

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
    const groupKey = "language-server-diagnostics:file:///workspace/src/User.php";
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

    const overflowRow = host.querySelector('[data-testid="diagnostics-overflow"]');

    expect(overflowRow).not.toBeNull();
    expect(overflowRow?.classList.contains("overflow")).toBe(true);
    expect(host.querySelectorAll(".problems-file-header")).toHaveLength(1);
    expect(host.querySelector(".problems-file-header")?.textContent).toContain("src/User.php");
    expect(host.querySelectorAll(".problems-file-group .problem-row")).toHaveLength(2);
    expect(overflowRow?.hasAttribute("role")).toBe(false);
    expect(overflowRow?.hasAttribute("tabindex")).toBe(false);
    expect(host.querySelectorAll(".problem-row[tabindex]")).toHaveLength(1);
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

    expect(host.querySelector('button[aria-label="Warnings (0)"]')).not.toBeNull();
    expect(host.textContent).toContain("More notices hidden");
  });

  it("opens a notice when a navigable problem row is clicked", () => {
    const notice = navigableNotice("boom");
    const onOpenNotice = vi.fn();
    render([notice], onOpenNotice);

    act(() => {
      host.querySelector<HTMLButtonElement>("button.problem-row")?.click();
    });

    expect(onOpenNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        id: notice.id,
        packageIdentity: expect.objectContaining({ key: ":no-package" }),
      }),
    );
  });

  it("copies a problem message", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render([navigableNotice("Undefined method save")]);

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')?.click();
    });

    expect(writeText).toHaveBeenCalledWith("Undefined method save");
  });

  it("does not throw when copying without the clipboard API", () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render([navigableNotice("boom")]);

    expect(() => {
      act(() => {
        host.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')?.click();
      });
    }).not.toThrow();
  });

  it("moves through filtered problem rows without focusing group headers", () => {
    render([
      problemNotice("first", "/workspace/src/A.php", 1, "error", "matching first"),
      problemNotice("hidden", "/workspace/src/A.php", 2, "error", "other"),
      problemNotice("second", "/workspace/src/B.php", 1, "error", "matching second"),
    ]);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Filter problems"]');
    act(() => setInputValue(input, "matching"));
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>(".problem-row[tabindex]"));
    rows[0].focus();

    act(() => {
      rows[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(document.activeElement).toBe(rows[1]);
    expect(host.querySelectorAll(".problems-file-header")).toHaveLength(2);

    act(() => {
      rows[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect(document.activeElement).toBe(rows[0]);
    expect(input).not.toBe(document.activeElement);
  });

  it("avoids an invalid listbox hierarchy and labels file groups", () => {
    render([
      problemNotice("first", "/workspace/src/A.php", 1, "error", "first"),
      problemNotice("second", "/workspace/src/B.php", 1, "warning", "second"),
    ]);

    const list = host.querySelector<HTMLElement>(".problems-list-rows");
    const options = Array.from(list?.querySelectorAll<HTMLElement>(".problem-row[tabindex]") ?? []);
    const tabStops = Array.from(list?.querySelectorAll<HTMLElement>('[tabindex="0"]') ?? []);
    const groups = Array.from(list?.querySelectorAll<HTMLElement>(".problems-file-group") ?? []);

    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(options).toHaveLength(2);
    expect(tabStops).toEqual([options[0]]);
    expect(
      Array.from(list?.querySelectorAll(".problems-file-header") ?? []).every(
        (header) => header.getAttribute("tabindex") === "-1",
      ),
    ).toBe(true);
    expect(
      Array.from(list?.querySelectorAll(".problem-row-copy") ?? []).every(
        (copy) => copy.getAttribute("tabindex") === "-1",
      ),
    ).toBe(true);
    expect(groups).toHaveLength(2);
    groups.forEach((group) => {
      const header = group.querySelector<HTMLElement>(".problems-file-header");
      expect(group.getAttribute("aria-labelledby")).toBe(header?.id);
    });
  });

  it("keeps empty states outside the listbox", () => {
    render([]);

    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector("p")?.textContent).toBe("No problems");
  });

  it("opens the selected problem with Enter and Space", () => {
    const first = problemNotice("first", "/workspace/src/A.php", 1, "error", "first");
    const second = problemNotice("second", "/workspace/src/B.php", 1, "error", "second");
    const onOpenNotice = vi.fn();
    render([first, second], onOpenNotice);
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>(".problem-row[tabindex]"));

    act(() => {
      rows[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
      rows[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      rows[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    });

    expect(onOpenNotice).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: second.id,
        packageIdentity: expect.objectContaining({ key: ":no-package" }),
      }),
    );
    expect(onOpenNotice).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: second.id,
        packageIdentity: expect.objectContaining({ key: ":no-package" }),
      }),
    );
  });

  it("moves to the first and last visible problems with Home and End", () => {
    render([
      problemNotice("first", "/workspace/src/A.php", 1, "error", "first"),
      problemNotice("second", "/workspace/src/A.php", 2, "error", "second"),
      problemNotice("third", "/workspace/src/B.php", 1, "error", "third"),
    ]);
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>(".problem-row[tabindex]"));
    rows[0].focus();

    act(() => {
      rows[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(rows[2]);

    act(() => {
      rows[2].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement).toBe(rows[0]);
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

    const errorsToggle = host.querySelector<HTMLButtonElement>('button[aria-label="Errors (1)"]');
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
    render([problemNotice("error", "/workspace/src/User.php", 2, "error", "boom")]);

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Errors (1)"]')?.click();
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

  it("uses problems-panel classes for row layout, selection, and copy visibility", () => {
    const css = readFileSync("src/App.css", "utf8");
    render([navigableNotice("boom")]);

    expect(host.querySelector(".problem-row-container")).not.toBeNull();
    expect(host.querySelector(".problem-row-copy")).not.toBeNull();
    expect(host.querySelector(".git-branch-row-action")).toBeNull();
    expect(host.querySelector(".problem-row-container")?.hasAttribute("style")).toBe(false);
    expect(host.querySelector(".problem-row")?.hasAttribute("style")).toBe(false);
    expect(host.querySelector(".problem-row-copy")?.hasAttribute("style")).toBe(false);
    expect(css).toMatch(/\.problem-row\[aria-selected="true"\]/);
    expect(css).toMatch(/\.problem-row-container:hover \.problem-row-copy/);
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

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Filter problems"]')?.value).toBe(
      "",
    );
    expect(
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Errors (1)"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host.querySelector<HTMLButtonElement>(".problems-file-header")?.getAttribute("aria-expanded"),
    ).toBe("true");
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
