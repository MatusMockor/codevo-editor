// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useAgentDiffScopeSelection,
  type AgentDiffScopeSelection,
} from "./useAgentDiffScopeSelection";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

const TURNS = [
  { turnId: "t1", endedAtEpochMs: 1 },
  { turnId: "t2", endedAtEpochMs: 2 },
];

const box: { current: AgentDiffScopeSelection | null } = { current: null };
let openDiffHandler: () => void = () => undefined;

interface ProbeProps {
  readonly threadId: string | null;
  readonly diffActive: boolean;
  readonly remote: boolean;
  readonly turnDiffAvailable: boolean;
}

function Probe(value: ProbeProps) {
  box.current = useAgentDiffScopeSelection({
    threadId: value.threadId,
    turns: TURNS,
    diffActive: value.diffActive,
    remote: value.remote,
    turnDiffAvailable: value.turnDiffAvailable,
    openDiff: () => openDiffHandler(),
  });
  return null;
}

function render(props: {
  threadId: string | null;
  diffActive: boolean;
  remote?: boolean;
  turnDiffAvailable?: boolean;
  openDiff?: () => void;
}) {
  openDiffHandler = props.openDiff ?? (() => undefined);
  ui = ui ?? mountUi();
  ui.render(
    <Probe
      diffActive={props.diffActive}
      remote={props.remote ?? false}
      threadId={props.threadId}
      turnDiffAvailable={props.turnDiffAvailable ?? true}
    />,
  );
  return box;
}

const READY_SUMMARY = {
  turnId: "t1",
  state: "ready",
  files: [],
  truncated: false,
  reason: null,
} as const;

describe("useAgentDiffScopeSelection", () => {
  it("defaults to the latest turn for a thread and the working tree for a project", () => {
    expect(render({ threadId: "a", diffActive: true }).current?.scope).toEqual({
      kind: "latestTurn",
    });
    expect(render({ threadId: null, diffActive: true }).current?.scope).toEqual({
      kind: "workingTree",
    });
  });

  it("opens a recorded turn and reports it as the active diff turn", () => {
    const openDiff = vi.fn();
    const box = render({ threadId: "a", diffActive: true, openDiff });
    act(() =>
      box.current?.openTurnDiff("a", {
        turnId: "t1",
        state: "ready",
        files: [],
        truncated: false,
        reason: null,
      }),
    );
    expect(box.current?.scope).toEqual({ kind: "turn", turnId: "t1" });
    expect(box.current?.activeDiffTurnId).toBe("t1");
    expect(openDiff).toHaveBeenCalledOnce();
  });

  it("ignores requests for another thread and forgets the scope on thread switch", () => {
    const box = render({ threadId: "a", diffActive: true });
    act(() =>
      box.current?.openTurnDiff("b", {
        turnId: "t1",
        state: "ready",
        files: [],
        truncated: false,
        reason: null,
      }),
    );
    expect(box.current?.scope).toEqual({ kind: "latestTurn" });
    act(() => box.current?.setScope({ kind: "workingTree" }));
    render({ threadId: "b", diffActive: true });
    expect(box.current?.scope).toEqual({ kind: "latestTurn" });
  });

  it("reports no active turn while the diff surface is hidden", () => {
    expect(render({ threadId: "a", diffActive: false }).current?.activeDiffTurnId).toBeNull();
  });

  it("carries the requested file so the diff surface can reveal it", () => {
    const box = render({ threadId: "a", diffActive: true });
    act(() => box.current?.openTurnDiff("a", READY_SUMMARY, "src/app.ts"));
    expect(box.current?.scope).toEqual({ kind: "turn", turnId: "t1", revealPath: "src/app.ts" });
  });

  it("does not open a turn diff when recorded file diffs are unavailable", () => {
    const openDiff = vi.fn();
    const box = render({ threadId: "a", diffActive: true, turnDiffAvailable: false, openDiff });
    act(() => box.current?.openTurnDiff("a", READY_SUMMARY, "src/app.ts"));
    expect(box.current?.scope).toEqual({ kind: "latestTurn" });
    expect(openDiff).not.toHaveBeenCalled();
  });

  it("reports no active turn for a remote thread whose default diff is the working tree", () => {
    const box = render({ threadId: "remote:a", diffActive: true, remote: true });
    expect(box.current?.activeDiffTurnId).toBeNull();
    act(() => box.current?.openTurnDiff("remote:a", READY_SUMMARY));
    expect(box.current?.activeDiffTurnId).toBe("t1");
  });
});
