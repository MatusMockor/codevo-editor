// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { AgentSidebarReveal } from "./AgentSidebarReveal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SHORTCUTS = {
  bottomPanel: "Cmd+J",
  rightPanel: "Cmd+Alt+R",
  sidebar: "Cmd+B",
  newThread: "Cmd+Shift+N",
  newThreadIn: "Cmd+N",
};

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("AgentSidebarReveal", () => {
  it("offers Expand sidebar and New thread with their chords, then a separator", () => {
    const onExpand = vi.fn();
    const onNewThread = vi.fn();
    mounted = mountUi();
    mounted.render(
      <AgentSidebarReveal onExpand={onExpand} onNewThread={onNewThread} shortcuts={SHORTCUTS} />,
    );

    const expand = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand sidebar"]',
    );
    const newThread = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="New thread"]',
    );
    expect(expand?.title).toBe("Expand sidebar (⌘B)");
    expect(expand?.getAttribute("aria-expanded")).toBe("false");
    expect(newThread?.title).toBe("New thread (⇧⌘N)");
    expect(mounted.host.querySelector(".cv-topbar__separator")).not.toBeNull();

    click(expand as HTMLButtonElement);
    click(newThread as HTMLButtonElement);

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onNewThread).toHaveBeenCalledWith(false);
  });

  it("passes shift-click through and names the active project with several projects", () => {
    const onNewThread = vi.fn();
    mounted = mountUi();
    mounted.render(
      <AgentSidebarReveal
        currentProjectLabel="app"
        onExpand={vi.fn()}
        onNewThread={onNewThread}
        projectCount={2}
        shortcuts={SHORTCUTS}
      />,
    );
    const newThread = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="New thread"]',
    );
    expect(newThread?.title).toBe("New thread in app (⇧⌘N) · ⌘N: choose project");
    act(() => {
      newThread?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(onNewThread).toHaveBeenCalledWith(true);
  });

  it("appends a live detail to the expand tooltip", () => {
    mounted = mountUi();
    mounted.render(
      <AgentSidebarReveal
        detail="2 running · 1 needs attention"
        onExpand={vi.fn()}
        onNewThread={vi.fn()}
        shortcuts={SHORTCUTS}
      />,
    );

    expect(
      mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')?.title,
    ).toBe("Expand sidebar (⌘B) · 2 running · 1 needs attention");
  });
});
