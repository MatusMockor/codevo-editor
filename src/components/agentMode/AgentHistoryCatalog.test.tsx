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

function render(catalog: AgentHistoryCatalogSurface, select = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<AgentHistoryCatalog catalog={catalog} onSelect={select} />));
  return select;
}

function rerender(catalog: AgentHistoryCatalogSurface) {
  act(() => root?.render(<AgentHistoryCatalog catalog={catalog} onSelect={vi.fn()} />));
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
