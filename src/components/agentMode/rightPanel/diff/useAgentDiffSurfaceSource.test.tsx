// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitSurfaceStatus } from "../../../../domain/gitSurfaceStatus";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import { rightPanelTestContext } from "../agentRightPanelTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import {
  TURN_CHANGES_UNAVAILABLE_REASON,
  UNREADABLE_REPOSITORIES_WARNING,
  WORKING_TREE_RELOAD_DELAY_MS,
  useAgentDiffSurfaceSource,
  type AgentDiffSurfaceSourceModel,
} from "./useAgentDiffSurfaceSource";

let ui: MountedUi | null = null;
const box: { current: AgentDiffSurfaceSourceModel | null } = { current: null };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
  vi.useRealTimers();
});

function Probe(props: { readonly context: AgentRightPanelContextValue }) {
  box.current = useAgentDiffSurfaceSource(props.context);
  return null;
}

function render(context: AgentRightPanelContextValue) {
  ui = ui ?? mountUi();
  ui.render(<Probe context={context} />);
  return box;
}

function withChrome(
  base: AgentRightPanelContextValue,
  chrome: Partial<NonNullable<AgentRightPanelContextValue["chrome"]>>,
): AgentRightPanelContextValue {
  const current = base.chrome;
  if (current === null) return base;
  return { ...base, chrome: { ...current, ...chrome } };
}

function surfaceStatus(): GitSurfaceStatus {
  return {
    branch: "main",
    defaultBase: "main",
    hasRemote: false,
    upstream: null,
    unpushed: [],
    unpushedTruncated: false,
    lineStats: [{ relativePath: "a.ts", added: 1, deleted: 0 }],
    lineStatsTruncated: true,
    localBranches: ["main"],
    remoteBranches: [],
    worktreeBranches: [],
    branchesTruncated: false,
  };
}

describe("useAgentDiffSurfaceSource working tree", () => {
  it("coalesces repository status refreshes into one new working-tree revision", () => {
    const base = rightPanelTestContext({ diffScope: { kind: "workingTree" } });
    const box = render(withChrome(base, { statusRevision: 1 }));
    const firstKey = box.current?.source?.key;

    render(withChrome(base, { statusRevision: 2 }));
    render(withChrome(base, { statusRevision: 3 }));
    expect(box.current?.source?.key).toBe(firstKey);

    act(() => {
      vi.advanceTimersByTime(WORKING_TREE_RELOAD_DELAY_MS);
    });
    const reloadedKey = box.current?.source?.key;
    expect(reloadedKey).not.toBe(firstKey);
    expect(box.current?.source?.identity).toBeDefined();
    render(withChrome(base, { statusRevision: 3 }));
    expect(box.current?.source?.key).toBe(reloadedKey);
  });

  it("warns when some project repositories could not be read", () => {
    const base = rightPanelTestContext({ diffScope: { kind: "workingTree" } });
    expect(render(base).current?.warning).toBeNull();
    expect(render(withChrome(base, { unreadableRepositories: true })).current?.warning).toBe(
      UNREADABLE_REPOSITORIES_WARNING,
    );
  });

  it("reads line stats once per repository and revision and reports truncation", async () => {
    const getSurfaceStatus = vi.fn(async () => surfaceStatus());
    const getStatus = async (root: string) => ({
      branch: "main",
      isRepository: true,
      rootPath: root,
      changes: [
        {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: `${root}/a.ts`,
          relativePath: "a.ts",
          status: "modified" as const,
        },
      ],
    });
    const seed = rightPanelTestContext(
      { diffScope: { kind: "workingTree" } },
      { surfaceStatus: { getSurfaceStatus } },
    );
    const gateways = seed.chrome?.gateways;
    expect(gateways).toBeDefined();
    if (gateways === undefined) return;
    const base = withChrome(seed, {
      gateways: { ...gateways, git: { ...gateways.git, getStatus } },
    });
    const source = render(base).current?.source;
    expect(source).toBeDefined();
    const first = await source?.listFiles();
    const second = await source?.listFiles();

    expect(getSurfaceStatus).toHaveBeenCalledTimes(1);
    expect(first?.statsPartial).toBe(false);
    expect(second?.files[0]?.added).toBe(1);
  });
});

describe("useAgentDiffSurfaceSource turn reveal", () => {
  it("exposes the requested file of a turn scope", () => {
    const base = rightPanelTestContext({
      diffScope: { kind: "turn", turnId: "t1", revealPath: "src/a.ts" },
    });
    expect(render(base).current?.reveal).toEqual({ relativePath: "src/a.ts" });
  });
});

describe("useAgentDiffSurfaceSource turn scope", () => {
  it("explains a turn scope whose recorded changes cannot be read", () => {
    const view = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        turns: [
          {
            turnId: "t1",
            prompt: "p",
            status: { kind: "exited", exitCode: 0 },
            startedAtEpochMs: 1,
            endedAtEpochMs: 2,
            events: [],
            eventsTruncated: false,
            lastStatusSequence: 1,
            lastOutputSequence: 1,
            launch: null,
            cliVersion: null,
          },
        ],
      },
    });
    const box = render(
      rightPanelTestContext({ thread: view, diffScope: { kind: "turn", turnId: "t1" } }),
    );

    expect(box.current?.source).toBeNull();
    expect(box.current?.emptyReason).toBe(TURN_CHANGES_UNAVAILABLE_REASON);
  });
});
