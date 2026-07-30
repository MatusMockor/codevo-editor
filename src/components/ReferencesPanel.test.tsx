// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageServerLocation } from "../domain/languageServerFeatures";
import type { ReferenceRow, ReferencesView } from "../domain/referencesView";
import { REFERENCES_PANEL_PAGE_SIZE, ReferencesPanel } from "./ReferencesPanel";

describe("ReferencesPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders nothing while closed", async () => {
    await renderPanel({ isOpen: false });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("lists the aggregated references grouped by file", async () => {
    await renderPanel();

    const rows = referenceRowButtons();

    expect(rows).toHaveLength(3);
    expect(host.textContent).toContain("References to loadUser");
    expect(host.textContent).toContain("3 references");
    expect(host.textContent).toContain("app/A.php");
    expect(host.textContent).toContain("app/B.php");
    expect(rows[0].textContent).toContain("app/A.php:2");
    expect(rows[2].textContent).toContain("app/B.php:10");
  });

  it("navigates to the clicked reference row", async () => {
    const onOpen = vi.fn();
    await renderPanel({ onOpen });

    await act(async () => {
      referenceRowButtons()[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledOnce();
    const row = onOpen.mock.calls[0][0] as ReferenceRow;
    expect(row.relativePath).toBe("app/B.php");
    expect(row.line).toBe(10);
    expect(row.column).toBe(7);
  });

  it("shows an empty state when the symbol has no references", async () => {
    await renderPanel({
      view: { symbol: "orphan", locations: [] },
    });

    expect(referenceRowButtons()).toHaveLength(0);
    expect(host.textContent).toContain("No references found");
  });

  it("surfaces incomplete projections instead of presenting them as complete", async () => {
    await renderPanel({
      view: {
        isIncomplete: true,
        locations: defaultView().locations.slice(0, 2),
        symbol: "loadUser",
        totalCount: 7,
      },
    });

    expect(host.textContent).toContain("Showing 2 of 7 references");
    expect(host.textContent).toContain("Some references were omitted by safety limits.");
  });

  it("keeps large result rendering bounded and navigates across pages", async () => {
    const locations = Array.from({ length: REFERENCES_PANEL_PAGE_SIZE * 3 }, (_, index) =>
      location(`file:///workspace/src/file-${index}.ts`, index, 0),
    );
    const onOpen = vi.fn();
    await renderPanel({
      onOpen,
      view: {
        locations,
        symbol: "value",
        totalCount: locations.length,
      },
    });

    expect(referenceRowButtons()).toHaveLength(REFERENCES_PANEL_PAGE_SIZE);

    await act(async () => {
      const next = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Next",
      );
      next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(referenceRowButtons()).toHaveLength(REFERENCES_PANEL_PAGE_SIZE);
    expect(host.textContent).toContain(
      `${REFERENCES_PANEL_PAGE_SIZE + 1}–${REFERENCES_PANEL_PAGE_SIZE * 2}`,
    );
    const firstVisibleTitle = referenceRowButtons()[0]?.title;

    await act(async () => {
      panelDialog().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onOpen).toHaveBeenCalledOnce();
    const opened = onOpen.mock.calls[0][0] as ReferenceRow;
    expect(`${opened.relativePath}:${opened.line}:${opened.column}`).toBe(firstVisibleTitle);
  });

  it("opens the active row with Enter", async () => {
    const onOpen = vi.fn();
    await renderPanel({ onOpen });

    await act(async () => {
      panelDialog().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onOpen).toHaveBeenCalledOnce();
    expect((onOpen.mock.calls[0][0] as ReferenceRow).relativePath).toBe("app/A.php");
  });

  it("closes when Escape is pressed", async () => {
    const onClose = vi.fn();
    await renderPanel({ onClose });

    await act(async () => {
      panelDialog().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  async function renderPanel(
    overrides: Partial<{
      isOpen: boolean;
      onClose: () => void;
      onOpen: (row: ReferenceRow) => void;
      view: ReferencesView | null;
      workspaceRoot: string | null;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <ReferencesPanel
          isOpen={overrides.isOpen ?? true}
          onClose={overrides.onClose ?? vi.fn()}
          onOpen={overrides.onOpen ?? vi.fn()}
          view={overrides.view ?? defaultView()}
          workspaceRoot={
            overrides.workspaceRoot === undefined ? "/workspace" : overrides.workspaceRoot
          }
        />,
      );
      await Promise.resolve();
    });
  }

  function referenceRowButtons(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  }

  function panelDialog(): HTMLElement {
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');

    if (!dialog) {
      throw new Error("References panel dialog was not rendered.");
    }

    return dialog;
  }
});

function defaultView(): ReferencesView {
  return {
    symbol: "loadUser",
    locations: [
      location("file:///workspace/app/B.php", 9, 6),
      location("file:///workspace/app/A.php", 4, 2),
      location("file:///workspace/app/A.php", 1, 0),
    ],
  };
}

function location(uri: string, line: number, character: number): LanguageServerLocation {
  return {
    uri,
    range: {
      start: { line, character },
      end: { line, character: character + 4 },
    },
  };
}
