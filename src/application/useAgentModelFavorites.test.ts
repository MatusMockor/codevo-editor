// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
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
});
