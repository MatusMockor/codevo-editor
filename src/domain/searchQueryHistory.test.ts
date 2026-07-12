import { describe, expect, it } from "vitest";
import {
  SearchQueryHistoryStore,
  pushSearchQuery,
} from "./searchQueryHistory";

describe("pushSearchQuery", () => {
  it("caps the most recently used queries", () => {
    const history = Array.from({ length: 20 }, (_, index) => `query-${index}`);

    expect(pushSearchQuery(history, "latest")).toEqual([
      "latest",
      ...history.slice(0, 19),
    ]);
  });

  it("moves a duplicate query to the front", () => {
    expect(pushSearchQuery(["third", "second", "first"], "first")).toEqual([
      "first",
      "third",
      "second",
    ]);
  });

  it("skips empty and consecutive duplicate queries", () => {
    const history = ["current", "older"];

    expect(pushSearchQuery(history, "current")).toBe(history);
    expect(pushSearchQuery(history, "   ")).toBe(history);
  });

  it("collapses typing refinements into one entry", () => {
    const growing = pushSearchQuery(["conf", "older"], "config");
    expect(growing).toEqual(["config", "older"]);

    const shrinking = pushSearchQuery(["config", "older"], "conf");
    expect(shrinking).toEqual(["conf", "older"]);

    const unrelated = pushSearchQuery(["config", "older"], "router");
    expect(unrelated).toEqual(["router", "config", "older"]);
  });
});

describe("SearchQueryHistoryStore", () => {
  it("keeps histories isolated by workspace root", () => {
    const store = new SearchQueryHistoryStore();
    store.push("/workspace-a", "alpha");
    store.push("/workspace-b", "beta");

    store.activate("/workspace-a");
    expect(store.active()).toEqual(["alpha"]);

    store.activate("/workspace-b");
    expect(store.active()).toEqual(["beta"]);
    expect(store.get("/workspace-a")).toEqual(["alpha"]);
  });
});
