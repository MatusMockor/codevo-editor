// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHistoryCatalogRow,
  AgentHistoryCatalogSurface,
} from "../../application/useAgentHistoryCatalog";
import { catalogProject, catalogThread } from "../../test/agentHistoryCatalogFixtures";
import { AgentHistoryCatalog } from "./AgentHistoryCatalog";

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

function render(
  catalog: AgentHistoryCatalogSurface,
  select = vi.fn(),
  shownInRailThreadIds?: ReadonlySet<string>,
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <AgentHistoryCatalog
        catalog={catalog}
        onSelect={select}
        shownInRailThreadIds={shownInRailThreadIds}
      />,
    ),
  );
  return select;
}

function rerender(catalog: AgentHistoryCatalogSurface, shownInRailThreadIds?: ReadonlySet<string>) {
  act(() =>
    root?.render(
      <AgentHistoryCatalog
        catalog={catalog}
        onSelect={vi.fn()}
        shownInRailThreadIds={shownInRailThreadIds}
      />,
    ),
  );
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
    render({ ...catalog, page: { ...catalog.page!, hasEarlier: false } });
    expect(emptyText()).toBe("No saved conversations.");
    expect(button("Older conversations").disabled).toBe(true);
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
    rerender({ ...catalog, page: { ...catalog.page!, hasEarlier: false } }, shown);
    expect(emptyText()).toBe(ALREADY_OPEN);
    expect(button("Older conversations").disabled).toBe(true);
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
