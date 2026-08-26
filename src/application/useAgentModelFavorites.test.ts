// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { waitForReact } from "../test/reactTestLifecycle";
import { normalizeAppSettings } from "../domain/settings";
import {
  MAX_AGENT_MODEL_FAVORITES,
  toggleAgentModelFavorite,
  useAgentModelFavorites,
  type AgentModelFavorites,
} from "./useAgentModelFavorites";

describe("toggleAgentModelFavorite", () => {
  it("adds a missing key and removes a present one without mutating the input", () => {
    const empty: ReadonlySet<string> = new Set();
    const added = toggleAgentModelFavorite(empty, "claudeCode/opus");
    expect([...added]).toEqual(["claudeCode/opus"]);
    expect(empty.size).toBe(0);

    const removed = toggleAgentModelFavorite(added, "claudeCode/opus");
    expect(removed.size).toBe(0);
    expect(added.size).toBe(1);
  });

  it("ignores a new key once the bounded limit is reached but still allows removal", () => {
    const full: ReadonlySet<string> = new Set(
      Array.from({ length: MAX_AGENT_MODEL_FAVORITES }, (_, index) => `codex/model-${index}`),
    );
    expect(toggleAgentModelFavorite(full, "codex/extra")).toBe(full);
    expect(toggleAgentModelFavorite(full, "codex/model-0").size).toBe(
      MAX_AGENT_MODEL_FAVORITES - 1,
    );
  });
});

describe("useAgentModelFavorites", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentModelFavorites | null;

  function Probe() {
    latest = useAgentModelFavorites();
    return null;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
    act(() => root.render(createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("starts empty and toggles keys in memory for the session", () => {
    expect(latest?.keys.size).toBe(0);
    expect(latest?.isFavorite("claudeCode/fable")).toBe(false);

    act(() => latest?.toggle("claudeCode/fable"));
    expect(latest?.isFavorite("claudeCode/fable")).toBe(true);
    expect([...(latest?.keys ?? [])]).toEqual(["claudeCode/fable"]);

    act(() => latest?.toggle("claudeCode/fable"));
    expect(latest?.isFavorite("claudeCode/fable")).toBe(false);
  });

  it("serializes persisted writes and a late failure cannot roll back a newer toggle", async () => {
    const pending: Array<{
      readonly keys: ReadonlyArray<string>;
      readonly revision: number;
      resolve(): void;
      reject(error: unknown): void;
    }> = [];
    const save = vi.fn((keys: ReadonlyArray<string>, revision: number) => {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((settle, fail) => {
        resolve = settle;
        reject = fail;
      });
      pending.push({ keys, revision, resolve, reject });
      return promise;
    });

    function PersistedProbe() {
      latest = useAgentModelFavorites({ keys: [], revision: 0, save });
      return null;
    }
    act(() => root.render(createElement(PersistedProbe)));
    act(() => {
      latest?.toggle("claudeCode/fable");
      latest?.toggle("claudeCode/opus");
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(pending[0]?.keys).toEqual(["claudeCode/fable"]);
    expect(pending[0]?.revision).toBe(1);
    expect([...(latest?.keys ?? [])]).toEqual(["claudeCode/fable", "claudeCode/opus"]);

    await act(async () => {
      pending[0]?.reject(new Error("old write failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(pending[1]?.keys).toEqual(["claudeCode/fable", "claudeCode/opus"]);
    expect(pending[1]?.revision).toBe(2);
    expect([...(latest?.keys ?? [])]).toEqual(["claudeCode/fable", "claudeCode/opus"]);
    pending[1]?.resolve();
  });

  it("adopts a parent rollback after the only write fails and reconciles persistence", async () => {
    const harness = persistedFavoritesHarness();
    act(() => harness.hook()?.toggle("claudeCode/opus"));
    expect(harness.saves[0]?.keys).toEqual(["claudeCode/opus"]);

    harness.setAuthoritative(["claudeCode/opus"], 1);
    await act(async () => {
      harness.saves[0]?.reject(new Error("save failed"));
      harness.setAuthoritative([], 0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.hook()?.isFavorite("claudeCode/opus")).toBe(false);
  });

  it("ignores an unrelated stale rollback after a newer favorite save settles", async () => {
    const harness = persistedFavoritesHarness();
    act(() => harness.hook()?.toggle("claudeCode/opus"));
    harness.setAuthoritative(["claudeCode/opus"], 1);
    await act(async () => {
      harness.saves[0]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    harness.setAuthoritative([], 0);

    expect(harness.hook()?.isFavorite("claudeCode/opus")).toBe(true);
  });

  it("ignores an unrelated stale rollback while a newer favorite save is in flight", () => {
    const harness = persistedFavoritesHarness();
    act(() => harness.hook()?.toggle("claudeCode/opus"));

    harness.setAuthoritative([], 0);

    expect(harness.hook()?.isFavorite("claudeCode/opus")).toBe(true);
  });

  it("lets an external clear win over an older in-flight write", async () => {
    const harness = persistedFavoritesHarness();
    act(() => harness.hook()?.toggle("claudeCode/opus"));
    harness.setAuthoritative(["claudeCode/opus"], 1);
    harness.setAuthoritative([], 2);
    expect(harness.hook()?.isFavorite("claudeCode/opus")).toBe(false);

    await act(async () => {
      harness.saves[0]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => expect(harness.saves[1]?.keys).toEqual([]));
    expect(harness.saves[1]?.revision).toBe(2);
  });

  it("lets a later settings clear replace a newer local write queued behind an older write", async () => {
    const harness = persistedFavoritesHarness();
    act(() => harness.hook()?.toggle("claudeCode/opus"));
    harness.setAuthoritative(["claudeCode/opus"], 1);
    act(() => harness.hook()?.toggle("codex/gpt-5.5"));
    harness.setAuthoritative([], 2);

    expect([...(harness.hook()?.keys ?? [])]).toEqual([]);
    await act(async () => {
      harness.saves[0]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForReact(() => expect(harness.saves).toHaveLength(2));
    expect(harness.saves[1]).toMatchObject({ keys: [], revision: 2 });
  });

  it("preserves a newer queued local write when an older failed save rolls back", async () => {
    const harness = persistedFavoritesHarness();
    act(() => harness.hook()?.toggle("claudeCode/opus"));
    harness.setAuthoritative(["claudeCode/opus"], 1);
    act(() => harness.hook()?.toggle("codex/gpt-5.5"));
    harness.setAuthoritative([], 0);

    expect([...(harness.hook()?.keys ?? [])]).toEqual(["claudeCode/opus", "codex/gpt-5.5"]);
    await act(async () => {
      harness.saves[0]?.reject(new Error("old write failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForReact(() => expect(harness.saves).toHaveLength(2));
    expect(harness.saves[1]).toMatchObject({
      keys: ["claudeCode/opus", "codex/gpt-5.5"],
      revision: 2,
    });
  });

  it("fails closed when the persisted revision space is exhausted", () => {
    const harness = persistedFavoritesHarness([], Number.MAX_SAFE_INTEGER);
    act(() => harness.hook()?.toggle("claudeCode/opus"));

    expect(harness.hook()?.keys.size).toBe(0);
    expect(harness.saves).toHaveLength(0);
  });

  it("can persist a toggle after a corrupt stored snapshot recovers", () => {
    const recovered = normalizeAppSettings({
      agentModelFavoriteKeys: ["claudeCode/unknown"],
      agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
    });
    const harness = persistedFavoritesHarness(
      recovered.agentModelFavoriteKeys,
      recovered.agentModelFavoritesRevision,
    );

    act(() => harness.hook()?.toggle("claudeCode/opus"));

    expect(harness.saves[0]).toMatchObject({ keys: ["claudeCode/opus"], revision: 1 });
  });

  function persistedFavoritesHarness(initialKeys: ReadonlyArray<string> = [], initialRevision = 0) {
    let authoritative: ReadonlyArray<string> = initialKeys;
    let authoritativeRevision = initialRevision;
    let surface: AgentModelFavorites | null = null;
    const saves: Array<{
      readonly keys: ReadonlyArray<string>;
      readonly revision: number;
      resolve(): void;
      reject(error: unknown): void;
    }> = [];
    const save = (keys: ReadonlyArray<string>, revision: number): Promise<void> => {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((settle, fail) => {
        resolve = settle;
        reject = fail;
      });
      saves.push({ keys, revision, resolve, reject });
      return promise;
    };
    function PersistedProbe() {
      surface = useAgentModelFavorites({
        keys: authoritative,
        revision: authoritativeRevision,
        save,
      });
      return null;
    }
    const render = (): void => act(() => root.render(createElement(PersistedProbe)));
    render();
    return {
      saves,
      hook: () => surface,
      setAuthoritative(keys: ReadonlyArray<string>, revision: number): void {
        authoritative = keys;
        authoritativeRevision = revision;
        render();
      },
    };
  }
});
