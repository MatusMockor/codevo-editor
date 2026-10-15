// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerBanner } from "./ComposerBanner";
import { mountUi, type MountedUi } from "./foundationTestSupport";
import { RoleTag } from "./RoleTag";
import { StatusLabel } from "./StatusLabel";

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
