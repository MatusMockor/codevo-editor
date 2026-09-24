// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../foundation/foundationTestSupport";
import { ProjectFavicon } from "./ProjectFavicon";
import { projectInitial } from "./projectInitial";
import { TopBar, TopBarSeparator } from "./TopBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(): MountedUi {
  mounted = mountUi();
  return mounted;
}

describe("TopBar", () => {
  it("renders a labelled drag-region header with only the slots it was given", () => {
    const view = mount();
    view.render(
      <TopBar label="Thread" region="main">
        <span>Title</span>
      </TopBar>,
    );

    const header = view.host.querySelector("header");
    expect(header?.getAttribute("aria-label")).toBe("Thread");
    expect(header?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(header?.className).toBe("cv-topbar cv-topbar--main");
    expect(view.host.querySelector(".cv-topbar__title")?.textContent).toBe("Title");
    expect(view.host.querySelector(".cv-topbar__leading")).toBeNull();
    expect(view.host.querySelector(".cv-topbar__actions")).toBeNull();
    expect(view.host.querySelector(".cv-topbar__trailing")).toBeNull();
  });

  it("orders leading, title, hover actions and trailing and keeps controls out of the drag region", () => {
    const view = mount();
    view.render(
      <TopBar
        actions={<button type="button">Open</button>}
        label="Thread"
        leading={<button type="button">Expand</button>}
        region="main"
        trailing={<button type="button">Toggle</button>}
      >
        <span>Title</span>
      </TopBar>,
    );

    const slots = [...(view.host.querySelector("header")?.children ?? [])].map(
      (child) => child.className,
    );
    expect(slots).toEqual([
      "cv-topbar__leading",
      "cv-topbar__title",
      "cv-topbar__actions",
      "cv-topbar__trailing",
    ]);
    for (const button of view.host.querySelectorAll("button")) {
      expect(button.hasAttribute("data-tauri-drag-region")).toBe(false);
      expect(button.closest("[data-tauri-drag-region]")?.tagName).toBe("HEADER");
    }
  });

  it("marks the window edge and forwards data attributes and extra classes", () => {
    const view = mount();
    view.render(
      <TopBar
        className="agent-surface__head"
        data-agent-surface-head=""
        label="Right panel"
        region="panel"
        windowEdge
      />,
    );

    const header = view.host.querySelector("header");
    expect(header?.className).toBe(
      "cv-topbar cv-topbar--panel cv-topbar--window-edge agent-surface__head",
    );
    expect(header?.hasAttribute("data-agent-surface-head")).toBe(true);
  });

  it("hides the separator from assistive technology", () => {
    const view = mount();
    view.render(<TopBarSeparator />);

    expect(view.host.querySelector(".cv-topbar__separator")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("ProjectFavicon", () => {
  it("shows the upper-cased first character of the project label", () => {
    expect(projectInitial("orders-api")).toBe("O");
    expect(projectInitial("  web-dashboard")).toBe("W");
    expect(projectInitial("")).toBe("?");
    expect(projectInitial("   ")).toBe("?");
    expect(projectInitial("\u{1F680}rocket")).toBe("\u{1F680}");
  });

  it("renders a decorative favicon", () => {
    const view = mount();
    view.render(<ProjectFavicon label="orders-api" />);

    const favicon = view.host.querySelector(".cv-favicon");
    expect(favicon?.textContent).toBe("O");
    expect(favicon?.getAttribute("aria-hidden")).toBe("true");
  });
});
