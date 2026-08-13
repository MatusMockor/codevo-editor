// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentThreadPinStorageKey,
  useAgentThreadPins,
  type AgentThreadPinStorage,
  type UseAgentThreadPinsResult,
} from "./useAgentThreadPins";

describe("useAgentThreadPins", () => {
  let host: HTMLDivElement;
  let root: Root;
  let result: UseAgentThreadPinsResult;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    onRender,
    pinnableTaskIds,
    storage,
    workspaceRoot,
  }: {
    readonly onRender?: (pinnedTaskIds: readonly string[]) => void;
    readonly pinnableTaskIds: readonly string[];
    readonly storage?: AgentThreadPinStorage;
    readonly workspaceRoot: string | null;
  }) {
    result = useAgentThreadPins(workspaceRoot, pinnableTaskIds, storage);
    onRender?.(result.pinnedTaskIds);
    return null;
  }

  function render(
    workspaceRoot: string | null,
    pinnableTaskIds: readonly string[],
    storage?: AgentThreadPinStorage,
    onRender?: (pinnedTaskIds: readonly string[]) => void,
  ) {
    act(() =>
      root.render(
        <Harness
          onRender={onRender}
          pinnableTaskIds={pinnableTaskIds}
          storage={storage}
          workspaceRoot={workspaceRoot}
        />,
      ),
    );
  }

  it("persists pins across remounts for the same normalized workspace root", () => {
    render("/workspace/", ["agt-1", "agt-2"]);
    act(() => {
      result.toggle("agt-1");
    });

    expect(window.localStorage.getItem(agentThreadPinStorageKey("/workspace"))).toBe('["agt-1"]');

    act(() => root.unmount());
    root = createRoot(host);
    render("/workspace", ["agt-1", "agt-2"]);

    expect(result.pinnedTaskIds).toEqual(["agt-1"]);
  });

  it("orders pins by pin time with the newest first and unpins on a second toggle", () => {
    render("/workspace", ["agt-1", "agt-2", "agt-3"]);

    act(() => {
      result.toggle("agt-1");
    });
    act(() => {
      result.toggle("agt-3");
    });
    expect(result.pinnedTaskIds).toEqual(["agt-3", "agt-1"]);

    act(() => {
      result.toggle("agt-3");
    });
    expect(result.pinnedTaskIds).toEqual(["agt-1"]);
    expect(window.localStorage.getItem(agentThreadPinStorageKey("/workspace"))).toBe('["agt-1"]');
  });

  it("refuses to pin a task that is not a pinnable thread", () => {
    render("/workspace", ["agt-1"]);

    let pinned = true;
    act(() => {
      pinned = result.toggle("/workspace/.worktrees/agt-9");
    });

    expect(pinned).toBe(false);
    expect(result.pinnedTaskIds).toEqual([]);
    expect(window.localStorage.getItem(agentThreadPinStorageKey("/workspace"))).toBeNull();

    act(() => {
      pinned = result.toggle("");
    });
    expect(pinned).toBe(false);
  });

  it("prunes pins of dismissed threads once the remaining threads are known", () => {
    const storageKey = agentThreadPinStorageKey("/workspace");
    window.localStorage.setItem(storageKey, JSON.stringify(["agt-1", "agt-2"]));

    render("/workspace", ["agt-2"]);

    expect(result.pinnedTaskIds).toEqual(["agt-2"]);
    expect(window.localStorage.getItem(storageKey)).toBe('["agt-2"]');
  });

  it("keeps persisted pins while no thread of the workspace is known yet", () => {
    const storageKey = agentThreadPinStorageKey("/workspace");
    window.localStorage.setItem(storageKey, JSON.stringify(["agt-1"]));

    render("/workspace", []);

    expect(window.localStorage.getItem(storageKey)).toBe('["agt-1"]');

    render("/workspace", ["agt-1"]);

    expect(result.pinnedTaskIds).toEqual(["agt-1"]);
  });

  it("never renders stale pins across workspace A to B to A switches", () => {
    const snapshots: string[][] = [];
    const capture = (pinnedTaskIds: readonly string[]) => {
      snapshots.push([...pinnedTaskIds]);
    };
    render("/workspace-a", ["agt-a"], undefined, capture);
    act(() => {
      result.toggle("agt-a");
    });

    snapshots.length = 0;
    render("/workspace-b", ["agt-b"], undefined, capture);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((snapshot) => !snapshot.includes("agt-a"))).toBe(true);
    act(() => {
      result.toggle("agt-b");
    });

    snapshots.length = 0;
    render("/workspace-a/", ["agt-a"], undefined, capture);
    expect(snapshots[0]).toEqual(["agt-a"]);
    expect(snapshots.every((snapshot) => !snapshot.includes("agt-b"))).toBe(true);
    expect(window.localStorage.getItem(agentThreadPinStorageKey("/workspace-b"))).toBe('["agt-b"]');
  });

  it("keeps null-workspace pins in memory without persisting them", () => {
    render(null, ["agt-1"]);

    act(() => {
      result.toggle("agt-1");
    });
    expect(result.pinnedTaskIds).toEqual(["agt-1"]);
    expect(window.localStorage.length).toBe(0);

    act(() => {
      result.toggle("agt-1");
    });
    expect(result.pinnedTaskIds).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });

  it.each([
    ["corrupt JSON", "{", []],
    ["a non-array value", '{"taskId":"agt-1"}', []],
    ["non-string entries", '["agt-1",42,null]', ["agt-1"]],
    ["empty string entries", '["agt-1",""]', ["agt-1"]],
    ["duplicate entries", '["agt-1","agt-1"]', ["agt-1"]],
  ])("handles %s in persisted pins", (_name, raw, expected) => {
    window.localStorage.setItem(agentThreadPinStorageKey("/workspace"), raw);
    render("/workspace", ["agt-1"]);

    expect([...result.pinnedTaskIds]).toEqual(expected);
  });

  it("evicts the oldest pin beyond the bound on read and on write", () => {
    const taskIds = Array.from({ length: 65 }, (_value, index) => `agt-${String(index)}`);
    const storageKey = agentThreadPinStorageKey("/workspace");
    window.localStorage.setItem(storageKey, JSON.stringify(taskIds));
    render("/workspace", taskIds);

    expect(result.pinnedTaskIds).toHaveLength(64);
    expect(result.pinnedTaskIds).not.toContain("agt-64");

    act(() => {
      result.toggle("agt-64");
    });

    expect(result.pinnedTaskIds).toHaveLength(64);
    expect(result.pinnedTaskIds[0]).toBe("agt-64");
    expect(result.pinnedTaskIds).not.toContain("agt-63");
    const persisted: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    expect(persisted).toHaveLength(64);
  });

  it("drops an over-long task id from persistence", () => {
    const overLongTaskId = "x".repeat(129);
    render("/workspace", [overLongTaskId]);

    act(() => {
      result.toggle(overLongTaskId);
    });

    expect(result.pinnedTaskIds).toEqual([]);
    expect(window.localStorage.getItem(agentThreadPinStorageKey("/workspace"))).toBeNull();
  });

  it("survives storage reads, writes and removals that throw", () => {
    const storage: AgentThreadPinStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("blocked");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("blocked");
      }),
    };
    render("/workspace", ["agt-1"], storage);

    act(() => {
      result.toggle("agt-1");
    });
    expect(result.pinnedTaskIds).toEqual(["agt-1"]);

    act(() => {
      result.toggle("agt-1");
    });
    expect(result.pinnedTaskIds).toEqual([]);
  });

  it("never retries a rejected write of the same pins when the thread list churns", () => {
    const storage: AgentThreadPinStorage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(() => undefined),
      setItem: vi.fn(() => {
        throw new DOMException("quota exceeded");
      }),
    };
    render("/workspace", ["agt-1"], storage);

    act(() => {
      result.toggle("agt-1");
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    render("/workspace", ["agt-1"], storage);
    render("/workspace", ["agt-1"], storage);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(result.pinnedTaskIds).toEqual(["agt-1"]);
  });
});
