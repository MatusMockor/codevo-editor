// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOG_OWNER_ID,
  LOG_ROOT_KEY,
  logProject,
  logThread,
  renderLogStore,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";
import { AgentThreadCleanupIncompleteError } from "./agentThreadPorts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function store(options: Parameters<typeof renderLogStore>[0] = {}) {
  const harness = renderLogStore(options);
  cleanups.push(harness.unmount);
  await settleLogStore();
  return harness;
}

const RUNTIME_OWNER_ID = "workspace-runtime-1";
const runtimeProject = logProject({ ownerId: RUNTIME_OWNER_ID });
const saved = logThread({
  threadId: "agt-9-0a1b",
  title: "Older saved conversation",
  owner: { rootKey: LOG_ROOT_KEY, ownerId: RUNTIME_OWNER_ID, repositoryRoot: LOG_ROOT_KEY },
});

describe("deleting a saved conversation that is not loaded", () => {
  it("deletes its durable history and turn log under the exact project owner", async () => {
    const harness = await store({ projects: [runtimeProject] });
    await act(async () => {
      await harness.hook().deleteSavedThread?.(saved);
    });
    expect(harness.deleted).toEqual([
      { rootKey: LOG_ROOT_KEY, ownerId: LOG_OWNER_ID, threadId: saved.threadId },
    ]);
    expect(harness.logGateway.deletedLogs).toEqual([
      expect.objectContaining({ threadId: saved.threadId }),
    ]);
  });

  it("surfaces the backend failure instead of claiming success", async () => {
    const harness = await store({ projects: [runtimeProject] });
    harness.threadGateway.deleteFails = true;
    await act(async () => {
      await expect(harness.hook().deleteSavedThread?.(saved)).rejects.toThrow(
        "Unable to delete the saved thread.",
      );
    });
    expect(harness.logGateway.deletedLogs).toEqual([]);
  });

  it("refuses a loaded thread so the live delete path keeps its stop and session guards", async () => {
    const loaded = logThread();
    const harness = await store({ persisted: [loaded] });
    await act(async () => {
      await expect(harness.hook().deleteSavedThread?.(loaded)).rejects.toThrow(/open/u);
    });
    expect(harness.deleted).toEqual([]);
  });

  it("refuses a thread whose project is no longer the exact owner", async () => {
    const harness = await store();
    harness.setProjects([logProject({ ownerId: "workspace-runtime-2" })]);
    await act(async () => {
      await expect(harness.hook().deleteSavedThread?.(saved)).rejects.toThrow(/project/u);
    });
    expect(harness.deleted).toEqual([]);
  });

  it("does not restore a conversation while its delete is in flight", async () => {
    const harness = await store({ projects: [runtimeProject] });
    let finish: () => void = () => undefined;
    harness.threadGateway.deleteAgentThread = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    let deleting: Promise<void> | undefined;
    act(() => {
      deleting = harness.hook().deleteSavedThread?.(saved);
    });
    await act(async () => {
      expect(await harness.hook().restoreThread?.(saved)).toBe(false);
      finish();
      await deleting;
    });
    expect(harness.hook().currentState().threads.has(saved.threadId)).toBe(false);
  });

  it("refuses while a restore of the same conversation already holds its slot", async () => {
    const harness = await store({ projects: [runtimeProject] });
    let restoring: Promise<boolean> | undefined;
    let deleting: Promise<void> | undefined;
    act(() => {
      restoring = harness.hook().restoreThread?.(saved);
      deleting = harness.hook().deleteSavedThread?.(saved);
    });
    await act(async () => {
      await expect(deleting).rejects.toThrow(/opening/u);
      expect(await restoring).toBe(true);
    });
    expect(harness.deleted).toEqual([]);
    expect(harness.hook().currentState().threads.has(saved.threadId)).toBe(true);
  });

  it("refuses while the project's saved threads are still loading", async () => {
    const harness = renderLogStore({ projects: [runtimeProject] });
    cleanups.push(harness.unmount);
    await act(async () => {
      await expect(harness.hook().deleteSavedThread?.(saved)).rejects.toThrow(/loading/u);
    });
    expect(harness.deleted).toEqual([]);
  });

  it("still deletes the turn log and reports a warning when only attachment cleanup failed", async () => {
    const harness = await store({ projects: [runtimeProject] });
    harness.threadGateway.deleteAgentThread = async () => {
      throw "The saved thread was deleted but its attachments could not be removed: EACCES";
    };
    await act(async () => {
      await expect(harness.hook().deleteSavedThread?.(saved)).rejects.toBeInstanceOf(
        AgentThreadCleanupIncompleteError,
      );
    });
    expect(harness.logGateway.deletedLogs).toEqual([
      expect.objectContaining({ threadId: saved.threadId }),
    ]);
  });
});
