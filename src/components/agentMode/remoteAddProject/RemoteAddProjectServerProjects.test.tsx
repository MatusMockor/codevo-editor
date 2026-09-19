// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteAddProjectServerProject } from "../../../application/useRemoteAddProject";
import { RemoteAddProjectServerProjects } from "./RemoteAddProjectServerProjects";

const PROJECTS: readonly RemoteAddProjectServerProject[] = [
  { key: "remote:linux:r:alpha", label: "alpha" },
  { key: "remote:linux:r:beta", label: "beta" },
];

describe("RemoteAddProjectServerProjects", () => {
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

  it("activates the clicked project by key", () => {
    const onActivate = vi.fn();
    render({ onActivate });

    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["alpha", "beta"]);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");

    act(() => options[0]?.click());

    expect(onActivate).toHaveBeenCalledExactlyOnceWith("remote:linux:r:alpha");
  });

  it("states the hidden remainder truthfully", () => {
    render({ hiddenCount: 12 });

    expect(host.textContent).toContain("12 more not shown");
  });

  it("explains an empty filter result instead of showing an empty list", () => {
    render({ projects: [] });

    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(host.textContent).toContain("No matching project on this server.");
  });

  function render(
    overrides: {
      hiddenCount?: number;
      onActivate?: () => void;
      projects?: readonly RemoteAddProjectServerProject[];
    } = {},
  ): void {
    act(() => {
      root.render(
        <RemoteAddProjectServerProjects
          activeIndex={1}
          hiddenCount={overrides.hiddenCount ?? 0}
          listboxId="listbox"
          onActivate={overrides.onActivate ?? (() => undefined)}
          onHighlight={() => undefined}
          optionPrefix="option-"
          projects={overrides.projects ?? PROJECTS}
        />,
      );
    });
  }
});
