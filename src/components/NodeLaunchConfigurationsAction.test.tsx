// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeLaunchConfigurationsAction } from "./NodeLaunchConfigurationsAction";

describe("NodeLaunchConfigurationsAction", () => {
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

  it("is an accessible toolbar button that only delegates the controlled open intent", () => {
    const onOpen = Object.assign(vi.fn(), {
      args: ["--private-argument"],
      env: { SECRET_TOKEN: "must-not-render" },
    });
    const startTarget = vi.fn();
    const writeConfiguration = vi.fn();
    act(() => root.render(<NodeLaunchConfigurationsAction onOpen={onOpen} />));

    const action = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Configure Node launch configurations"]',
    );
    expect(action).not.toBeNull();
    expect(action?.type).toBe("button");
    expect(action?.title).toBe("Run: Configure Node Launch Configurations");
    action?.focus();
    expect(document.activeElement).toBe(action);

    act(() => action?.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(startTarget).not.toHaveBeenCalled();
    expect(writeConfiguration).not.toHaveBeenCalled();
    expect(host.innerHTML).not.toContain("--private-argument");
    expect(host.innerHTML).not.toContain("SECRET_TOKEN");
    expect(host.innerHTML).not.toContain("must-not-render");
  });
});
