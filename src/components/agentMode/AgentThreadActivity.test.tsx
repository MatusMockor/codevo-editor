// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { AgentThreadActivity, type AgentThreadActivityProps } from "./AgentThreadActivity";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const IDLE = { live: 0, capacity: 4, attention: 0, attentionExplanation: "why" };

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function render(overrides: Partial<AgentThreadActivityProps> = {}): MountedUi {
  mounted = mounted ?? mountUi();
  mounted.render(
    <AgentThreadActivity
      attentionVisible
      onChangeAttentionVisible={vi.fn()}
      ownerKey="/workspace/app"
      summary={IDLE}
      {...overrides}
    />,
  );
  return mounted;
}

function group(view: MountedUi): HTMLElement {
  const element = view.host.querySelector<HTMLElement>('[role="group"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

describe("AgentThreadActivity", () => {
  it("stays a quiet, focusable group while idle", () => {
    const view = render();

    expect(group(view).getAttribute("aria-label")).toBe("Thread activity: idle");
    expect(group(view).tabIndex).toBe(0);
    expect(group(view).textContent).toBe("");
  });

  it("shows running slots with their capacity on hover", () => {
    const view = render({ summary: { ...IDLE, live: 2 } });

    const running = view.host.querySelector<HTMLElement>(".agent-thread-activity__running");
    expect(running?.textContent).toBe("2 running");
    expect(running?.title).toBe("2 of 4 thread slots in use");
  });

  it("shows attention with its explanation and hides it when the user turned it off", () => {
    const view = render({ summary: { ...IDLE, attention: 1, attentionExplanation: "1 failed." } });

    const attention = view.host.querySelector<HTMLElement>(".agent-thread-activity__attention");
    expect(attention?.textContent).toBe("1 needs attention");
    expect(attention?.title).toBe("1 failed.");

    render({ attentionVisible: false, summary: { ...IDLE, attention: 1 } });
    expect(view.host.querySelector(".agent-thread-activity__attention")).toBeNull();
  });

  it("describes the group with the attention explanation for assistive technology", () => {
    const view = render({ summary: { ...IDLE, attention: 1, attentionExplanation: "1 failed." } });

    const describedBy = group(view).getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("1 failed.");

    render({ attentionVisible: false, summary: { ...IDLE, attention: 1 } });
    expect(group(view).hasAttribute("aria-describedby")).toBe(false);
  });

  it("keeps keys and right-clicks inside the open menu from reopening it", () => {
    const view = render();
    act(() => {
      group(view).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const item = document.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
    expect(menu?.style.left).toBe("10px");

    press(item as HTMLElement, "F10", { shiftKey: true });
    press(item as HTMLElement, "ContextMenu");
    act(() => {
      item?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });

    expect(document.querySelector<HTMLElement>('[role="menu"]')?.style.left).toBe("10px");
    expect(document.activeElement).toBe(item);
  });

  it("re-enables a hidden indicator from the idle group's context menu", () => {
    const onChangeAttentionVisible = vi.fn();
    const view = render({ attentionVisible: false, onChangeAttentionVisible });

    act(() => {
      group(view).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const item = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
    expect(item?.getAttribute("aria-checked")).toBe("false");
    act(() => item?.click());

    expect(onChangeAttentionVisible).toHaveBeenCalledWith(true);
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
    expect(document.activeElement).toBe(group(view));
  });

  it("opens the menu from the keyboard and closes it on an owner change", () => {
    const view = render();

    press(group(view), "F10", { shiftKey: true });
    expect(document.querySelector('[role="menuitemcheckbox"]')).not.toBeNull();

    render({ ownerKey: "/workspace/other" });
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
  });

  it("offers no menu when visibility cannot change", () => {
    const view = render({ onChangeAttentionVisible: null });

    press(group(view), "ContextMenu");

    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
  });
});
