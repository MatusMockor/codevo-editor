// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentGitChangeRow } from "../../../../application/rightPanel/useAgentGitSurface";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { AgentGitSurface, type AgentGitSurfaceProps } from "./AgentGitSurface";
import { relativeAge } from "./agentGitPresentation";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const NOW_MS = 1_800_000_000_000;

const ROWS: ReadonlyArray<AgentGitChangeRow> = [
  {
    relativePath: "src/middleware/idempotency.ts",
    status: "added",
    added: 29,
    deleted: 0,
    included: true,
  },
  {
    relativePath: "src/routes/orders.ts",
    status: "modified",
    added: 4,
    deleted: 1,
    included: true,
  },
  { relativePath: "test/orders.test.ts", status: "modified", added: 9, deleted: 6, included: true },
  { relativePath: ".env.example", status: "modified", added: 1, deleted: 1, included: false },
];

function props(overrides: Partial<AgentGitSurfaceProps> = {}): AgentGitSurfaceProps {
  return {
    branchControl: <span>feat/idempotency-keys</span>,
    moreMenu: null,
    banner: null,
    aheadCount: 2,
    behindCount: 0,
    upstreamName: "origin/feat/idempotency-keys",
    unpushed: [
      {
        sha: "a".repeat(40),
        shortSha: "a41c9e2",
        subject: "test(orders): cover retry with same key",
        authoredAtEpochSeconds: NOW_MS / 1000 - 6 * 60,
      },
    ],
    nowMs: NOW_MS,
    state: {
      rows: ROWS,
      loading: false,
      error: null,
      summary: { included: 3, total: 4, checked: "mixed" },
      message: "",
      busy: "idle",
      notice: null,
    },
    onRowIncludedChange: vi.fn(),
    onAllIncludedChange: vi.fn(),
    onMessageChange: vi.fn(),
    onGenerate: vi.fn(),
    onCommit: vi.fn(),
    onCommitAndPush: vi.fn(),
    onFetch: vi.fn(),
    onOpenPullRequest: vi.fn(),
    ...overrides,
  };
}

function render(next: AgentGitSurfaceProps): HTMLElement {
  ui = ui ?? mountUi();
  ui.render(<AgentGitSurface {...next} />);
  return ui.host;
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

describe("AgentGitSurface", () => {
  it("shows the include summary with a mixed header checkbox and totals", () => {
    const host = render(props());

    expect(host.querySelector(".cv-git-head")?.textContent).toContain("3 of 4 files");
    expect(button(host, "Include all files").getAttribute("aria-checked")).toBe("mixed");
    expect(host.querySelector(".cv-git-head .cv-rp-stat")?.textContent).toBe("+42−7");
  });

  it("marks excluded rows and keeps their full path readable", () => {
    const host = render(props());
    const rows = [...host.querySelectorAll(".cv-git-row")];
    const excluded = rows[3];

    expect(rows).toHaveLength(4);
    expect(excluded?.classList.contains("cv-git-row--off")).toBe(true);
    expect(excluded?.textContent).toContain("Excluded");
    expect(rows[0]?.querySelector(".cv-git-row__path")?.getAttribute("title")).toBe(
      "src/middleware/idempotency.ts",
    );
    expect(rows[0]?.querySelector(".cv-git-status")?.textContent).toBe("A");
    expect(rows[1]?.querySelector(".cv-git-status")?.textContent).toBe("M");
    const status = rows[0]?.querySelector(".cv-git-status");
    expect(status?.tagName).toBe("ABBR");
    expect(status?.getAttribute("title")).toBe("added");
    expect(status?.hasAttribute("aria-label")).toBe(false);
  });

  it("toggles rows and the header checkbox", () => {
    const next = props();
    const host = render(next);

    click(button(host, "Include src/routes/orders.ts"));
    click(button(host, "Include all files"));

    expect(next.onRowIncludedChange).toHaveBeenCalledWith("src/routes/orders.ts", false);
    expect(next.onAllIncludedChange).toHaveBeenCalledWith(true);
  });

  it("commits, pushes and generates from the commit box", () => {
    const next = props();
    const host = render(next);
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");

    expect(textarea?.getAttribute("aria-label")).toBe("Commit message");
    expect(textarea?.getAttribute("placeholder")).toBe("Leave empty to auto-generate");
    click(button(host, "Generate"));
    click(button(host, "Commit"));
    click(button(host, "Commit & push"));

    expect(next.onGenerate).toHaveBeenCalledTimes(1);
    expect(next.onCommit).toHaveBeenCalledTimes(1);
    expect(next.onCommitAndPush).toHaveBeenCalledTimes(1);
  });

  it("disables committing while busy or when nothing is included", () => {
    const busyHost = render(props({ state: { ...props().state, busy: "pushing" } }));
    expect(button(busyHost, "Commit").disabled).toBe(true);
    expect(button(busyHost, "Pushing…").disabled).toBe(true);

    const emptyHost = render(
      props({
        state: { ...props().state, summary: { included: 0, total: 4, checked: false } },
      }),
    );
    expect(button(emptyHost, "Commit").disabled).toBe(true);
    expect(button(emptyHost, "Commit & push").disabled).toBe(true);
  });

  it("lists unpushed commits with short sha and relative age", () => {
    const host = render(props());
    const commit = host.querySelector(".cv-git-commit");

    expect(host.textContent).toContain("Unpushed");
    expect(commit?.querySelector(".cv-git-commit__msg")?.textContent).toBe(
      "test(orders): cover retry with same key",
    );
    expect(commit?.querySelector(".cv-git-commit__sha")?.textContent).toBe("a41c9e2");
    expect(commit?.querySelector(".cv-git-commit__ago")?.textContent).toBe("6m");
    expect(host.querySelector(".cv-git-sync")?.textContent).toBe("↑2 ↓0");
  });

  it("offers the pull request only when commits are unpublished", () => {
    const next = props();
    const host = render(next);
    click(button(host, "Create pull request"));
    expect(next.onOpenPullRequest).toHaveBeenCalledTimes(1);

    const quiet = render(props({ unpushed: [], aheadCount: 0 }));
    expect(quiet.textContent).not.toContain("Create pull request");
  });

  it("announces errors as alerts and success as status", () => {
    const failed = render(
      props({ state: { ...props().state, notice: { kind: "error", text: "Nothing to commit." } } }),
    );
    expect(failed.querySelector('[role="alert"]')?.textContent).toBe("Nothing to commit.");

    const ok = render(
      props({ state: { ...props().state, notice: { kind: "ok", text: "Committed." } } }),
    );
    expect(ok.querySelector('[role="status"]')?.textContent).toBe("Committed.");
  });

  it("shows loading, error and empty states", () => {
    const loading = render(props({ state: { ...props().state, rows: [], loading: true } }));
    expect(loading.textContent).toContain("Loading changes…");
    const failed = render(
      props({ state: { ...props().state, rows: [], error: "not a repository" } }),
    );
    expect(failed.textContent).toContain("not a repository");
    const empty = render(props({ state: { ...props().state, rows: [] } }));
    expect(empty.textContent).toContain("No changes to commit.");
  });

  it("formats relative ages", () => {
    expect(relativeAge(NOW_MS / 1000 - 30, NOW_MS)).toBe("now");
    expect(relativeAge(NOW_MS / 1000 - 3 * 3_600, NOW_MS)).toBe("3h");
    expect(relativeAge(NOW_MS / 1000 - 2 * 86_400, NOW_MS)).toBe("2d");
  });
});
