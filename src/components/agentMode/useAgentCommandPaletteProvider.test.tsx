// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useAgentCommandPaletteProvider,
  type AgentCommandPaletteProviderOptions,
} from "./useAgentCommandPaletteProvider";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function view(
  id: string,
  title: string,
  rootKey: string,
  updated: number,
  lifecycle: "running" | "settled" | "archived" = "settled",
) {
  return {
    thread: {
      threadId: id,
      title,
      updatedAtEpochMs: updated,
      owner: { rootKey, ownerId: "o", repositoryRoot: "/r" },
    },
    lifecycle,
    repositoryLabel: "repo",
  } as never;
}

function options(
  overrides: Partial<AgentCommandPaletteProviderOptions> = {},
): AgentCommandPaletteProviderOptions {
  return {
    threads: [view("t1", "Idempotency", "orders", 10), view("t2", "Old", "orders", 5, "archived")],
    projects: [{ rootKey: "orders", rootPath: "/u/orders-api", label: "orders-api" } as never],
    selectedThreadId: "t1",
    activeProjectKey: "orders",
    selectThread: vi.fn(),
    setProjectScope: vi.fn(() => true),
    newThread: vi.fn(),
    scripts: {
      entries: [
        { key: "s", label: "test", detail: "vitest run", availability: { kind: "available" } },
      ],
      truncated: false,
      runScript: vi.fn(() => true),
    },
    ...overrides,
  };
}

function Harness(props: AgentCommandPaletteProviderOptions) {
  useAgentCommandPaletteProvider(props);
  return null;
}

describe("useAgentCommandPaletteProvider", () => {
  it("publishes projects, non-archived threads and scripts while mounted", () => {
    ui = mountUi();
    ui.render(<Harness {...options()} />);
    const provider = workbenchAgentPaletteProvider.current();
    expect(provider?.projects).toEqual([
      { key: "orders", label: "orders-api", path: "/u/orders-api", current: true },
    ]);
    expect(provider?.threads.map((thread) => thread.id)).toEqual(["t1"]);
    expect(provider?.threads[0]).toMatchObject({
      projectLabel: "orders-api",
      current: true,
      updatedAtMs: 10,
    });
    expect(provider?.scripts).toEqual([
      { key: "s", name: "test", detail: "vitest run", runnable: true },
    ]);
    ui.unmount();
    ui = null;
    expect(workbenchAgentPaletteProvider.current()).toBeNull();
  });

  it("fails closed for vanished threads and projects and starts a thread in a project", () => {
    const selectThread = vi.fn();
    const setProjectScope = vi.fn(() => true);
    const newThread = vi.fn();
    ui = mountUi();
    ui.render(<Harness {...options({ selectThread, setProjectScope, newThread })} />);
    const provider = workbenchAgentPaletteProvider.current();

    expect(provider?.openThread("missing")).toBe(false);
    expect(provider?.openThread("t2")).toBe(false);
    expect(provider?.openThread("t1")).toBe(true);
    expect(provider?.switchProject("missing")).toBe(false);
    expect(provider?.newThreadIn("orders")).toBe(true);
    expect(selectThread).toHaveBeenCalledWith("t1");
    expect(setProjectScope).toHaveBeenCalledWith("orders");
    expect(newThread).toHaveBeenCalledTimes(1);
  });

  it("reads the latest data at call time after a rerender", () => {
    const selectThread = vi.fn();
    ui = mountUi();
    ui.render(<Harness {...options({ selectThread })} />);
    ui.render(
      <Harness {...options({ selectThread, threads: [view("t9", "New", "orders", 20)] })} />,
    );
    const provider = workbenchAgentPaletteProvider.current();
    expect(provider?.openThread("t1")).toBe(false);
    expect(provider?.openThread("t9")).toBe(true);
  });
});
