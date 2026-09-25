// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useEditorDebugFocus } from "./useEditorDebugFocus";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

interface ProbeProps {
  readonly ownerKey: string | null;
  readonly sessionId: number | null;
  readonly maximized: boolean;
  dispatch(action: AgentWorkbenchLayoutAction): void;
}

function Probe(props: ProbeProps) {
  useEditorDebugFocus(props);
  return null;
}

function renderSteps(
  dispatch: ProbeProps["dispatch"],
  steps: ReadonlyArray<Omit<ProbeProps, "dispatch">>,
): void {
  mounted = mountUi();
  for (const step of steps) mounted.render(<Probe {...step} dispatch={dispatch} />);
}

const MAXIMIZE = [{ kind: "openSurface", surface: "editor" }, { kind: "maximizeRightPanel" }];

describe("useEditorDebugFocus", () => {
  it("maximizes on session start, ignores its own maximize, restores on end", () => {
    const dispatch = vi.fn();
    renderSteps(dispatch, [
      { maximized: false, ownerKey: "/a", sessionId: null },
      { maximized: false, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/a", sessionId: null },
    ]);

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      ...MAXIMIZE,
      { kind: "toggleMaximized" },
    ]);
  });

  it("does not re-maximize a paused session the user restored and does not restore at the end", () => {
    const dispatch = vi.fn();
    renderSteps(dispatch, [
      { maximized: false, ownerKey: "/a", sessionId: null },
      { maximized: false, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/a", sessionId: 5 },
      { maximized: false, ownerKey: "/a", sessionId: 5 },
      { maximized: false, ownerKey: "/a", sessionId: 5 },
      { maximized: false, ownerKey: "/a", sessionId: null },
    ]);

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(MAXIMIZE);
  });

  it("leaves an already maximized panel alone", () => {
    const dispatch = vi.fn();
    renderSteps(dispatch, [
      { maximized: true, ownerKey: "/a", sessionId: null },
      { maximized: true, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/a", sessionId: null },
    ]);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("never applies workspace A's pending restore to B or to A again (A -> B -> A)", () => {
    const dispatch = vi.fn();
    renderSteps(dispatch, [
      { maximized: false, ownerKey: "/a", sessionId: null },
      { maximized: false, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/b", sessionId: null },
      { maximized: true, ownerKey: "/a", sessionId: 5 },
      { maximized: true, ownerKey: "/a", sessionId: null },
    ]);

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(MAXIMIZE);
  });
});
