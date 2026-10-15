// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, press, type MountedUi } from "./foundationTestSupport";
import { PanelTabs, type PanelTabItem } from "./PanelTabs";
import { TreeRow } from "./TreeRow";
import { parseCssRules, readStyleSheet } from "../../components/cssContractTestSupport";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

const TABS: readonly PanelTabItem[] = [
  { id: "diff", title: "Diff", icon: <svg />, panelId: "panel-diff", closable: false },
  { id: "app.ts", title: "app.ts", icon: <svg />, panelId: "panel-app", dirty: true },
  { id: "readme", title: "README.md", icon: <svg />, panelId: "panel-readme", preview: true },
  { id: "term", title: "Terminal", icon: <svg />, panelId: "panel-term", live: true },
];

describe("PanelTabs", () => {
  it("renders a labelled tablist with one selected tab stop", () => {
    const { host } = mount(
      <PanelTabs label="Right panel" onSelect={() => undefined} selectedId="app.ts" tabs={TABS} />,
    );
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Right panel");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(tabs[1]?.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    expect(tabs[2]?.className).toContain("cv-tab--preview");
    expect(tabs[3]?.querySelector('[aria-label="Running"]')).not.toBeNull();
    expect(tabs.map((tab) => tab.getAttribute("aria-controls"))).toEqual([
      "panel-diff",
      "panel-app",
      "panel-readme",
      "panel-term",
    ]);
  });

  it("selects by click and by arrow keys, moving focus", () => {
    const onSelect = vi.fn();
    const { host } = mount(
      <PanelTabs label="Right panel" onSelect={onSelect} selectedId="term" tabs={TABS} />,
    );
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    click(tabs()[2] as Element);
    press(tabs()[3] as Element, "ArrowRight");

    expect(onSelect.mock.calls.map((call) => call[0])).toEqual(["readme", "diff"]);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("closes through the pointer affordance without selecting, and with Delete only", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onClose={onClose}
        onSelect={onSelect}
        selectedId="readme"
        tabs={TABS}
      />,
    );
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    click(tabs[1]?.querySelector(".cv-tab__close") as Element);
    press(host.querySelector('[role="tablist"]') as Element, "Backspace");
    press(host.querySelector('[role="tablist"]') as Element, "Delete");

    expect(onClose.mock.calls.map((call) => call[0])).toEqual(["app.ts", "readme"]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabs[0]?.querySelector(".cv-tab__close")).toBeNull();
    expect(tabs.map((tab) => tab.getAttribute("aria-keyshortcuts"))).toEqual([
      null,
      "Delete",
      "Delete",
      "Delete",
    ]);
  });

  it("omits aria-controls for a tab without a rendered panel", () => {
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onSelect={() => undefined}
        selectedId="solo"
        tabs={[{ id: "solo", title: "Solo", icon: <svg /> }]}
      />,
    );

    expect(host.querySelector('[role="tab"]')?.hasAttribute("aria-controls")).toBe(false);
  });

  it("nests no interactive control inside a tab", () => {
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onClose={() => undefined}
        onSelect={() => undefined}
        selectedId="readme"
        tabs={TABS}
      />,
    );

    expect(host.querySelectorAll('[role="tab"] button, [role="tab"] [tabindex]')).toHaveLength(0);
    for (const close of host.querySelectorAll(".cv-tab__close")) {
      expect(close.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("TreeRow", () => {
  it("exposes level, expansion and selection", () => {
    const { host } = mount(
      <TreeRow depth={2} expanded={false} label="src" onActivate={() => undefined} selected />,
    );
    const row = host.querySelector('[role="treeitem"]') as HTMLElement;

    expect(row.getAttribute("aria-level")).toBe("3");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.tabIndex).toBe(0);
    expect(row.style.getPropertyValue("--tree-row-depth")).toBe("2");
  });

  it("toggles folders by click and arrows and activates files with Enter", () => {
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    const { host, render } = mount(
      <TreeRow
        depth={0}
        expanded={false}
        label="src"
        onActivate={onActivate}
        onToggle={onToggle}
      />,
    );
    const row = () => host.querySelector('[role="treeitem"]') as HTMLElement;

    click(row());
    press(row(), "ArrowRight");
    render(<TreeRow depth={0} expanded label="src" onActivate={onActivate} onToggle={onToggle} />);
    press(row(), "ArrowLeft");
    press(row(), "ArrowRight");
    render(<TreeRow depth={1} label="index.ts" onActivate={onActivate} />);
    press(row(), "Enter");
    click(row());

    expect(onToggle.mock.calls.map((call) => call[0])).toEqual([true, true, false]);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(row().hasAttribute("aria-expanded")).toBe(false);
  });

  it("clamps absurd depths", () => {
    const { host, render } = mount(<TreeRow depth={-3} label="a" onActivate={() => undefined} />);
    expect(host.querySelector('[role="treeitem"]')?.getAttribute("aria-level")).toBe("1");

    render(<TreeRow depth={1000} label="a" onActivate={() => undefined} />);
    expect(host.querySelector('[role="treeitem"]')?.getAttribute("aria-level")).toBe("65");
  });
});

describe("PanelTabs badges and pinning", () => {
  const BADGED: readonly PanelTabItem[] = [
    {
      id: "a.ts",
      title: "a.ts",
      icon: <svg />,
      badge: { label: "M", title: "Modified", tone: "warn" },
    },
    { id: "b.ts", title: "b.ts", icon: <svg />, preview: true },
  ];

  it("renders a toned status badge after the title", () => {
    const { host } = mount(
      <PanelTabs label="Right panel" onSelect={() => undefined} selectedId="a.ts" tabs={BADGED} />,
    );

    const badge = host.querySelector('[role="tab"][title="a.ts"] .cv-tab__badge');
    expect(badge?.textContent).toBe("M");
    expect(badge?.getAttribute("aria-label")).toBe("Modified");
    expect(badge?.classList.contains("cv-tab__badge--warn")).toBe(true);
    expect(badge?.previousElementSibling?.className).toBe("cv-tab__title");
    expect(host.querySelector('[role="tab"][title="b.ts"] .cv-tab__badge')).toBeNull();
  });

  it("pins a tab on double click only when pinning is offered", () => {
    const onPin = vi.fn();
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onPin={onPin}
        onSelect={() => undefined}
        selectedId="a.ts"
        tabs={BADGED}
      />,
    );

    act(() => {
      host
        .querySelector('[role="tab"][title="b.ts"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledWith("b.ts");
  });

  it("pins the selected preview tab with Enter from the keyboard", () => {
    const onPin = vi.fn();
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onPin={onPin}
        onSelect={() => undefined}
        selectedId="b.ts"
        tabs={BADGED}
      />,
    );
    const preview = host.querySelector('[role="tab"][title="b.ts"]') as Element;

    expect(preview.getAttribute("aria-keyshortcuts")).toContain("Enter");
    press(preview, "Enter");
    expect(onPin).toHaveBeenCalledExactlyOnceWith("b.ts");
  });

  it("ignores Enter on a pinned tab and when pinning is not offered", () => {
    const onPin = vi.fn();
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onPin={onPin}
        onSelect={() => undefined}
        selectedId="a.ts"
        tabs={BADGED}
      />,
    );
    const pinned = host.querySelector('[role="tab"][title="a.ts"]') as Element;
    press(pinned, "Enter");

    expect(onPin).not.toHaveBeenCalled();
    expect(pinned.getAttribute("aria-keyshortcuts")).toBeNull();
  });

  it("colours badges like the Files tree", () => {
    const sheet = "ui/foundation/panels.css";
    const rules = parseCssRules(readStyleSheet(sheet).source, sheet).rules;
    const color = (selector: string) =>
      rules
        .find((rule) => rule.selector === selector)
        ?.declarations.find((declaration) => declaration.property === "color")?.value;

    expect(color(".cv-tab__badge--ok")).toBe("var(--cv-ok)");
    expect(color(".cv-tab__badge--warn")).toBe("var(--cv-warn)");
    expect(color(".cv-tab__badge--danger")).toBe("var(--cv-danger)");
  });
});
