// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNodeLaunchConfigurationsSurface,
  type NodeLaunchConfigurationsSurface,
} from "./useNodeLaunchConfigurationsSurface";

describe("useNodeLaunchConfigurationsSurface", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current!: NodeLaunchConfigurationsSurface;
  let available: boolean;
  let ownerKey: string | null;
  let closeDebugPicker: ReturnType<typeof vi.fn<() => void>>;
  let closeRunPicker: ReturnType<typeof vi.fn<() => void>>;

  function Harness() {
    current = useNodeLaunchConfigurationsSurface({
      available,
      closeDebugPicker,
      closeRunPicker,
      ownerKey,
    });
    return null;
  }

  function render() {
    act(() => root.render(<Harness />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    available = true;
    ownerKey = "owner-a";
    closeDebugPicker = vi.fn();
    closeRunPicker = vi.fn();
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("opens one controlled dialog and closes both competing pickers without starting or writing", () => {
    const startTarget = vi.fn();
    const writeConfiguration = vi.fn();

    act(() => current.openNodeLaunchConfigurations());

    expect(current.nodeLaunchConfigurationsOpen).toBe(true);
    expect(closeDebugPicker).toHaveBeenCalledOnce();
    expect(closeRunPicker).toHaveBeenCalledOnce();
    expect(startTarget).not.toHaveBeenCalled();
    expect(writeConfiguration).not.toHaveBeenCalled();

    act(() => current.closeNodeLaunchConfigurations());
    expect(current.nodeLaunchConfigurationsOpen).toBe(false);
  });

  it("rechecks true-to-false capability drift at the open boundary", () => {
    const staleOpen = current.openNodeLaunchConfigurations;
    available = false;
    render();

    act(() => staleOpen());

    expect(current.nodeLaunchConfigurationsOpen).toBe(false);
    expect(closeDebugPicker).not.toHaveBeenCalled();
    expect(closeRunPicker).not.toHaveBeenCalled();
  });

  it("does not revive the surface when a capability returns for the same owner", () => {
    act(() => current.openNodeLaunchConfigurations());
    expect(current.nodeLaunchConfigurationsOpen).toBe(true);

    available = false;
    render();
    expect(current.nodeLaunchConfigurationsOpen).toBe(false);

    available = true;
    render();
    expect(current.nodeLaunchConfigurationsOpen).toBe(false);
  });

  it("fails closed when the owner disappears or changes", () => {
    const staleOpen = current.openNodeLaunchConfigurations;
    ownerKey = null;
    render();
    act(() => staleOpen());
    expect(current.nodeLaunchConfigurationsOpen).toBe(false);

    ownerKey = "owner-a";
    render();
    act(() => current.openNodeLaunchConfigurations());
    expect(current.nodeLaunchConfigurationsOpen).toBe(true);

    ownerKey = "owner-b";
    render();
    expect(current.nodeLaunchConfigurationsOpen).toBe(false);

    ownerKey = "owner-a";
    render();
    expect(current.nodeLaunchConfigurationsOpen).toBe(false);
  });
});
