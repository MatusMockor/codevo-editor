// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTabs } from "./ProjectTabs";

describe("ProjectTabs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("stays hidden for a single workspace", async () => {
    await act(async () => {
      root.render(
        <ProjectTabs
          activeRoot="/workspace/api"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          workspaceTabs={["/workspace/api"]}
        />,
      );
    });

    expect(host.querySelector(".project-tabs")).toBeNull();
  });

  it("shows project tabs when multiple workspaces are open", async () => {
    const activate = vi.fn();

    await act(async () => {
      root.render(
        <ProjectTabs
          activeRoot="/workspace/api"
          onActivate={activate}
          onClose={vi.fn()}
          workspaceTabs={["/workspace/api", "/workspace/analytics-api"]}
        />,
      );
    });

    const tabs = [...host.querySelectorAll(".project-tab")];

    expect(tabs).toHaveLength(2);
    expect(host.textContent).toContain("api");
    expect(host.textContent).toContain("analytics-api");

    act(() => {
      host
        .querySelector<HTMLButtonElement>(".project-tab-main:not([aria-current])")
        ?.click();
    });

    expect(activate).toHaveBeenCalledWith("/workspace/analytics-api");
  });

  it("closes project tabs with a middle click", async () => {
    const close = vi.fn();

    await act(async () => {
      root.render(
        <ProjectTabs
          activeRoot="/workspace/api"
          onActivate={vi.fn()}
          onClose={close}
          workspaceTabs={["/workspace/api", "/workspace/analytics-api"]}
        />,
      );
    });

    act(() => {
      host.querySelector(".project-tab")?.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });

    expect(close).toHaveBeenCalledWith("/workspace/api");
  });
});
