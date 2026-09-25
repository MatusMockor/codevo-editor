// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSurfaceFileTreeSurface } from "../../../../application/useAgentSurfaceFileTree";
import { MAX_CHECKOUT_FILE_STATUSES } from "../../../../application/rightPanel/useCheckoutFileStatuses";
import {
  FILES_SEARCH_DEBOUNCE_MS,
  MAX_FILES_SEARCH_RESULTS,
} from "../../../../application/rightPanel/useAgentFilesSearch";
import type { GitChangeStatus, GitChangedFile, GitStatus } from "../../../../domain/git";
import type { FileEntry, FileSearchGateway, FileSearchResult } from "../../../../domain/workspace";
import { mountUi, press, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import type { AgentSurfaceFileTreeProps } from "../../AgentSurfaceFileTree";
import { installResizeObserver } from "../../agentSurfaceTerminalTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import {
  WithRightPanelContext,
  rightPanelTestContext,
  unusedGit,
} from "../agentRightPanelTestSupport";
import {
  AgentFilesSurface,
  CHECKOUT_STATUS_FAILED_NOTE,
  CHECKOUT_STATUS_TRUNCATED_NOTE,
} from "./AgentFilesSurface";

const ROOT = "/repo";

let ui: MountedUi | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserver();
});

afterEach(() => {
  resetUi();
  vi.useRealTimers();
});

function resetUi(): void {
  ui?.unmount();
  ui = null;
}

function entry(path: string, kind: FileEntry["kind"] = "file"): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind };
}

function tree(): AgentSurfaceFileTreeSurface {
  return {
    rootPath: ROOT,
    entriesByDirectory: {
      [ROOT]: [entry(`${ROOT}/src`, "directory"), entry(`${ROOT}/README.md`)],
      [`${ROOT}/src`]: [entry(`${ROOT}/src/app.ts`), entry(`${ROOT}/src/new.ts`)],
    },
    expandedDirectories: new Set([`${ROOT}/src`]),
    loadingDirectories: new Set(),
    failedDirectories: new Set(),
    truncatedDirectories: new Set(),
    rootError: null,
    toggleDirectory: () => undefined,
    retryDirectory: () => undefined,
    refresh: () => undefined,
  };
}

function fileTree(overrides: Partial<AgentSurfaceFileTreeProps> = {}): AgentSurfaceFileTreeProps {
  return {
    source: "thread",
    tree: tree(),
    unavailable: null,
    activePath: null,
    revealActivePathSignal: 0,
    fileStatusesByPath: { [`${ROOT}/src/app.ts`]: "modified", [`${ROOT}/src/new.ts`]: "added" },
    searchFiles: { shortcut: "Cmd+P" },
    onOpenFile: () => undefined,
    onPreviewFile: () => undefined,
    ...overrides,
  };
}

function untrackedNotes(): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: true,
    oldPath: null,
    oldRelativePath: null,
    path: `${ROOT}/src/new.ts`,
    relativePath: "src/new.ts",
    status: "untracked",
  };
}

function result(relativePath: string): FileSearchResult {
  return {
    name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    path: `${ROOT}/${relativePath}`,
    relativePath,
  };
}

function staticSearch(found: FileSearchResult[]): FileSearchGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchFiles: async (_root, query) => {
      calls.push(query);
      return found;
    },
  };
}

function render(
  props: {
    readonly fileTree?: AgentSurfaceFileTreeProps | null;
    readonly treeShown?: boolean;
  },
  context: AgentRightPanelContextValue = rightPanelTestContext(),
): HTMLElement {
  ui = ui ?? mountUi();
  ui.render(
    <WithRightPanelContext value={context}>
      <AgentFilesSurface
        fileTree={props.fileTree === undefined ? fileTree() : props.fileTree}
        treeShown={props.treeShown ?? true}
      />
    </WithRightPanelContext>,
  );
  return ui.host;
}

function searchField(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[aria-label="Search workspace files"]');
}

async function typeQuery(host: HTMLElement, value: string): Promise<void> {
  const input = searchField(host);
  expect(input).not.toBeNull();
  act(() => {
    if (input === null) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(FILES_SEARCH_DEBOUNCE_MS);
  });
}

describe("AgentFilesSurface", () => {
  it("renders the search field with the quick-open hint above the real tree", () => {
    const host = render({});

    const input = searchField(host);
    expect(input?.placeholder).toBe("Search files");
    expect(host.querySelector(".cv-files__search .cv-kbd")?.textContent).toBe("⌘P");
    expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("refreshes the tree from the surface header", () => {
    const refresh = vi.fn();
    const host = render({ fileTree: fileTree({ tree: { ...tree(), refresh } }) });

    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh workspace files"]')?.click(),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders git markers as trailing letters in the tree", () => {
    const host = render({});

    const modified = host.querySelector('.cv-files [title="/repo/src/app.ts (Modified)"]');
    const added = host.querySelector('.cv-files [title="/repo/src/new.ts (Added)"]');
    expect(modified?.querySelector(".tree-row-status-modified")?.textContent).toBe("M");
    expect(added?.querySelector(".tree-row-status-added")?.textContent).toBe("A");
  });

  it("marks a thread worktree from its own status and refreshes after a git refresh", async () => {
    const statuses: GitChangeStatus[] = ["untracked", "added"];
    const getStatus = vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "agent/greet",
      isRepository: true,
      rootPath,
      changes: [
        {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: `${ROOT}/src/new.ts`,
          relativePath: "src/new.ts",
          status: statuses.shift() ?? "added",
        },
      ],
    }));
    const git = { ...unusedGit(), getStatus };
    const context = rightPanelTestContext({ thread: surfaceThreadView() }, { git });
    const host = render({ fileTree: fileTree({ fileStatusesByPath: {} }) }, context);
    const marker = () =>
      host.querySelector(`.cv-files [title^="${ROOT}/src/new.ts"] .tree-row-status`);
    await act(async () => undefined);
    expect(getStatus).toHaveBeenCalledWith(ROOT);
    expect(marker()?.textContent).toBe("U");

    render(
      { fileTree: fileTree({ fileStatusesByPath: {} }) },
      {
        ...context,
        gitStatus: { load: { kind: "loading", previous: null }, refresh: () => undefined },
      },
    );
    await act(async () => undefined);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(marker()?.textContent).toBe("A");
  });

  it("says so when the worktree status cannot be read instead of showing a clean tree", async () => {
    const getStatus = vi.fn(async (): Promise<GitStatus> => {
      throw new Error("not a git repository");
    });
    const git = { ...unusedGit(), getStatus };
    const context = rightPanelTestContext({ thread: surfaceThreadView() }, { git });
    const host = render({}, context);
    await act(async () => undefined);

    expect(host.querySelector(".cv-files__note")?.textContent).toBe(CHECKOUT_STATUS_FAILED_NOTE);
    expect(
      host.querySelector(`.cv-files [title^="${ROOT}/src/app.ts"] .tree-row-status`),
    ).toBeNull();
  });

  it("marks partial worktree status as partial", async () => {
    const changes = Array.from({ length: MAX_CHECKOUT_FILE_STATUSES + 1 }, (_unused, index) => ({
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `${ROOT}/gen/f${index}.ts`,
      relativePath: `gen/f${index}.ts`,
      status: "modified" as const,
    }));
    const getStatus = vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "agent/greet",
      isRepository: true,
      rootPath,
      changes,
    }));
    const git = { ...unusedGit(), getStatus };
    const context = rightPanelTestContext({ thread: surfaceThreadView() }, { git });
    const host = render({}, context);
    await act(async () => undefined);

    expect(host.querySelector(".cv-files__note")?.textContent).toBe(CHECKOUT_STATUS_TRUNCATED_NOTE);
  });

  it("shows no status note while the worktree status is complete", async () => {
    const getStatus = vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "agent/greet",
      isRepository: true,
      rootPath,
      changes: [],
    }));
    const git = { ...unusedGit(), getStatus };
    const host = render({}, rightPanelTestContext({ thread: surfaceThreadView() }, { git }));
    await act(async () => undefined);

    expect(host.querySelector(".cv-files__note")).toBeNull();
  });

  it("clears an in-place checkout's marker after a commit refreshes the git status", async () => {
    const pending: GitChangedFile[][] = [[untrackedNotes()], []];
    const getStatus = vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "main",
      isRepository: true,
      rootPath,
      changes: pending.shift() ?? [],
    }));
    const context = rightPanelTestContext({}, { git: { ...unusedGit(), getStatus } });
    const stale = fileTree({ fileStatusesByPath: { [`${ROOT}/src/new.ts`]: "untracked" } });
    const host = render({ fileTree: stale }, context);
    const marker = () =>
      host.querySelector(`.cv-files [title^="${ROOT}/src/new.ts"] .tree-row-status`);
    await act(async () => undefined);
    expect(getStatus).toHaveBeenCalledWith(ROOT);
    expect(marker()?.textContent).toBe("U");

    render(
      { fileTree: stale },
      {
        ...context,
        gitStatus: { load: { kind: "loading", previous: null }, refresh: () => undefined },
      },
    );
    await act(async () => undefined);

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(marker()).toBeNull();
  });

  it("re-reads the git status when the files are refreshed", async () => {
    const pending: GitChangedFile[][] = [[untrackedNotes()], []];
    const getStatus = vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "main",
      isRepository: true,
      rootPath,
      changes: pending.shift() ?? [],
    }));
    const refresh = vi.fn();
    const treeRefresh = vi.fn();
    const context = rightPanelTestContext(
      { gitStatus: { load: { kind: "idle" }, refresh } },
      { git: { ...unusedGit(), getStatus } },
    );
    const host = render(
      { fileTree: fileTree({ tree: { ...tree(), refresh: treeRefresh } }) },
      context,
    );
    const marker = () =>
      host.querySelector(`.cv-files [title^="${ROOT}/src/new.ts"] .tree-row-status`);
    await act(async () => undefined);
    expect(marker()?.textContent).toBe("U");

    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh workspace files"]',
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
    await act(async () => undefined);

    expect(treeRefresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(marker()).toBeNull();
  });

  it("follows refreshed git status without keeping stale markers", () => {
    const host = render({
      fileTree: fileTree({ fileStatusesByPath: { [`${ROOT}/src/new.ts`]: "untracked" } }),
    });
    const marker = () =>
      host.querySelector(`.cv-files [title^="${ROOT}/src/new.ts"] .tree-row-status`);
    expect(marker()?.textContent).toBe("U");

    render({ fileTree: fileTree({ fileStatusesByPath: { [`${ROOT}/src/new.ts`]: "added" } }) });
    expect(marker()?.textContent).toBe("A");

    render({ fileTree: fileTree({ fileStatusesByPath: {} }) });
    expect(marker()).toBeNull();
  });

  it("replaces the tree with matching files while a query is set", async () => {
    const gateway = staticSearch([result("src/middleware/idempotency.ts"), result("idem.md")]);
    const host = render({}, rightPanelTestContext({}, { fileSearch: gateway }));

    await typeQuery(host, "idem");

    expect(gateway.calls).toEqual(["idem"]);
    const list = host.querySelector('[role="listbox"]');
    expect(list?.getAttribute("aria-label")).toBe("Matching files");
    expect(host.querySelector('nav[aria-label="Workspace files"]')).toBeNull();
    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(2);
    expect(options[0]?.querySelector(".cv-files__result-name")?.textContent).toBe("idempotency.ts");
    expect(options[0]?.querySelector(".cv-files__result-dir")?.textContent).toBe("src/middleware");
    expect(options[0]?.getAttribute("title")).toBe("src/middleware/idempotency.ts");

    await typeQuery(host, "");
    expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("previews a result on click and opens it on double-click or Enter", async () => {
    const onPreviewFile = vi.fn();
    const onOpenFile = vi.fn();
    const gateway = staticSearch([result("src/app.ts")]);
    const host = render(
      { fileTree: fileTree({ onOpenFile, onPreviewFile }) },
      rightPanelTestContext({}, { fileSearch: gateway }),
    );
    await typeQuery(host, "app");
    const option = host.querySelector<HTMLElement>('[role="option"]');
    expect(option).not.toBeNull();
    if (option === null) return;

    act(() => option.click());
    expect(onPreviewFile).toHaveBeenCalledWith(entry(`${ROOT}/src/app.ts`));

    act(() => option.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    press(option, "Enter");
    expect(onOpenFile).toHaveBeenCalledTimes(2);
    expect(onOpenFile).toHaveBeenLastCalledWith(entry(`${ROOT}/src/app.ts`));
  });

  it("moves from the search field into the results with ArrowDown and clears with Escape", async () => {
    const gateway = staticSearch([result("a.ts"), result("b.ts")]);
    const host = render({}, rightPanelTestContext({}, { fileSearch: gateway }));
    await typeQuery(host, "ts");
    const input = searchField(host);
    if (input === null) return;

    press(input, "ArrowDown");
    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(document.activeElement).toBe(options[0]);
    press(options[0] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    press(options[1] as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(options[0]);

    press(input, "Escape");
    expect(input.value).toBe("");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("keeps the previous results inert while a new query is pending", async () => {
    const onPreviewFile = vi.fn();
    const onOpenFile = vi.fn();
    let pending: ((found: FileSearchResult[]) => void) | null = null;
    const gateway: FileSearchGateway = {
      searchFiles: (_root, query) =>
        query === "app"
          ? Promise.resolve([result("src/app.ts")])
          : new Promise((resolve) => {
              pending = resolve;
            }),
    };
    const host = render(
      { fileTree: fileTree({ onOpenFile, onPreviewFile }) },
      rightPanelTestContext({}, { fileSearch: gateway }),
    );
    await typeQuery(host, "app");
    expect(host.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBeNull();

    await typeQuery(host, "new");
    const list = host.querySelector('[role="listbox"]');
    const option = host.querySelector<HTMLElement>('[role="option"]');
    expect(list?.getAttribute("aria-busy")).toBe("true");
    expect(list?.classList).toContain("cv-files__list--stale");
    expect(option?.getAttribute("aria-disabled")).toBe("true");
    expect(option?.tabIndex).toBe(-1);
    if (option === null) return;
    act(() => option.click());
    act(() => option.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    press(option, "Enter");
    const input = searchField(host);
    if (input !== null) press(input, "ArrowDown");
    expect(document.activeElement).not.toBe(option);
    expect(onPreviewFile).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();

    await act(async () => pending?.([result("src/new.ts")]));
    const fresh = host.querySelector<HTMLElement>('[role="option"]');
    expect(host.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBeNull();
    expect(fresh?.getAttribute("aria-disabled")).toBeNull();
    act(() => fresh?.click());
    expect(onPreviewFile).toHaveBeenCalledWith(entry(`${ROOT}/src/new.ts`));
  });

  it("collapses every expanded folder from the surface header", () => {
    const toggleDirectory = vi.fn();
    const host = render({ fileTree: fileTree({ tree: { ...tree(), toggleDirectory } }) });
    const collapse = host.querySelector<HTMLButtonElement>('[aria-label="Collapse all folders"]');
    expect(collapse?.disabled).toBe(false);

    act(() => collapse?.click());

    expect(toggleDirectory).toHaveBeenCalledExactlyOnceWith(`${ROOT}/src`);
  });

  it("disables Collapse all folders when nothing is expanded", () => {
    const host = render({
      fileTree: fileTree({ tree: { ...tree(), expandedDirectories: new Set() } }),
    });
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Collapse all folders"]')?.disabled,
    ).toBe(true);
  });

  it("focuses the inline search field from the quick-open hint", () => {
    const host = render({});
    const hint = host.querySelector<HTMLElement>(".cv-files__search .cv-kbd");
    expect(hint).not.toBeNull();

    act(() =>
      hint?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })),
    );
    act(() => hint?.click());

    expect(document.activeElement).toBe(searchField(host));
  });

  it("reports empty, failed and truncated searches truthfully", async () => {
    const empty = staticSearch([]);
    const host = render({}, rightPanelTestContext({}, { fileSearch: empty }));
    await typeQuery(host, "zzz");
    expect(host.querySelector(".cv-files__results-note")?.textContent).toBe("No matching files.");

    resetUi();
    const failing: FileSearchGateway = {
      searchFiles: () => Promise.reject(new Error("Search is unavailable.")),
    };
    const failedHost = render({}, rightPanelTestContext({}, { fileSearch: failing }));
    await typeQuery(failedHost, "zzz");
    expect(failedHost.querySelector(".cv-files__results-note")?.textContent).toBe(
      "Search is unavailable.",
    );

    resetUi();
    const many = staticSearch(
      Array.from({ length: MAX_FILES_SEARCH_RESULTS + 1 }, (_, index) => result(`f${index}.ts`)),
    );
    const manyHost = render({}, rightPanelTestContext({}, { fileSearch: many }));
    await typeQuery(manyHost, "f");
    expect(manyHost.querySelectorAll('[role="option"]')).toHaveLength(MAX_FILES_SEARCH_RESULTS);
    expect(manyHost.querySelector(".cv-files__results-note")?.textContent).toBe(
      `Showing the first ${MAX_FILES_SEARCH_RESULTS} matches. Refine the search to narrow them.`,
    );
  });

  it("fills the surface with the tree and hosts no editor slot or crumbs", () => {
    const host = render({});

    expect(host.querySelector("[data-agent-editor-slot]")).toBeNull();
    expect(host.querySelector(".cv-files__crumbs")).toBeNull();
    expect(host.querySelector(".cv-files__preview")).toBeNull();
    expect(host.querySelector('[aria-label="Open in editor"]')).toBeNull();
    expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
  });

  it("drops the search and tree column while the tree is hidden", () => {
    const host = render({ treeShown: false });
    expect(searchField(host)).toBeNull();
    expect(host.querySelector('nav[aria-label="Workspace files"]')).toBeNull();
  });

  it("disables search while the tree is unavailable and never calls the gateway", async () => {
    const gateway = staticSearch([result("a.ts")]);
    const host = render(
      { fileTree: fileTree({ searchFiles: null, unavailable: { kind: "noProject" } }) },
      rightPanelTestContext({}, { fileSearch: gateway }),
    );

    expect(searchField(host)?.disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(FILES_SEARCH_DEBOUNCE_MS * 2);
    });
    expect(gateway.calls).toEqual([]);
  });

  it("renders no search or tree without a file tree", () => {
    const host = render({ fileTree: null });
    expect(searchField(host)).toBeNull();
    expect(host.querySelector('nav[aria-label="Workspace files"]')).toBeNull();
  });
});
