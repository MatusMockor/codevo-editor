// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatus } from "../../domain/git";
import type { AgentCommitSelection } from "../../domain/gitCommitSelection";
import { waitForReact } from "../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type {
  AgentGitAmendAvailability,
  AgentGitCommitOutcome,
  AgentGitCommitPort,
  ProjectGitCommitGateway,
} from "./projectGitCommitPort";
import {
  useAgentGitSurface,
  type AgentGitSurfaceState,
  type UseAgentGitSurfaceOptions,
} from "./useAgentGitSurface";

const HEAD = "c".repeat(40);
let ui: MountedUi | null = null;
const box: { current: AgentGitSurfaceState | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function change(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/r/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

function memoryGit(changes: GitChangedFile[]): ProjectGitCommitGateway {
  const status = (): GitStatus => ({ branch: "main", changes, isRepository: true, rootPath: "/r" });
  return {
    getStatus: async () => status(),
    stageFiles: async () => status(),
    commit: async () => status(),
    push: async () => status(),
  };
}

interface AmendCall {
  readonly head: string;
  readonly message: string;
  readonly selection: AgentCommitSelection;
  readonly result: Deferred<AgentGitCommitOutcome>;
}

function amendPort(availability: () => Promise<AgentGitAmendAvailability>) {
  const amends: AmendCall[] = [];
  let checks = 0;
  const port: AgentGitCommitPort = {
    commit: async () => ({ kind: "committed" }),
    commitAndPush: async () => ({ kind: "pushed" }),
    amendCandidate: () => {
      checks += 1;
      return availability();
    },
    amend(head, message, selection) {
      const result = deferred<AgentGitCommitOutcome>();
      amends.push({ head, message, selection, result });
      return result.promise;
    },
  };
  return { amends, checks: () => checks, port };
}

const READY: AgentGitAmendAvailability = {
  kind: "ready",
  headSha: HEAD,
  message: "feat: first\n\nBody.",
};

function Probe(props: { readonly options: UseAgentGitSurfaceOptions }) {
  box.current = useAgentGitSurface(props.options);
  return null;
}

function options(overrides: Partial<UseAgentGitSurfaceOptions>): UseAgentGitSurfaceOptions {
  return {
    ownerKey: "project-a",
    rootPath: "/r",
    git: memoryGit([change("a.ts"), change("b.ts")]),
    lineStats: [],
    port: null,
    threadTitle: null,
    onCommitted: () => undefined,
    ...overrides,
  };
}

function render(next: UseAgentGitSurfaceOptions): void {
  ui = ui ?? mountUi();
  ui.render(<Probe options={next} />);
}

function surface(): AgentGitSurfaceState {
  const current = box.current;
  expect(current).not.toBeNull();
  return current as AgentGitSurfaceState;
}

describe("useAgentGitSurface amend mode", () => {
  it("prefills the last message and restores the draft when amend is turned off", async () => {
    const fake = amendPort(async () => READY);
    render(options({ port: fake.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    act(() => surface().setMessage("my draft"));

    await act(async () => surface().setAmending(true));

    expect(surface().amend).toEqual({
      active: true,
      checking: false,
      unavailableReason: null,
      shortSha: "ccccccc",
    });
    expect(surface().message).toBe("feat: first\n\nBody.");
    act(() => surface().setAmending(false));
    expect(surface().amend.active).toBe(false);
    expect(surface().message).toBe("my draft");
  });

  it("stays off and explains why when the last commit cannot be amended", async () => {
    const reason = "The last commit is already pushed.";
    const fake = amendPort(async () => ({ kind: "unavailable", reason }));
    render(options({ port: fake.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));

    await act(async () => surface().checkAmend());
    expect(surface().amend).toEqual({
      active: false,
      checking: false,
      unavailableReason: reason,
      shortSha: null,
    });
    await act(async () => surface().setAmending(true));
    expect(surface().amend.active).toBe(false);
    expect(surface().message).toBe("");
  });

  it("amends the exact head with the included files, then leaves amend mode", async () => {
    const fake = amendPort(async () => READY);
    const committed: string[] = [];
    render(options({ port: fake.port, onCommitted: () => committed.push("done") }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    await act(async () => surface().setAmending(true));
    act(() => surface().setRowIncluded("tracked:b.ts", false));
    act(() => surface().setMessage("feat: first, amended"));

    act(() => surface().commit());

    expect(surface().busy).toBe("amending");
    expect(
      fake.amends.map(({ head, message, selection }) => ({ head, message, selection })),
    ).toEqual([
      {
        head: HEAD,
        message: "feat: first, amended",
        selection: { kind: "rows", rowKeys: ["tracked:a.ts"] },
      },
    ]);
    await act(async () => fake.amends[0]?.result.resolve({ kind: "amended" }));
    expect(surface().notice).toEqual({ kind: "ok", text: "Amended the last commit." });
    expect(surface().amend.active).toBe(false);
    expect(surface().message).toBe("");
    expect(committed).toEqual(["done"]);
  });

  it("does not amend with an empty message and keeps amend mode after a failure", async () => {
    const fake = amendPort(async () => READY);
    render(options({ port: fake.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    await act(async () => surface().setAmending(true));
    act(() => surface().setMessage("   "));
    act(() => surface().commit());
    expect(fake.amends).toHaveLength(0);

    act(() => surface().setMessage("reworded"));
    act(() => surface().commit());
    await act(async () =>
      fake.amends[0]?.result.resolve({ kind: "failed", message: "The last commit changed." }),
    );
    expect(surface().notice).toEqual({ kind: "error", text: "The last commit changed." });
    expect(surface().amend.active).toBe(true);
    expect(surface().message).toBe("reworded");
  });

  it("never pushes while amending", async () => {
    const fake = amendPort(async () => READY);
    render(options({ port: fake.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    await act(async () => surface().setAmending(true));

    act(() => surface().commitAndPush());

    expect(surface().busy).toBe("idle");
    expect(fake.amends).toHaveLength(0);
  });

  it("drops a candidate that settles after the owner changed (A to B to A)", async () => {
    const pending = deferred<AgentGitAmendAvailability>();
    const fake = amendPort(() => pending.promise);
    render(options({ port: fake.port, ownerKey: "project-a" }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    act(() => surface().setAmending(true));
    expect(surface().amend.checking).toBe(true);

    render(options({ port: fake.port, ownerKey: "project-b" }));
    render(options({ port: fake.port, ownerKey: "project-a" }));
    await act(async () => pending.resolve(READY));

    expect(surface().amend.active).toBe(false);
    expect(surface().amend.checking).toBe(false);
    expect(surface().message).toBe("");
    render(options({ port: fake.port, ownerKey: "project-b" }));
    expect(surface().amend.active).toBe(false);
  });

  it("drops a candidate when amend is turned off before it settles", async () => {
    const pending = deferred<AgentGitAmendAvailability>();
    const fake = amendPort(() => pending.promise);
    render(options({ port: fake.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    act(() => surface().setAmending(true));
    act(() => surface().setAmending(false));
    await act(async () => pending.resolve(READY));
    expect(surface().amend.active).toBe(false);
    expect(surface().message).toBe("");
  });
});
