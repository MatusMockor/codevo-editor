// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerBanner } from "./ComposerBanner";
import { click, mountUi, pointer, type MountedUi } from "./foundationTestSupport";
import { RoleTag } from "./RoleTag";
import { StatusLabel } from "./StatusLabel";
import { Toast, ToastViewport } from "./Toast";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

describe("StatusLabel and RoleTag", () => {
  it("colours the status by kind and can show a spinner", () => {
    const { host, render } = mount(<StatusLabel kind="fail">Failed</StatusLabel>);
    expect(host.querySelector(".cv-status")?.className).toBe("cv-status cv-status--fail");
    expect(host.querySelector(".cv-spinner")).toBeNull();

    render(
      <StatusLabel kind="work" spinner>
        Working 12s
      </StatusLabel>,
    );
    expect(host.querySelector(".cv-status--work .cv-spinner")).not.toBeNull();
    expect(host.textContent).toBe("Working 12s");
  });

  it("shows the full role on hover", () => {
    const { host } = mount(<RoleTag>code-reviewer-with-a-long-name</RoleTag>);

    expect(host.querySelector(".cv-role")?.getAttribute("title")).toBe(
      "code-reviewer-with-a-long-name",
    );
  });
});

describe("ComposerBanner", () => {
  it("announces its message politely with tone, icon and actions", () => {
    const { host, render } = mount(
      <ComposerBanner actions={<button type="button">Cancel</button>} icon={<svg />} tone="warn">
        Cloning repository
      </ComposerBanner>,
    );
    const banner = host.querySelector('[role="status"]');

    expect(banner?.getAttribute("aria-live")).toBe("polite");
    expect(banner?.className).toBe("cv-composer-banner cv-composer-banner--warn");
    expect(banner?.querySelector(".cv-composer-banner__icon")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(banner?.querySelector(".cv-composer-banner__actions button")?.textContent).toBe(
      "Cancel",
    );

    render(<ComposerBanner tone="working">Waiting for 2 agents</ComposerBanner>);
    expect(host.querySelector(".cv-composer-banner--working .cv-spinner")).not.toBeNull();
  });

  it("stays silent when another region already announces the same state", () => {
    const { host } = mount(
      <ComposerBanner announce={false} tone="working">
        2 agents running
      </ComposerBanner>,
    );
    const banner = host.querySelector(".cv-composer-banner");

    expect(banner?.getAttribute("role")).toBeNull();
    expect(banner?.getAttribute("aria-live")).toBeNull();
    expect(banner?.textContent).toBe("2 agents running");
  });
});

describe("Toast", () => {
  it("uses status for information and alert for errors inside a labelled viewport", () => {
    const { host, render } = mount(
      <ToastViewport>
        <Toast durationMs={0} message="Copied" onDismiss={() => undefined} />
      </ToastViewport>,
    );
    expect(host.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe("Notifications");
    expect(host.querySelector(".cv-toast")?.getAttribute("role")).toBe("status");

    render(<Toast durationMs={0} message="Push failed" onDismiss={() => undefined} tone="error" />);
    expect(host.querySelector(".cv-toast")?.getAttribute("role")).toBe("alert");
  });

  it("dismisses itself after its duration and clears the timer on unmount", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { render } = mount(<Toast durationMs={4000} message="Saved" onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    render(<Toast durationMs={4000} key="second" message="Saved again" onDismiss={onDismiss} />);
    render(null);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("pauses its countdown while hovered or focused and resumes afterwards", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { host } = mount(<Toast durationMs={4000} message="Saved" onDismiss={onDismiss} />);
    const toast = host.querySelector(".cv-toast") as HTMLElement;
    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    advance(3000);
    pointer(toast, "pointerover");
    advance(10000);
    expect(onDismiss).not.toHaveBeenCalled();
    pointer(toast, "pointerout", { relatedTarget: document.body });
    advance(500);
    expect(onDismiss).not.toHaveBeenCalled();

    const dismiss = host.querySelector('[aria-label="Dismiss"]') as HTMLElement;
    act(() => {
      dismiss.focus();
    });
    advance(10000);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      dismiss.blur();
    });
    advance(499);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays until dismissed when the duration is zero and runs its action", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onSelect = vi.fn();
    const { host } = mount(
      <Toast
        action={{ label: "Undo", onSelect }}
        durationMs={0}
        message="Thread archived"
        onDismiss={onDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Undo",
      ) as Element,
    );
    click(host.querySelector('[aria-label="Dismiss"]') as Element);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
