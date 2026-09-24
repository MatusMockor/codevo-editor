// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { click, mountUi, type MountedUi } from "./foundationTestSupport";
import { IconButton } from "./IconButton";
import { SubmitButton } from "./SubmitButton";

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

describe("Button", () => {
  it("defaults to a non-submitting medium default button", () => {
    const { host } = mount(<Button>Commit</Button>);
    const button = host.querySelector("button");

    expect(button?.type).toBe("button");
    expect(button?.className).toBe("cv-button cv-button--default cv-button--md");
    expect(button?.textContent).toBe("Commit");
  });

  it("renders variants, sizes, a decorative icon and extra layout classes", () => {
    const { host } = mount(
      <Button className="layout-gap" icon={<svg />} size="sm" variant="primary">
        Push
      </Button>,
    );
    const button = host.querySelector("button");

    expect(button?.className).toBe("cv-button cv-button--primary cv-button--sm layout-gap");
    expect(button?.querySelector(".cv-button__icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("offers a danger variant for destructive confirmations", () => {
    const { host } = mount(<Button variant="danger">Delete thread</Button>);

    expect(host.querySelector("button")?.className).toBe(
      "cv-button cv-button--danger cv-button--md",
    );
  });

  it("forwards clicks and blocks them while disabled", () => {
    const onClick = vi.fn();
    const { host, render } = mount(<Button onClick={onClick}>Run</Button>);

    click(host.querySelector("button") as Element);
    render(
      <Button disabled onClick={onClick}>
        Run
      </Button>,
    );
    click(host.querySelector("button") as Element);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IconButton", () => {
  it("names the button from its label and hides the glyph", () => {
    const { host } = mount(<IconButton icon={<svg />} label="Close panel" />);
    const button = host.querySelector("button");

    expect(button?.getAttribute("aria-label")).toBe("Close panel");
    expect(button?.title).toBe("Close panel");
    expect(button?.hasAttribute("aria-pressed")).toBe(false);
    expect(button?.className).toBe("cv-icon-button cv-icon-button--sm");
    expect(button?.querySelector(".cv-icon-button__glyph")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("exposes toggle state only when pressed is given", () => {
    const { host } = mount(<IconButton icon={<svg />} label="Wrap" pressed size="xs" />);

    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("button")?.className).toContain("cv-icon-button--xs");
  });
});

describe("SubmitButton", () => {
  it("sends with the t3code arrow as a submit button", () => {
    const { host } = mount(<SubmitButton mode="send" />);
    const button = host.querySelector("button");

    expect(button?.type).toBe("submit");
    expect(button?.getAttribute("aria-label")).toBe("Send message");
    expect(button?.querySelector("path")?.getAttribute("d")).toBe("M8 3L8 13M8 3L4 7M8 3L12 7");
  });

  it("stops as a plain button with the stop square", () => {
    const onClick = vi.fn();
    const { host } = mount(<SubmitButton mode="stop" onClick={onClick} />);
    const button = host.querySelector("button");

    expect(button?.type).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Stop generation");
    expect(button?.className).toBe("cv-submit cv-submit--stop");
    expect(button?.querySelector("rect")).not.toBeNull();
    click(button as Element);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("supports the queued-edit label, custom labels and the disabled state", () => {
    const { host, render } = mount(<SubmitButton disabled mode="update" />);

    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Update queued message");
    expect(host.querySelector("button")?.disabled).toBe(true);
    render(<SubmitButton label="Send to Codex" mode="send" />);
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Send to Codex");
  });

  it("shows a busy spinner, a custom title, key shortcuts and an extra class", () => {
    const { host } = mount(
      <SubmitButton
        busy
        className="agent-composer__send"
        keyShortcuts="Enter Meta+Enter"
        label="Send follow-up"
        mode="send"
        title="Send follow-up (Enter)"
      />,
    );
    const button = host.querySelector("button");

    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("Enter Meta+Enter");
    expect(button?.title).toBe("Send follow-up (Enter)");
    expect(button?.className).toBe("cv-submit agent-composer__send");
    expect(button?.querySelector(".cv-spinner")).not.toBeNull();
    expect(button?.querySelector("path[d='M8 3L8 13M8 3L4 7M8 3L12 7']")).toBeNull();
  });
});
