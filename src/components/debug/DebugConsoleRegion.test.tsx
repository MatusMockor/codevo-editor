// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DebugConsoleHeader, DebugConsoleRegion } from "./DebugConsoleRegion";
import { debugPanelTestProps } from "./debugPanelTestProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("DebugConsoleRegion", () => {
  it("renders the console log and the last start error", () => {
    mounted = mountUi();
    mounted.render(
      <DebugConsoleRegion {...debugPanelTestProps({ lastStartError: "Cannot find module" })} />,
    );

    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBe("Cannot find module");
    expect(mounted.host.querySelector('[aria-label="Debug console"]')).not.toBeNull();
  });

  it("puts clear console and Show debug views in the drawer header", () => {
    const onShowDebugViews = vi.fn();
    const props = debugPanelTestProps({ canClearConsole: true });
    mounted = mountUi();
    mounted.render(<DebugConsoleHeader {...props} onShowDebugViews={onShowDebugViews} />);
    click(mounted.host.querySelector('button[aria-label="Clear debug console"]') as Element);
    click(mounted.host.querySelector('button[aria-label="Show debug views"]') as Element);

    expect(props.onClearConsole).toHaveBeenCalledTimes(1);
    expect(onShowDebugViews).toHaveBeenCalledTimes(1);
  });

  it("hides Show debug views when the views are already visible", () => {
    mounted = mountUi();
    mounted.render(<DebugConsoleHeader {...debugPanelTestProps()} onShowDebugViews={null} />);

    expect(mounted.host.querySelector('button[aria-label="Show debug views"]')).toBeNull();
    expect(
      mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Clear debug console"]')
        ?.disabled,
    ).toBe(true);
  });
});
