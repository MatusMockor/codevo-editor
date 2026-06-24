// @vitest-environment jsdom

import { act, useState } from "react";
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

  it("does not re-render when the parent re-renders with identical props", async () => {
    // The component maps over `workspaceTabs` for every render, so spying on the
    // array's `map` counts how often the memoized subtree renders.
    const workspaceTabs = ["/workspace/api", "/workspace/analytics-api"];
    const mapSpy = vi.spyOn(workspaceTabs, "map");
    const stableProps: React.ComponentProps<typeof ProjectTabs> = {
      activeRoot: "/workspace/api",
      onActivate: vi.fn(),
      onClose: vi.fn(),
      workspaceTabs,
    };

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return <ProjectTabs {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const callsAfterMount = mapSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    await act(async () => {
      forceParentRender(1);
      await Promise.resolve();
    });

    // React.memo prevents the component from re-rendering when every prop is
    // referentially unchanged, so `workspaceTabs` is never mapped again.
    expect(mapSpy.mock.calls.length).toBe(callsAfterMount);

    mapSpy.mockRestore();
  });
});
