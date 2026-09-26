// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitDiscardFileRequest,
  GitDiscardPreparation,
  GitDiscardReceipt,
  GitPrepareDiscardRequest,
} from "../../domain/gitWorkingTree";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { AgentGitChangeRow } from "./useAgentGitSurface";
import {
  DISCARD_CHANGED_MESSAGE,
  useAgentGitDiscard,
  type AgentGitDiscardState,
  type UseAgentGitDiscardOptions,
} from "./useAgentGitDiscard";

let ui: MountedUi | null = null;
const box: { current: AgentGitDiscardState | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function row(
  relativePath: string,
  status: AgentGitChangeRow["status"] = "modified",
  oldRelativePath: string | null = null,
): AgentGitChangeRow {
  const side = status === "untracked" ? "untracked" : "tracked";
  return {
    key: `${side}:${relativePath}`,
    relativePath,
    oldRelativePath,
    status,
    added: 1,
    deleted: 1,
    included: true,
  };
}

const FINGERPRINT = "ab".repeat(32);

function fakeGateway(
  prepare: () => Promise<GitDiscardPreparation> = async () => ({
    fingerprint: FINGERPRINT,
  }),
) {
  const calls: Array<{ request: GitDiscardFileRequest; result: Deferred<GitDiscardReceipt> }> = [];
  const prepared: GitPrepareDiscardRequest[] = [];
  const gateway = {
    prepareDiscard(request: GitPrepareDiscardRequest) {
      prepared.push(request);
      return prepare();
    },
    discardFile(request: GitDiscardFileRequest) {
      const result = deferred<GitDiscardReceipt>();
      calls.push({ request, result });
      return result.promise;
    },
  };
  return { calls, gateway, prepared };
}

function Probe(props: { readonly options: UseAgentGitDiscardOptions }) {
  box.current = useAgentGitDiscard(props.options);
  return null;
}

function render(next: UseAgentGitDiscardOptions): void {
  ui = ui ?? mountUi();
  ui.render(<Probe options={next} />);
}

function discard(): AgentGitDiscardState {
  const current = box.current;
  expect(current).not.toBeNull();
  return current as AgentGitDiscardState;
}

function options(overrides: Partial<UseAgentGitDiscardOptions>): UseAgentGitDiscardOptions {
  return {
    ownerKey: "project-a",
    target: { repositoryRoot: "/repo", worktreePath: null },
    gateway: null,
    rows: [row("a.ts")],
    onDiscarded: () => undefined,
    ...overrides,
  };
}

describe("useAgentGitDiscard", () => {
  it("confirms, then discards exactly the file and status the user saw", async () => {
    const fake = fakeGateway();
    const discarded: string[] = [];
    const rows = [row("src/new.ts", "renamed", "src/old.ts")];
    render(options({ gateway: fake.gateway, rows, onDiscarded: () => discarded.push("x") }));

    await act(async () => discard().request(rows[0] as AgentGitChangeRow));
    expect(discard().pending).toEqual({
      relativePath: "src/new.ts",
      oldRelativePath: "src/old.ts",
      status: "renamed",
      effect: "restoreRename",
      busy: false,
      ready: true,
    });
    expect(fake.prepared).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);

    act(() => discard().confirm());
    act(() => discard().confirm());
    expect(discard().pending?.busy).toBe(true);
    expect(fake.calls.map((call) => call.request)).toEqual([
      {
        repositoryRoot: "/repo",
        worktreePath: null,
        file: {
          relativePath: "src/new.ts",
          oldRelativePath: "src/old.ts",
          expectedStatus: "renamed",
        },
        fingerprint: FINGERPRINT,
      },
    ]);
    await act(async () =>
      fake.calls[0]?.result.resolve({ relativePath: "src/new.ts", action: "restored" }),
    );
    expect(discard().pending).toBeNull();
    expect(discard().notice).toEqual({ kind: "ok", text: "Discarded changes to src/new.ts." });
    expect(discarded).toEqual(["x"]);
  });

  it("reports a deleted untracked file truthfully", async () => {
    const fake = fakeGateway();
    const rows = [row("notes.txt", "untracked")];
    render(options({ gateway: fake.gateway, rows }));
    await act(async () => discard().request(rows[0] as AgentGitChangeRow));
    expect(discard().pending?.effect).toBe("delete");
    act(() => discard().confirm());
    await act(async () =>
      fake.calls[0]?.result.resolve({ relativePath: "notes.txt", action: "deleted" }),
    );
    expect(discard().notice).toEqual({ kind: "ok", text: "Deleted notes.txt." });
  });

  it("does nothing when the dialog is cancelled", async () => {
    const fake = fakeGateway();
    render(options({ gateway: fake.gateway }));
    await act(async () => discard().request(row("a.ts")));
    act(() => discard().cancel());
    act(() => discard().confirm());
    expect(discard().pending).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("fails closed when the row changed or vanished before confirmation", async () => {
    const fake = fakeGateway();
    render(options({ gateway: fake.gateway, rows: [row("a.ts"), row("b.ts")] }));
    await act(async () => discard().request(row("a.ts")));
    render(options({ gateway: fake.gateway, rows: [row("a.ts", "deleted"), row("b.ts")] }));
    act(() => discard().confirm());
    expect(fake.calls).toHaveLength(0);
    expect(discard().pending).toBeNull();
    expect(discard().notice).toEqual({ kind: "error", text: DISCARD_CHANGED_MESSAGE });

    await act(async () => discard().request(row("b.ts")));
    render(options({ gateway: fake.gateway, rows: [row("a.ts", "deleted")] }));
    act(() => discard().confirm());
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses to discard a conflicted file or a nested repository", () => {
    const fake = fakeGateway();
    const rows = [row("merge.ts", "conflicted"), row("vendor/lib/", "untracked")];
    render(options({ gateway: fake.gateway, rows }));
    act(() => discard().request(rows[0] as AgentGitChangeRow));
    expect(discard().pending).toBeNull();
    act(() => discard().request(rows[1] as AgentGitChangeRow));
    expect(discard().pending).toBeNull();
  });

  it("drops a pending confirmation when the owner changes, even back to the same owner", () => {
    const fake = fakeGateway();
    render(options({ gateway: fake.gateway, ownerKey: "project-a" }));
    act(() => discard().request(row("a.ts")));
    render(options({ gateway: fake.gateway, ownerKey: "project-b" }));
    expect(discard().pending).toBeNull();
    render(options({ gateway: fake.gateway, ownerKey: "project-a" }));
    expect(discard().pending).toBeNull();
    act(() => discard().confirm());
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps a late result with its owner and never refreshes another owner", async () => {
    const fake = fakeGateway();
    const discarded: string[] = [];
    const base = { gateway: fake.gateway, onDiscarded: () => discarded.push("x") };
    render(options({ ...base, ownerKey: "project-a" }));
    await act(async () => discard().request(row("a.ts")));
    act(() => discard().confirm());
    render(options({ ...base, ownerKey: "project-b" }));
    await act(async () => fake.calls[0]?.result.reject(new Error("index.lock exists")));

    expect(discard().notice).toBeNull();
    expect(discarded).toEqual([]);
    render(options({ ...base, ownerKey: "project-a" }));
    expect(discard().notice).toEqual({ kind: "error", text: "index.lock exists" });
    expect(discard().pending).toBeNull();
  });

  it("does not open a confirmation without a gateway or target", () => {
    render(options({ gateway: null }));
    act(() => discard().request(row("a.ts")));
    expect(discard().pending).toBeNull();
    expect(discard().available).toBe(false);
  });

  it("waits for the backend preparation before a confirmation can run", async () => {
    const preparation = deferred<GitDiscardPreparation>();
    const fake = fakeGateway(() => preparation.promise);
    render(options({ gateway: fake.gateway }));
    act(() => discard().request(row("a.ts")));
    expect(discard().pending?.ready).toBe(false);
    act(() => discard().confirm());
    expect(fake.calls).toHaveLength(0);

    await act(async () => preparation.resolve({ fingerprint: FINGERPRINT }));
    expect(discard().pending?.ready).toBe(true);
  });

  it("closes the dialog with the backend reason when preparation is refused", async () => {
    const fake = fakeGateway(() =>
      Promise.reject(new Error("Submodules can't be discarded here.")),
    );
    render(options({ gateway: fake.gateway }));
    await act(async () => discard().request(row("vendor/lib")));
    expect(discard().pending).toBeNull();
    expect(discard().notice).toEqual({
      kind: "error",
      text: "Submodules can't be discarded here.",
    });
  });

  it("drops a preparation that settles after the owner changed", async () => {
    const preparation = deferred<GitDiscardPreparation>();
    const fake = fakeGateway(() => preparation.promise);
    render(options({ gateway: fake.gateway, ownerKey: "project-a" }));
    act(() => discard().request(row("a.ts")));
    render(options({ gateway: fake.gateway, ownerKey: "project-b" }));
    render(options({ gateway: fake.gateway, ownerKey: "project-a" }));
    await act(async () => preparation.resolve({ fingerprint: FINGERPRINT }));
    expect(discard().pending).toBeNull();
  });

  it("asks the list to focus the row after the discarded one", async () => {
    const fake = fakeGateway();
    render(options({ gateway: fake.gateway, rows: [row("a.ts"), row("b.ts"), row("c.ts")] }));
    await act(async () => discard().request(row("b.ts")));
    act(() => discard().confirm());
    await act(async () =>
      fake.calls[0]?.result.resolve({ relativePath: "b.ts", action: "restored" }),
    );
    expect(discard().focusAfter).toEqual({ index: 1, removedKey: "tracked:b.ts", sequence: 1 });
  });
});
