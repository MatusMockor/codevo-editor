import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_RAIL_COLLAPSED_PROJECTS,
  MAX_AGENT_RAIL_PROJECT_KEY_CHARS,
  collapseAgentRailProject,
  expandAgentRailProject,
  parseAgentRailCollapsedProjects,
  serializeAgentRailCollapsedProjects,
} from "./agentRailProjectCollapse";

describe("agentRailProjectCollapse", () => {
  it("round-trips the collapsed project keys", () => {
    const raw = serializeAgentRailCollapsedProjects(["/workspace/app", "remote:srv:/srv/api"]);
    expect(parseAgentRailCollapsedProjects(raw)).toEqual(["/workspace/app", "remote:srv:/srv/api"]);
  });

  it("starts with every project expanded when nothing valid is stored", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "[]",
      '{"collapsed":"x"}',
      '{"collapsed":[1]}',
      '{"collapsed":[""]}',
      '{"collapsed":[],"extra":true}',
      '{"kind":"project","projectRootKey":"/workspace/app"}',
    ]) {
      expect(parseAgentRailCollapsedProjects(raw)).toEqual([]);
    }
  });

  it("rejects oversized lists and keys instead of truncating them", () => {
    const tooMany = Array.from(
      { length: MAX_AGENT_RAIL_COLLAPSED_PROJECTS + 1 },
      (_, index) => `/p/${index}`,
    );
    expect(parseAgentRailCollapsedProjects(JSON.stringify({ collapsed: tooMany }))).toEqual([]);
    const longKey = "x".repeat(MAX_AGENT_RAIL_PROJECT_KEY_CHARS + 1);
    expect(parseAgentRailCollapsedProjects(JSON.stringify({ collapsed: [longKey] }))).toEqual([]);
  });

  it("drops duplicate keys", () => {
    expect(parseAgentRailCollapsedProjects('{"collapsed":["/a","/a","/b"]}')).toEqual(["/a", "/b"]);
  });

  it("collapses and expands one project without touching the others", () => {
    const collapsed = collapseAgentRailProject(["/a"], "/b");
    expect(collapsed).toEqual(["/a", "/b"]);
    expect(collapseAgentRailProject(collapsed, "/b")).toBe(collapsed);
    expect(expandAgentRailProject(collapsed, "/a")).toEqual(["/b"]);
    expect(expandAgentRailProject(collapsed, "/c")).toBe(collapsed);
    expect(collapseAgentRailProject(collapsed, "")).toBe(collapsed);
  });

  it("evicts the oldest collapsed project at the bound", () => {
    let keys: ReadonlyArray<string> = [];
    for (let index = 0; index <= MAX_AGENT_RAIL_COLLAPSED_PROJECTS; index += 1) {
      keys = collapseAgentRailProject(keys, `/p/${index}`);
    }
    expect(keys).toHaveLength(MAX_AGENT_RAIL_COLLAPSED_PROJECTS);
    expect(keys[0]).toBe("/p/1");
    expect(keys[keys.length - 1]).toBe(`/p/${MAX_AGENT_RAIL_COLLAPSED_PROJECTS}`);
  });
});
