// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useAgentHistoryCatalog,
  type AgentHistoryCatalogGateway,
  type AgentHistoryCatalogRow,
  type AgentHistoryCatalogSurface,
} from "../../application/useAgentHistoryCatalog";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../../domain/agentProject";
import type {
  AgentHistoryThreadPage,
  ReadAgentHistoryThreadsRequest,
} from "../../domain/agentHistoryCatalog";
import type { AgentThread } from "../../domain/agentThread";
import { catalogProject, catalogThread } from "../../test/agentHistoryCatalogFixtures";
import { AgentHistoryCatalog } from "./AgentHistoryCatalog";
import {
  agentHistoryCatalogScope,
  type AgentHistoryCatalogProject,
  type AgentHistoryCatalogScope,
} from "./agentHistoryCatalogScope";

const OTHER = { rootKey: "/workspace/other", label: "other" };
const BOTH = [catalogProject, OTHER];
const MR_TITLE = "https://git.efabrica.sk/ebox/backend/crm/-/merge_requests/123 pozri";

function row(overrides: Partial<AgentHistoryCatalogRow> = {}): AgentHistoryCatalogRow {
  return {
    threadId: catalogThread().threadId,
    title: catalogThread().title,
    archived: false,
    running: false,
    provider: "codex",
    worktree: false,
    updatedAtEpochMs: 2,
    ...overrides,
  };
}

function surface(
  rows: ReadonlyArray<AgentHistoryCatalogRow> = [row()],
): AgentHistoryCatalogSurface {
  return {
    projects: [catalogProject],
    page: {
      rootKey: catalogProject.rootKey,
      threads: [catalogThread()],
      hasEarlier: true,
      beforeThreadId: catalogThread().threadId,
      atNewest: false,
      loading: false,
      deletingThreadId: null,
      error: null,
      notice: null,
    },
    rows,
    choose: vi.fn().mockResolvedValue(undefined),
    older: vi.fn().mockResolvedValue(undefined),
    latest: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    open: vi.fn().mockResolvedValue(true),
    rename: vi.fn().mockResolvedValue(true),
    setArchived: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function allProjects(
  projects: ReadonlyArray<AgentHistoryCatalogProject>,
  currentProjectRootKey: string | null = null,
): AgentHistoryCatalogScope {
  return agentHistoryCatalogScope(projects, {
    focus: "all",
    visibleEntries: [],
    currentProjectRootKey,
  });
}

function focusedOn(
  projects: ReadonlyArray<AgentHistoryCatalogProject>,
  projectRootKey: string,
): AgentHistoryCatalogScope {
  return agentHistoryCatalogScope(projects, {
    focus: "active",
    visibleEntries: [{ projectRootKey }],
    currentProjectRootKey: projectRootKey,
  });
}

function mount(element: ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

function render(
  catalog: AgentHistoryCatalogSurface,
  select = vi.fn(),
  shownInRailThreadIds?: ReadonlySet<string>,
  scope: AgentHistoryCatalogScope = allProjects(catalog.projects),
) {
  mount(
    <AgentHistoryCatalog
      catalog={catalog}
      onSelect={select}
      scope={scope}
      shownInRailThreadIds={shownInRailThreadIds}
    />,
  );
  return select;
}

function rerender(
  catalog: AgentHistoryCatalogSurface,
  shownInRailThreadIds?: ReadonlySet<string>,
  scope: AgentHistoryCatalogScope = allProjects(catalog.projects),
) {
  act(() =>
    root?.render(
      <AgentHistoryCatalog
        catalog={catalog}
        onSelect={vi.fn()}
        scope={scope}
        shownInRailThreadIds={shownInRailThreadIds}
      />,
    ),
  );
}

function paged(
  catalog: AgentHistoryCatalogSurface,
  patch: Partial<NonNullable<AgentHistoryCatalogSurface["page"]>>,
): AgentHistoryCatalogSurface {
  return { ...catalog, page: { ...catalog.page!, ...patch } };
}

function rebuiltEachRender() {
  const choose = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  return {
    choose,
    close,
    on: (rootKey: string, rows: ReadonlyArray<AgentHistoryCatalogRow> = [row()]) => ({
      ...twoProjects(rootKey, rows),
      choose,
      close,
    }),
  };
}

function twoProjects(
  rootKey: string | null,
  rows: ReadonlyArray<AgentHistoryCatalogRow> = [],
): AgentHistoryCatalogSurface {
  const catalog = surface(rows);
  return {
    ...catalog,
    projects: [catalogProject, OTHER],
    page: rootKey === null ? null : { ...catalog.page!, rootKey },
  };
}

const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
const button = (text: string) => buttons().find((item) => item.textContent === text)!;
const rowButtons = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("[data-saved-conversation-row]"));
const menuItem = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".cv-menu__item")).find((item) =>
    item.textContent?.includes(text),
  );
const dialog = () => document.querySelector('[role="dialog"]');
const rowTitles = () => rowButtons().map((item) => item.getAttribute("title"));
const emptyText = () =>
  document.querySelector(".agent-history-catalog__empty")?.textContent ?? null;
const ALREADY_OPEN = "Conversations on this page are already open.";
const ALL_ALREADY_OPEN = "All saved conversations are already open.";
const pagingFooter = () => document.querySelector(".agent-history-catalog__paging");
const pagingLabels = () =>
  Array.from(document.querySelectorAll(".agent-history-catalog__paging button")).map(
    (item) => item.textContent,
  );
const projectHeader = () => document.querySelector(".agent-history-catalog__header");
const shelfChildTags = () =>
  Array.from(document.querySelector(".agent-history-catalog")?.children ?? []).map(
    (item) => item.tagName,
  );
const statusText = () => document.querySelector('[role="status"]')?.textContent ?? null;
function openMenu(label: string) {
  act(() =>
    buttons()
      .find((item) => item.getAttribute("aria-label") === label)!
      .click(),
  );
}
function key(target: Element, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

describe("saved conversations UI", () => {
  it("opens only after restoration succeeds and exposes paging controls", async () => {
    const catalog = surface();
    const select = render(catalog);
    expect(button("Saved conversations").getAttribute("aria-expanded")).toBe("true");
    await act(async () => rowButtons()[0]!.click());
    expect(select).toHaveBeenCalledWith(catalogThread().threadId);
    act(() => button("Older conversations").click());
    expect(catalog.older).toHaveBeenCalledOnce();
    act(() => button("Back to newest").click());
    expect(catalog.latest).toHaveBeenCalledOnce();
  });

  it("does not navigate when restoration fails or when unmounted", async () => {
    let resolve!: (value: boolean) => void;
    const open = vi.fn().mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const select = render({ ...surface(), open });
    act(() => rowButtons()[0]!.click());
    act(() => root?.unmount());
    root = null;
    await act(async () => resolve(true));
    expect(select).not.toHaveBeenCalled();
  });

  it("shows a clean title, relative time, provider and checkout for each row", () => {
    render(surface([row({ title: MR_TITLE, worktree: true, archived: true })]));
    const main = rowButtons()[0]!;
    expect(main.querySelector(".agent-history-row__title")?.textContent).toBe(
      "git.efabrica.sk/…/merge_requests/123 pozri",
    );
    expect(main.getAttribute("title")).toBe(MR_TITLE);
    expect(main.querySelector(".agent-history-row__when")?.textContent).not.toBe("");
    expect(main.querySelector(".agent-history-row__meta")?.textContent).toContain("Codex");
    expect(main.querySelector(".agent-history-row__meta")?.textContent).toContain("Worktree");
    expect(main.querySelector(".agent-history-row__meta")?.textContent).toContain("Archived");
    expect(document.querySelector("h3")?.textContent).toBe(catalogProject.label);
  });

  it("asks before deleting, names the conversation, and does nothing on cancel", () => {
    const catalog = surface([row({ title: "Telekom phone" })]);
    render(catalog);
    openMenu("Actions for Telekom phone");
    act(() => menuItem("Delete")!.click());
    expect(dialog()?.querySelector(".agent-delete-dialog__name")?.textContent).toBe(
      "Telekom phone",
    );
    act(() => button("Cancel").click());
    expect(dialog()).toBeNull();
    expect(catalog.remove).not.toHaveBeenCalled();

    key(rowButtons()[0]!, { key: "Delete" });
    expect(dialog()?.textContent).toContain("Telekom phone");
    act(() => button("Delete thread").click());
    expect(catalog.remove).toHaveBeenCalledExactlyOnceWith(catalogThread().threadId);
  });

  it("never offers delete or archive for a running conversation", () => {
    const catalog = surface([row({ running: true })]);
    render(catalog);
    key(rowButtons()[0]!, { key: "Delete" });
    expect(dialog()).toBeNull();
    openMenu(`Actions for ${catalogThread().title}`);
    expect(menuItem("Delete")?.getAttribute("aria-disabled")).toBe("true");
    expect(menuItem("Archive thread")?.getAttribute("aria-disabled")).toBe("true");
    act(() => menuItem("Delete")!.click());
    expect(dialog()).toBeNull();
    expect(catalog.remove).not.toHaveBeenCalled();
  });

  it("renames inline from the menu and with F2", () => {
    const catalog = surface();
    render(catalog);
    openMenu(`Actions for ${catalogThread().title}`);
    act(() => menuItem("Rename thread")!.click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Telekom phone");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    key(input, { key: "Enter" });
    expect(catalog.rename).toHaveBeenCalledWith(catalogThread().threadId, "Telekom phone");

    key(rowButtons()[0]!, { key: "F2" });
    const again = document.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]')!;
    key(again, { key: "Escape" });
    expect(catalog.rename).toHaveBeenCalledOnce();
  });

  it("archives active conversations and unarchives archived ones", () => {
    const catalog = surface([row(), row({ threadId: "agt-2-0a1b", title: "Old", archived: true })]);
    render(catalog);
    openMenu(`Actions for ${catalogThread().title}`);
    act(() => menuItem("Archive thread")!.click());
    expect(catalog.setArchived).toHaveBeenCalledWith(catalogThread().threadId, true);
    openMenu("Actions for Old");
    act(() => menuItem("Unarchive thread")!.click());
    expect(catalog.setArchived).toHaveBeenCalledWith("agt-2-0a1b", false);
  });

  it("moves focus between rows with the arrow keys and shows failures", () => {
    const catalog = surface([row(), row({ threadId: "agt-2-0a1b", title: "Second" })]);
    render({
      ...catalog,
      page: { ...catalog.page!, error: "Could not delete this conversation: busy" },
    });
    const [first, second] = rowButtons();
    act(() => first!.focus());
    key(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    key(second!, { key: "Home" });
    expect(document.activeElement).toBe(first);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not delete this conversation: busy",
    );
  });

  it("heads the section with a shelf toggle that shows its open state with a chevron", () => {
    render(surface());
    const toggle = button("Saved conversations");
    expect(toggle.classList.contains("cv-sb-shelf")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.querySelector(".cv-sb-shelf__chevron")).not.toBeNull();
    expect(toggle.querySelector(".cv-sb-shelf__rule")).not.toBeNull();
  });

  it("renders its paging controls with the palette-aware foundation Button", () => {
    render(surface());
    for (const label of ["Older conversations", "Back to newest"]) {
      expect(button(label)?.classList.contains("cv-button"), label).toBe(true);
      expect(button(label)?.classList.contains("cv-button--ghost"), label).toBe(true);
    }
  });

  it("lets the foundation Button own its look and styles thread rows with palette tokens", () => {
    const component = readFileSync("src/components/agentMode/AgentHistoryCatalog.tsx", "utf8");
    expect(component).toContain('import "./agentHistoryCatalog.css";');
    const style = document.createElement("style");
    style.textContent = [
      readFileSync("src/ui/foundation/buttons.css", "utf8"),
      readFileSync("src/components/agentMode/agentHistory.css", "utf8"),
      readFileSync("src/components/agentMode/agentHistoryCatalog.css", "utf8"),
    ].join("\n");
    document.head.append(style);
    render(surface());
    for (const label of ["Older conversations", "Back to newest"]) {
      const computed = getComputedStyle(button(label));
      expect(computed.getPropertyValue("background"), label).toBe("transparent");
      expect(computed.getPropertyValue("color"), label).toBe("var(--cv-fg-muted)");
    }
    const main = getComputedStyle(rowButtons()[0]!);
    expect(main.getPropertyValue("background")).toBe("transparent");
    expect(main.getPropertyValue("color")).toBe("var(--cv-fg)");
    expect(main.getPropertyValue("border-radius")).toBe("var(--cv-r-control)");
    style.remove();
  });

  it("says which conversation is being deleted and locks the list and project switch", () => {
    const catalog = surface([row({ title: "Telekom phone" })]);
    render({
      ...catalog,
      projects: [catalogProject, { rootKey: "/workspace/other", label: "other" }],
      page: { ...catalog.page!, deletingThreadId: catalogThread().threadId },
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Deleting “Telekom phone”…",
    );
    expect(document.querySelector("select")?.disabled).toBe(true);
    expect(rowButtons()[0]?.disabled).toBe(true);
  });

  it("shows a warning notice when a delete only partly cleaned up", () => {
    const catalog = surface([]);
    render({
      ...catalog,
      page: { ...catalog.page!, notice: "Deleted, but attachments could not be removed" },
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Deleted, but attachments could not be removed",
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not claim there are no saved conversations while earlier pages exist", () => {
    const catalog = surface([]);
    render(catalog);
    expect(catalog.page?.hasEarlier).toBe(true);
    expect(rowButtons()).toEqual([]);
    expect(emptyText()).toBeNull();
    expect(button("Older conversations").disabled).toBe(false);
  });

  it("says there are no saved conversations when nothing is listed and nothing is earlier", () => {
    const catalog = surface([]);
    render(paged(catalog, { hasEarlier: false, atNewest: true }));
    expect(emptyText()).toBe("No saved conversations.");
    expect(shelfChildTags()).toEqual(["BUTTON", "P"]);
  });

  it.each([
    { hasEarlier: false, atNewest: true, labels: [] },
    { hasEarlier: true, atNewest: true, labels: ["Older conversations"] },
    { hasEarlier: false, atNewest: false, labels: ["Back to newest"] },
    { hasEarlier: true, atNewest: false, labels: ["Older conversations", "Back to newest"] },
  ])(
    "offers only the paging controls that lead somewhere: $labels",
    ({ hasEarlier, atNewest, labels }) => {
      render(paged(surface(), { hasEarlier, atNewest }));
      expect(pagingLabels()).toEqual(labels);
      expect(pagingFooter() === null).toBe(labels.length === 0);
    },
  );

  it("offers a refresh beside an error on the newest page", () => {
    const catalog = surface([]);
    render(paged(catalog, { hasEarlier: false, atNewest: true, error: "Could not load" }));
    expect(pagingLabels()).toEqual(["Refresh"]);
    act(() => button("Refresh").click());
    expect(catalog.latest).toHaveBeenCalledOnce();
    rerender(paged(catalog, { hasEarlier: true, atNewest: true, error: "Could not load" }));
    expect(pagingLabels()).toEqual(["Older conversations", "Refresh"]);
    rerender(paged(catalog, { hasEarlier: false, atNewest: false, error: "Could not load" }));
    expect(pagingLabels()).toEqual(["Back to newest"]);
    rerender(paged(catalog, { hasEarlier: false, atNewest: true }));
    expect(pagingFooter()).toBeNull();
  });

  it("does not claim there are no saved conversations on an emptied older page", () => {
    render(paged(surface([]), { hasEarlier: false, atNewest: false }));
    expect(emptyText()).toBeNull();
    expect(pagingLabels()).toEqual(["Back to newest"]);
  });

  it("locks the offered paging controls while the page is busy", () => {
    const catalog = surface();
    render(paged(catalog, { loading: true }));
    expect(button("Older conversations").disabled).toBe(true);
    expect(button("Back to newest").disabled).toBe(true);
    rerender(paged(catalog, { deletingThreadId: catalogThread().threadId }));
    expect(button("Older conversations").disabled).toBe(true);
    expect(button("Back to newest").disabled).toBe(true);
    rerender(catalog);
    expect(button("Older conversations").disabled).toBe(false);
    expect(button("Back to newest").disabled).toBe(false);
  });

  it("heads a single project only when it lists a conversation", () => {
    const catalog = surface([row()]);
    const shown = new Set([catalogThread().threadId]);
    render(catalog);
    expect(projectHeader()?.querySelector(".cv-favicon") ?? null).not.toBeNull();
    expect(document.querySelector("h3")?.textContent).toBe(catalogProject.label);
    rerender(catalog, shown);
    expect(projectHeader()).toBeNull();
    expect(document.querySelector("h3")).toBeNull();
    rerender(paged(catalog, { loading: true }), shown);
    expect(statusText()).toBe("Loading saved conversations…");
    expect(projectHeader()).toBeNull();
    rerender(paged(catalog, { error: "Could not load" }), shown);
    expect(projectHeader()).toBeNull();
    rerender(paged(catalog, { notice: "Deleted" }), shown);
    expect(projectHeader()).toBeNull();
    rerender(surface([]));
    expect(projectHeader()).toBeNull();
  });

  it("keeps the project switch when several projects are in scope and nothing is listed", () => {
    const catalog = paged(twoProjects(catalogProject.rootKey), {
      hasEarlier: false,
      atNewest: true,
    });
    render(catalog);
    expect(rowButtons()).toEqual([]);
    expect(emptyText()).toBe("No saved conversations.");
    expect(document.querySelector("select")?.value).toBe(catalogProject.rootKey);
    expect(projectHeader()?.querySelector(".cv-favicon") ?? null).not.toBeNull();
    expect(document.querySelector("h3")).toBeNull();
    expect(pagingFooter()).toBeNull();
  });

  it("hides a row the rail already shows and lists the ones it does not", () => {
    const catalog = surface([
      row({ title: "In rail" }),
      row({ threadId: "agt-2-0a1b", title: "Live but not in rail", running: true }),
      row({ threadId: "agt-3-0a1b", title: "Archived", archived: true }),
    ]);
    render(catalog, vi.fn(), new Set([catalogThread().threadId]));
    expect(rowTitles()).toEqual(["Live but not in rail", "Archived"]);
    expect(emptyText()).toBeNull();
    rerender(catalog, new Set());
    expect(rowTitles()).toEqual(["In rail", "Live but not in rail", "Archived"]);
  });

  it("lists every row when no rail thread ids are given", () => {
    render(surface([row(), row({ threadId: "agt-2-0a1b", title: "Second" })]));
    expect(rowTitles()).toEqual([catalogThread().title, "Second"]);
  });

  it("says the page is already open when the rail shows all of its rows", () => {
    const catalog = surface([row(), row({ threadId: "agt-2-0a1b", title: "Second" })]);
    const shown = new Set([catalogThread().threadId, "agt-2-0a1b"]);
    render(catalog, vi.fn(), shown);
    expect(rowButtons()).toEqual([]);
    expect(emptyText()).toBe(ALREADY_OPEN);
    expect(button("Older conversations").disabled).toBe(false);
    rerender(paged(catalog, { hasEarlier: false }), shown);
    expect(emptyText()).toBe(ALREADY_OPEN);
    expect(pagingLabels()).toEqual(["Back to newest"]);
    rerender(paged(catalog, { atNewest: true }), shown);
    expect(emptyText()).toBe(ALREADY_OPEN);
    expect(pagingLabels()).toEqual(["Older conversations"]);
  });

  it("says in one quiet line that every saved conversation is already open", () => {
    const catalog = surface([row(), row({ threadId: "agt-2-0a1b", title: "Second" })]);
    const shown = new Set([catalogThread().threadId, "agt-2-0a1b"]);
    render(paged(catalog, { hasEarlier: false, atNewest: true }), vi.fn(), shown);
    expect(emptyText()).toBe(ALL_ALREADY_OPEN);
    expect(shelfChildTags()).toEqual(["BUTTON", "P"]);
    rerender(paged(catalog, { hasEarlier: false, atNewest: true }), new Set());
    expect(emptyText()).toBeNull();
    expect(rowTitles()).toEqual([catalogThread().title, "Second"]);
    expect(shelfChildTags()).toEqual(["BUTTON", "HEADER", "UL"]);
  });

  it("keeps the empty texts out of the way of loading, errors and notices", () => {
    const catalog = surface([row()]);
    const shown = new Set([catalogThread().threadId]);
    render({ ...catalog, page: { ...catalog.page!, loading: true } }, vi.fn(), shown);
    expect(emptyText()).toBeNull();
    rerender({ ...catalog, page: { ...catalog.page!, error: "Could not load" } }, shown);
    expect(emptyText()).toBeNull();
    rerender({ ...catalog, page: { ...catalog.page!, notice: "Deleted" } }, shown);
    expect(emptyText()).toBeNull();
  });

  it("still names the conversation being deleted when the rail shows it", () => {
    const catalog = surface([row({ title: "Telekom phone" })]);
    render(
      { ...catalog, page: { ...catalog.page!, deletingThreadId: catalogThread().threadId } },
      vi.fn(),
      new Set([catalogThread().threadId]),
    );
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Deleting “Telekom phone”…",
    );
    expect(rowButtons()).toEqual([]);
    expect(emptyText()).toBeNull();
  });

  it("skips rows hidden by the rail when moving focus with the arrow keys", () => {
    const catalog = surface([
      row({ title: "First" }),
      row({ threadId: "agt-2-0a1b", title: "Hidden" }),
      row({ threadId: "agt-3-0a1b", title: "Third" }),
    ]);
    render(catalog, vi.fn(), new Set(["agt-2-0a1b"]));
    const [first, third] = rowButtons();
    act(() => first!.focus());
    key(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(third);
    expect(third?.getAttribute("title")).toBe("Third");
  });

  it("moves focus to the next listed row after a delete when a hidden row sits before it", async () => {
    const hidden = row({ threadId: "agt-9-0a1b", title: "Hidden" });
    const first = row({ title: "First" });
    const second = row({ threadId: "agt-2-0a1b", title: "Second" });
    const third = row({ threadId: "agt-3-0a1b", title: "Third" });
    const shown = new Set([hidden.threadId]);
    const catalog = surface([hidden, first, second, third]);
    render(catalog, vi.fn(), shown);
    expect(rowTitles()).toEqual(["First", "Second", "Third"]);
    key(rowButtons()[0]!, { key: "Delete" });
    await act(async () => button("Delete thread").click());
    expect(catalog.remove).toHaveBeenCalledWith(first.threadId);
    rerender({ ...catalog, rows: [hidden, second, third] }, shown);
    expect(rowTitles()).toEqual(["Second", "Third"]);
    expect(document.activeElement).toBe(rowButtons()[0]);
  });

  it("keeps focus where it is when a row leaves the shelf without a delete", () => {
    const second = row({ threadId: "agt-2-0a1b", title: "Second" });
    const catalog = surface([row(), second]);
    render(catalog);
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    rerender({ ...catalog, rows: [second] });
    expect(document.activeElement).toBe(outside);
    expect(rowButtons().map((item) => item.getAttribute("title"))).toEqual(["Second"]);
    outside.remove();
  });

  it("moves focus to the next row after a confirmed delete", async () => {
    const second = row({ threadId: "agt-2-0a1b", title: "Second" });
    const catalog = surface([row(), second]);
    render(catalog);
    key(rowButtons()[0]!, { key: "Delete" });
    await act(async () => button("Delete thread").click());
    expect(catalog.remove).toHaveBeenCalledWith(catalogThread().threadId);
    rerender({ ...catalog, rows: [second] });
    expect(document.activeElement).toBe(rowButtons()[0]);
    expect(rowButtons()[0]?.getAttribute("title")).toBe("Second");
  });

  it("returns focus to the row after a rename is cancelled", () => {
    render(surface());
    key(rowButtons()[0]!, { key: "F2" });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]')!;
    key(input, { key: "Escape" });
    expect(document.activeElement).toBe(rowButtons()[0]);
  });
});

describe("saved conversations follow the rail project scope", () => {
  it("opens the focused project instead of the first one and offers no project switch", () => {
    const closed = twoProjects(null);
    render(closed, vi.fn(), undefined, focusedOn(closed.projects, OTHER.rootKey));
    expect(button("Saved conversations").getAttribute("aria-expanded")).toBe("false");
    act(() => button("Saved conversations").click());
    expect(closed.choose).toHaveBeenCalledExactlyOnceWith(OTHER.rootKey);

    const open = twoProjects(OTHER.rootKey, [row({ title: "Other saved" })]);
    rerender(open, undefined, focusedOn(open.projects, OTHER.rootKey));
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelector("h3")?.textContent).toBe(OTHER.label);
    expect(rowTitles()).toEqual(["Other saved"]);
  });

  it("opens on the rail's current project while every project is in scope", () => {
    const closed = twoProjects(null);
    render(closed, vi.fn(), undefined, allProjects(closed.projects, OTHER.rootKey));
    act(() => button("Saved conversations").click());
    expect(closed.choose).toHaveBeenCalledExactlyOnceWith(OTHER.rootKey);

    const open = twoProjects(OTHER.rootKey);
    rerender(open, undefined, allProjects(open.projects, OTHER.rootKey));
    const select = document.querySelector("select");
    expect(select?.value).toBe(OTHER.rootKey);
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      catalogProject.rootKey,
      OTHER.rootKey,
    ]);
  });

  it("opens on the first project when the rail's current project is not in the catalog", () => {
    const closed = twoProjects(null);
    render(closed, vi.fn(), undefined, allProjects(closed.projects, "remote:server:/srv/app"));
    act(() => button("Saved conversations").click());
    expect(closed.choose).toHaveBeenCalledExactlyOnceWith(catalogProject.rootKey);
  });

  it("is not rendered while the focused project is not a catalog project", () => {
    const catalog = twoProjects(null);
    render(catalog, vi.fn(), undefined, focusedOn(catalog.projects, "remote:server:/srv/app"));
    expect(document.querySelector(".agent-history-catalog")).toBeNull();
    expect(catalog.choose).not.toHaveBeenCalled();
    expect(catalog.close).not.toHaveBeenCalled();
  });

  it("drops the open project's rows at once and switches when the rail focus leaves it", () => {
    const shelf = rebuiltEachRender();
    const appRows = [row({ title: "App saved" })];
    render(shelf.on(catalogProject.rootKey, appRows));
    expect(rowTitles()).toEqual(["App saved"]);
    expect(shelf.choose).not.toHaveBeenCalled();

    rerender(shelf.on(catalogProject.rootKey, appRows), undefined, focusedOn(BOTH, OTHER.rootKey));
    expect(rowTitles()).toEqual([]);
    expect(document.querySelector(".agent-history-catalog__header")).toBeNull();
    expect(button("Saved conversations").getAttribute("aria-expanded")).toBe("false");
    expect(shelf.choose).toHaveBeenCalledExactlyOnceWith(OTHER.rootKey);

    rerender(shelf.on(catalogProject.rootKey, appRows), undefined, focusedOn(BOTH, OTHER.rootKey));
    expect(rowTitles()).toEqual([]);
    expect(shelf.choose).toHaveBeenCalledOnce();

    const otherRows = [row({ title: "Other saved" })];
    rerender(shelf.on(OTHER.rootKey, otherRows), undefined, focusedOn(BOTH, OTHER.rootKey));
    expect(rowTitles()).toEqual(["Other saved"]);
    expect(document.querySelector("h3")?.textContent).toBe(OTHER.label);
    expect(shelf.choose).toHaveBeenCalledOnce();
    expect(shelf.close).not.toHaveBeenCalled();
  });

  it("switches again on every later focus change, once each", () => {
    const shelf = rebuiltEachRender();
    render(shelf.on(catalogProject.rootKey));
    rerender(shelf.on(catalogProject.rootKey), undefined, focusedOn(BOTH, OTHER.rootKey));
    rerender(shelf.on(OTHER.rootKey), undefined, focusedOn(BOTH, OTHER.rootKey));
    rerender(shelf.on(OTHER.rootKey), undefined, focusedOn(BOTH, catalogProject.rootKey));
    expect(rowTitles()).toEqual([]);
    rerender(shelf.on(catalogProject.rootKey), undefined, focusedOn(BOTH, catalogProject.rootKey));
    expect(rowTitles()).toEqual([catalogThread().title]);
    expect(shelf.choose.mock.calls).toEqual([[OTHER.rootKey], [catalogProject.rootKey]]);
    expect(shelf.close).not.toHaveBeenCalled();
  });

  it("takes a pending delete confirmation away with the out-of-scope rows", () => {
    const catalog = twoProjects(catalogProject.rootKey, [row({ title: "App saved" })]);
    render(catalog);
    key(rowButtons()[0]!, { key: "Delete" });
    expect(dialog()).not.toBeNull();

    rerender(catalog, undefined, focusedOn(catalog.projects, OTHER.rootKey));
    expect(dialog()).toBeNull();
    expect(rowButtons()).toEqual([]);
    expect(catalog.remove).not.toHaveBeenCalled();
    expect(catalog.open).not.toHaveBeenCalled();
    expect(catalog.rename).not.toHaveBeenCalled();
    expect(catalog.setArchived).not.toHaveBeenCalled();
  });

  it("closes the open project when the rail focus moves to a project the catalog does not serve", () => {
    const catalog = twoProjects(catalogProject.rootKey, [row({ title: "App saved" })]);
    render(catalog);
    rerender(catalog, undefined, focusedOn(catalog.projects, "remote:server:/srv/app"));
    expect(document.querySelector(".agent-history-catalog")).toBeNull();
    expect(catalog.close).toHaveBeenCalledOnce();
    expect(catalog.choose).not.toHaveBeenCalled();
    rerender({ ...catalog }, undefined, focusedOn(catalog.projects, "remote:server:/srv/app"));
    expect(catalog.close).toHaveBeenCalledOnce();
  });

  it("keeps a delete owned when the rail focus leaves and returns before it settles", async () => {
    const shelf = liveShelf();
    await shelf.open(catalogProject.rootKey);
    expect(rowTitles()).toEqual(["agt-1-0a1b", "agt-2-0a1b"]);
    await shelf.startDelete("agt-1-0a1b");

    await shelf.show(OTHER.rootKey);
    const whileAway = rowTitles();
    await shelf.show(catalogProject.rootKey);
    const onReturn = statusText();
    await act(async () => shelf.settleDelete("deleted"));

    expect(rowTitles()).toEqual(["agt-2-0a1b"]);
    expect(whileAway).toEqual([]);
    expect(onReturn).toBe("Deleting “agt-1-0a1b”…");
    expect(statusText()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey]);
    expect(shelf.report).not.toHaveBeenCalled();
  });

  it("requests the in-scope project once, and only after an in-flight delete settles", async () => {
    const shelf = liveShelf();
    await shelf.open(catalogProject.rootKey);
    await shelf.startDelete("agt-1-0a1b");

    await shelf.show(OTHER.rootKey);
    await shelf.show(OTHER.rootKey);
    expect(rowTitles()).toEqual([]);
    expect(document.querySelector(".agent-history-catalog__header")).toBeNull();
    expect(statusText()).toBeNull();
    expect(button("Saved conversations").getAttribute("aria-expanded")).toBe("false");
    expect(button("Saved conversations").disabled).toBe(true);
    await act(async () => button("Saved conversations").click());
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey]);

    await act(async () => shelf.settleDelete("deleted"));
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey, OTHER.rootKey]);
    expect(rowTitles()).toEqual(["agt-9-0a1b"]);
    expect(document.querySelector("h3")?.textContent).toBe(OTHER.label);
    expect(button("Saved conversations").disabled).toBe(false);
    expect(statusText()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(shelf.report).not.toHaveBeenCalled();

    await shelf.show(catalogProject.rootKey);
    expect(rowTitles()).toEqual(["agt-2-0a1b"]);
  });

  it("survives a focus change during a delete and ends on the in-scope project's page", async () => {
    const shelf = liveShelf({ threadIds: ["agt-1-0a1b"], hasEarlier: true });
    await shelf.open(catalogProject.rootKey);
    await shelf.startDelete("agt-1-0a1b");

    await shelf.show(OTHER.rootKey);
    expect(rowTitles()).toEqual([]);
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey]);

    await act(async () => shelf.settleDelete("deleted"));
    expect(shelf.requestedRootKeys()).toEqual([
      catalogProject.rootKey,
      catalogProject.rootKey,
      OTHER.rootKey,
    ]);
    expect(rowTitles()).toEqual(["agt-9-0a1b"]);
    expect(document.querySelector("h3")?.textContent).toBe(OTHER.label);
    expect(statusText()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(shelf.report).not.toHaveBeenCalled();
  });

  it("switches once a failing delete settles while its project is out of scope", async () => {
    const shelf = liveShelf();
    await shelf.open(catalogProject.rootKey);
    await shelf.startDelete("agt-1-0a1b");

    await shelf.show(OTHER.rootKey);
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey]);
    await act(async () => shelf.settleDelete("failed"));
    expect(shelf.report).toHaveBeenCalledOnce();
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey, OTHER.rootKey]);
    expect(rowTitles()).toEqual(["agt-9-0a1b"]);
    expect(document.querySelector('[role="alert"]')).toBeNull();

    await shelf.show(catalogProject.rootKey);
    expect(rowTitles()).toEqual(["agt-1-0a1b", "agt-2-0a1b"]);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a delete owned across a focus on a project the catalog does not serve", async () => {
    const shelf = liveShelf();
    await shelf.open(catalogProject.rootKey);
    await shelf.startDelete("agt-1-0a1b");

    await shelf.show("remote:server:/srv/app");
    expect(document.querySelector(".agent-history-catalog")).toBeNull();
    await shelf.show(catalogProject.rootKey);
    expect(statusText()).toBe("Deleting “agt-1-0a1b”…");
    await act(async () => shelf.settleDelete("deleted"));
    expect(rowTitles()).toEqual(["agt-2-0a1b"]);
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey]);

    await shelf.startDelete("agt-2-0a1b");
    await shelf.show("remote:server:/srv/app");
    await act(async () => shelf.settleDelete("deleted"));
    await shelf.show(catalogProject.rootKey);
    expect(button("Saved conversations").getAttribute("aria-expanded")).toBe("false");
    expect(shelf.requestedRootKeys()).toEqual([catalogProject.rootKey]);
    expect(shelf.report).not.toHaveBeenCalled();
  });
});

type DeleteOutcome = "deleted" | "failed";

function liveShelf(
  app: { readonly threadIds: ReadonlyArray<string>; readonly hasEarlier: boolean } = {
    threadIds: ["agt-1-0a1b", "agt-2-0a1b"],
    hasEarlier: false,
  },
) {
  const other: AgentProjectDescriptor = {
    ...catalogProject,
    rootKey: OTHER.rootKey,
    rootPath: OTHER.rootKey,
    ownerId: "workspace-2",
    label: OTHER.label,
  };
  const projects = [catalogProject, other];
  const persisted = new Map<string, ReadonlyArray<AgentThread>>([
    [catalogProject.rootKey, app.threadIds.map((threadId) => catalogThread(threadId))],
    [other.rootKey, [threadOf(other, "agt-9-0a1b")]],
  ]);
  const threads = new Map<string, AgentThread>();
  const pendingDeletes: Array<(outcome: DeleteOutcome) => void> = [];
  const read = vi.fn(
    async (request: ReadAgentHistoryThreadsRequest): Promise<AgentHistoryThreadPage> => {
      const saved = persisted.get(request.rootKey) ?? [];
      return {
        threads: saved,
        beforeThreadId: saved[saved.length - 1]?.threadId ?? null,
        hasEarlier:
          app.hasEarlier && request.rootKey === catalogProject.rootKey && saved.length > 0,
      };
    },
  );
  const turns = vi.fn<AgentHistoryCatalogGateway["readAgentHistoryTurns"]>();
  const deleteSavedThread = vi.fn(
    (thread: AgentThread) =>
      new Promise<void>((done, fail) => {
        pendingDeletes.push((outcome) => {
          if (outcome === "failed") return fail(new Error("disk busy"));
          const saved = persisted.get(thread.owner.rootKey) ?? [];
          persisted.set(
            thread.owner.rootKey,
            saved.filter((candidate) => candidate.threadId !== thread.threadId),
          );
          done();
        });
      }),
  );
  const report = vi.fn();
  function Shelf({ focused }: { readonly focused: string }) {
    const catalog = useAgentHistoryCatalog({
      projects,
      gateway: { readAgentHistoryThreads: read, readAgentHistoryTurns: turns },
      currentState: () => ({ threads }),
      restoreThread: async () => false,
      renameThread: () => undefined,
      archiveThread: () => false,
      unarchiveThread: () => false,
      removeThread: () => false,
      deleteSavedThread,
      reportError: report,
    });
    return (
      <AgentHistoryCatalog
        catalog={catalog}
        onSelect={() => undefined}
        scope={focusedOn(catalog.projects, focused)}
      />
    );
  }
  async function show(focused: string) {
    if (root === null) mount(<Shelf focused={focused} />);
    await act(async () => root?.render(<Shelf focused={focused} />));
  }
  return {
    report,
    requestedRootKeys: () => read.mock.calls.map(([request]) => request.rootKey),
    settleDelete: (outcome: DeleteOutcome) =>
      pendingDeletes.splice(0).forEach((settle) => settle(outcome)),
    show,
    async open(focused: string) {
      await show(focused);
      await act(async () => button("Saved conversations").click());
    },
    async startDelete(title: string) {
      const target = rowButtons().find((item) => item.getAttribute("title") === title);
      expect(target).toBeDefined();
      key(target!, { key: "Delete" });
      await act(async () => button("Delete thread").click());
      expect(deleteSavedThread).toHaveBeenCalled();
      expect(statusText()).toBe(`Deleting “${title}”…`);
    },
  };
}

function threadOf(project: AgentProjectDescriptor, threadId: string): AgentThread {
  const thread = catalogThread(threadId);
  return {
    ...thread,
    owner: {
      rootKey: project.rootKey,
      ownerId: agentRootOwnerId(project.rootKey),
      repositoryRoot: project.rootPath,
    },
  };
}
