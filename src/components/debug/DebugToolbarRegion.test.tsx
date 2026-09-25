// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { DebuggerSessionSnapshot } from "../../domain/debugSessionState";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DebugToolbarRegion } from "./DebugToolbarRegion";
import { debugPanelTestProps } from "./debugPanelTestProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const stopped: DebuggerSessionSnapshot = {
  state: { kind: "stopped", sessionId: 3, reason: "breakpoint", frames: [], topFrame: null },
  lastSeq: 5,
};

describe("DebugToolbarRegion", () => {
  it("shows the paused status and the stepping controls with their shortcuts", () => {
    const props = debugPanelTestProps({
      canRestartDebug: true,
      debugAdapterKind: "node",
      onRestart: () => undefined,
      snapshot: stopped,
    });
    mounted = mountUi();
    mounted.render(<DebugToolbarRegion {...props} />);
    const toolbar = mounted.host.querySelector('[role="toolbar"][aria-label="Debug session"]');

    expect(toolbar?.querySelector('[data-testid="debug-status"]')?.textContent).toBe(
      "Paused (breakpoint)",
    );
    for (const [label, title] of [
      ["Continue", "Continue F5"],
      ["Step over", "Step over F10"],
      ["Step into", "Step into F11"],
      ["Step out", "Step out ⇧F11"],
      ["Restart debugging", "Restart ⇧⌘F5"],
      ["Stop debugging", "Stop ⇧F5"],
    ] as const) {
      expect(
        toolbar?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.title,
        label,
      ).toBe(title);
    }
    expect(toolbar?.querySelector('button[aria-label="Pause"]')).toBeNull();
    click(toolbar?.querySelector('button[aria-label="Step over"]') as Element);
    expect(props.onStep).toHaveBeenCalledWith("stepOver");
  });

  it("offers Pause instead of Continue while running and Disconnect for attached sessions", () => {
    const props = debugPanelTestProps({
      debugSessionAttached: true,
      snapshot: { state: { kind: "running", sessionId: 3 }, lastSeq: 1 },
    });
    mounted = mountUi();
    mounted.render(<DebugToolbarRegion {...props} />);

    expect(mounted.host.querySelector('button[aria-label="Pause"]')?.getAttribute("title")).toBe(
      "Pause F6",
    );
    expect(mounted.host.querySelector('button[aria-label="Continue"]')).toBeNull();
    const disconnect = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Disconnect debugging"]',
    );
    expect(disconnect?.title).toBe("Disconnect ⇧F5");
    click(disconnect as Element);
    expect(props.onDisconnect).toHaveBeenCalledOnce();
  });

  it("does not carry launch selectors or start errors", () => {
    mounted = mountUi();
    mounted.render(<DebugToolbarRegion {...debugPanelTestProps({ lastStartError: "boom" })} />);

    expect(mounted.host.querySelector('[role="alert"]')).toBeNull();
  });
});
