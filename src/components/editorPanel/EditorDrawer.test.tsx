// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDrawerAvailability } from "../../domain/editorDrawer";
import { click, mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorDrawer, type EditorDrawerProps } from "./EditorDrawer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const JS: EditorDrawerAvailability = {
  artisan: false,
  expressRoutes: true,
  javaScriptWorkspace: true,
  nette: false,
  symfony: false,
  phpWorkspace: false,
};

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderDrawer(overrides: Partial<EditorDrawerProps> = {}) {
  const props: EditorDrawerProps = {
    view: "problems",
    availability: JS,
    problemCount: 3,
    headerExtras: null,
    height: 224,
    onSelectView: vi.fn(),
    onClose: vi.fn(),
    onResize: vi.fn(),
    children: <div data-testid="body">body</div>,
    ...overrides,
  };
  mounted = mountUi();
  mounted.render(<EditorDrawer {...props} />);
  return { host: mounted.host, props };
}

function menuItems(): Element[] {
  const menu = document.body.querySelector('[role="menu"][aria-label="More views"]');
  return [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];
}

describe("EditorDrawer", () => {
  it("shows Problems with its count and Debug console, Problems selected", () => {
    const { host } = renderDrawer();
    const tabs = [...host.querySelectorAll('[role="tab"]')];

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Problems3", "Debug console"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(
      host.querySelector('[role="tabpanel"][aria-label="Problems"] [data-testid="body"]'),
    ).not.toBeNull();
  });

  it("selects a view, lists the other views in More views, and closes", () => {
    const { host, props } = renderDrawer();
    click(host.querySelectorAll('[role="tab"]')[1] as Element);
    click(host.querySelector('button[aria-label="More views"]') as Element);
    const labels = menuItems().map((item) => item.textContent);
    click(menuItems().find((item) => item.textContent === "Search") as Element);
    click(host.querySelector('button[aria-label="Close panel views"]') as Element);

    expect(props.onSelectView).toHaveBeenNthCalledWith(1, "debug");
    expect(labels).toEqual([
      "Search",
      "Tests",
      "Index",
      "Runtime",
      "History",
      "Express routes",
      "Packages",
    ]);
    expect(props.onSelectView).toHaveBeenNthCalledWith(2, "search");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("adds the active secondary view as a third tab and uses the given height", () => {
    const { host } = renderDrawer({ view: "search" });

    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "Problems3",
      "Debug console",
      "Search",
    ]);
    expect((host.querySelector(".cv-edrawer") as HTMLElement).style.height).toBe("224px");
  });

  it("moves between tabs with the arrow keys", () => {
    const { host, props } = renderDrawer();
    press(host.querySelector('[role="tab"]') as Element, "ArrowRight");

    expect(props.onSelectView).toHaveBeenLastCalledWith("debug");
  });

  it("resizes from its top edge", () => {
    const { host, props } = renderDrawer();
    press(host.querySelector('[role="separator"]') as Element, "ArrowUp");

    expect(props.onResize).toHaveBeenLastCalledWith(240);
  });

  it("closes on Escape and returns focus to the active editor", () => {
    const onClose = vi.fn();
    mounted = mountUi();
    mounted.render(
      <div className="cv-editor-panel">
        <div className="editor-group active">
          <div className="editor-panel">
            <textarea className="inputarea" data-testid="editor-input" />
          </div>
        </div>
        <EditorDrawer
          availability={JS}
          headerExtras={null}
          height={224}
          onClose={onClose}
          onResize={vi.fn()}
          onSelectView={vi.fn()}
          problemCount={0}
          view="problems"
        >
          <div />
        </EditorDrawer>
      </div>,
    );
    const tab = mounted.host.querySelector<HTMLElement>('[role="tab"]');
    tab?.focus();
    press(tab as Element, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(mounted.host.querySelector('[data-testid="editor-input"]'));
  });

  it("leaves Escape to inputs and to children that already handled it", () => {
    const { host, props } = renderDrawer({
      children: (
        <div>
          <input data-testid="search" />
          <div
            data-testid="handled"
            onKeyDown={(event) => {
              if (event.key === "Escape") event.preventDefault();
            }}
            tabIndex={-1}
          />
        </div>
      ),
    });
    press(host.querySelector('[data-testid="search"]') as Element, "Escape");
    press(host.querySelector('[data-testid="handled"]') as Element, "Escape");

    expect(props.onClose).not.toHaveBeenCalled();
  });
});
