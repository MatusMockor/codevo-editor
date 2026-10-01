// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  DEFAULT_EDITOR_DRAWER_HEIGHT,
  EditorPanelLayout,
  type EditorDrawerFrame,
} from "./EditorPanelLayout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("EditorPanelLayout", () => {
  it("stacks the editor area and the drawer and keeps the drawer height across reopenings", () => {
    const frames: EditorDrawerFrame[] = [];
    const renderDrawer = (frame: EditorDrawerFrame) => {
      frames.push(frame);
      return <div data-testid="drawer" />;
    };
    const area = <div data-testid="area" />;
    mounted = mountUi();
    mounted.render(<EditorPanelLayout area={area} message={null} renderDrawer={renderDrawer} />);

    expect(frames[0]?.height).toBe(DEFAULT_EDITOR_DRAWER_HEIGHT);
    act(() => frames[0]?.onResize(300));
    mounted.render(<EditorPanelLayout area={area} message={null} renderDrawer={null} />);
    mounted.render(<EditorPanelLayout area={area} message={null} renderDrawer={renderDrawer} />);

    expect(frames[frames.length - 1]?.height).toBe(300);
    expect(
      mounted.host.querySelector(".cv-editor-panel__column [data-testid='area']"),
    ).not.toBeNull();
  });

  it("clamps the drawer height", () => {
    const frames: EditorDrawerFrame[] = [];
    mounted = mountUi();
    mounted.render(
      <EditorPanelLayout
        area={null}
        message={null}
        renderDrawer={(frame) => {
          frames.push(frame);
          return null;
        }}
      />,
    );
    act(() => frames[0]?.onResize(10_000));
    expect(frames[frames.length - 1]?.height).toBe(640);
    act(() => frames[frames.length - 1]?.onResize(Number.NaN));
    expect(frames[frames.length - 1]?.height).toBe(DEFAULT_EDITOR_DRAWER_HEIGHT);
  });

  it("keeps the editor area mounted while the drawer opens and closes", () => {
    const area = <div data-testid="area" />;
    mounted = mountUi();
    mounted.render(<EditorPanelLayout area={area} message={null} renderDrawer={null} />);
    const before = mounted.host.querySelector("[data-testid='area']");
    mounted.render(
      <EditorPanelLayout
        area={area}
        message={null}
        renderDrawer={() => <div data-testid="drawer" />}
      />,
    );

    expect(mounted.host.querySelector("[data-testid='area']")).toBe(before);
  });

  it("shows a transient message as a toast", () => {
    mounted = mountUi();
    mounted.render(<EditorPanelLayout area={null} message="Saved app.ts" renderDrawer={null} />);

    expect(mounted.host.textContent).toContain("Saved app.ts");
  });
});
