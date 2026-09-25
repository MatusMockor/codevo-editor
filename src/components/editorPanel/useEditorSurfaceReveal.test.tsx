// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDrawerView } from "../../domain/editorDrawer";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useEditorDrawerReveal, useEditorSurfaceReveal } from "./useEditorSurfaceReveal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function DrawerProbe(props: {
  readonly ownerKey: string | null;
  readonly drawerView: EditorDrawerView | null;
  reveal(): void;
}) {
  useEditorDrawerReveal(props);
  return null;
}

describe("useEditorDrawerReveal", () => {
  it("reveals the editor when a drawer view opens, once per opening", () => {
    const reveal = vi.fn();
    mounted = mountUi();
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="debug" ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="search" ownerKey="/a" reveal={reveal} />);

    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it("does not reveal on first observation or on a workspace switch that restores an open drawer", () => {
    const reveal = vi.fn();
    mounted = mountUi();
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/b" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={reveal} />);

    expect(reveal).not.toHaveBeenCalled();
  });

  it("calls the latest reveal callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    mounted = mountUi();
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/a" reveal={first} />);
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={second} />);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("useEditorSurfaceReveal", () => {
  it("dispatches openSurface editor through a stable callback", () => {
    const dispatch = vi.fn();
    const callbacks: Array<() => void> = [];
    function Probe() {
      callbacks.push(useEditorSurfaceReveal(dispatch));
      return null;
    }
    mounted = mountUi();
    mounted.render(<Probe />);
    mounted.render(<Probe />);
    callbacks[1]?.();

    expect(callbacks[1]).toBe(callbacks[0]);
    expect(dispatch).toHaveBeenCalledWith({ kind: "openSurface", surface: "editor" });
  });
});
