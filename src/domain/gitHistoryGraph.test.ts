import { describe, expect, it } from "vitest";
import {
  GIT_HISTORY_GRAPH_COMMIT_LIMIT,
  GIT_HISTORY_GRAPH_LANE_LIMIT,
  projectGitHistoryGraph,
  type GitHistoryGraphCommit,
} from "./gitHistoryGraph";

function commit(hash: string, ...parents: string[]): GitHistoryGraphCommit {
  return { hash, parents };
}

const mergeHistory = [
  commit("merge", "left", "right"),
  commit("left", "base"),
  commit("right", "base"),
  commit("base"),
];

describe("projectGitHistoryGraph", () => {
  it("projects an empty history without an invented lane", () => {
    expect(projectGitHistoryGraph([])).toEqual({
      rows: [],
      laneCount: 0,
      omittedCommitCount: 0,
      omittedEdgeCount: 0,
      invalidCommitHash: null,
    });
  });

  it("connects a linear history and stops at its root", () => {
    const graph = projectGitHistoryGraph([commit("a", "b"), commit("b", "c"), commit("c")]);
    expect(graph.laneCount).toBe(1);
    expect(graph.rows.map((row) => row.node?.lane)).toEqual([0, 0, 0]);
    expect(graph.rows[0].segments).toEqual([
      { from: { lane: 0, position: 0.5 }, to: { lane: 0, position: 1 }, color: 0 },
    ]);
    expect(graph.rows[2].segments).toEqual([
      { from: { lane: 0, position: 0 }, to: { lane: 0, position: 0.5 }, color: 0 },
    ]);
  });

  it("keeps diverged branches distinct and joins only their common parent", () => {
    const graph = projectGitHistoryGraph(mergeHistory);
    expect(graph.rows.map((row) => row.node?.lane)).toEqual([0, 0, 1, 0]);
    expect(graph.rows[0].segments.map((edge) => edge.to.lane)).toEqual([0, 1]);
    expect(graph.rows[2].segments).toContainEqual({
      from: { lane: 1, position: 0.5 },
      to: { lane: 0, position: 1 },
      color: 0,
    });
    expect(graph.rows[1].segments).toContainEqual({
      from: { lane: 1, position: 0 },
      to: { lane: 1, position: 1 },
      color: 1,
    });
  });

  it("keeps unrelated roots disconnected", () => {
    const graph = projectGitHistoryGraph([commit("a"), commit("b")]);
    expect(graph.rows.every((row) => row.segments.length === 0)).toBe(true);
  });

  it("continues unknown parents below the loaded boundary without joining them", () => {
    const graph = projectGitHistoryGraph([commit("a", "outside-a"), commit("b", "outside-b")]);
    expect(graph.rows[1].node?.lane).toBe(1);
    expect(graph.rows[1].segments).toEqual([
      { from: { lane: 0, position: 0 }, to: { lane: 0, position: 1 }, color: 0 },
      { from: { lane: 1, position: 0.5 }, to: { lane: 1, position: 1 }, color: 1 },
    ]);
  });

  it("keeps every previously loaded row stable when loading more", () => {
    for (let count = 1; count < mergeHistory.length; count += 1) {
      expect(projectGitHistoryGraph(mergeHistory.slice(0, count)).rows).toEqual(
        projectGitHistoryGraph(mergeHistory).rows.slice(0, count),
      );
    }
  });

  it("projects octopus merges with distinct parent lanes", () => {
    const graph = projectGitHistoryGraph([commit("merge", "a", "b", "c", "d")]);
    expect(graph.laneCount).toBe(4);
    expect(graph.rows[0].segments.map((edge) => edge.to.lane)).toEqual([0, 1, 2, 3]);
  });

  it("bounds an excessive merge and explicitly reports omitted edges", () => {
    const parents = Array.from({ length: 20 }, (_, index) => `p${index}`);
    const graph = projectGitHistoryGraph([
      commit("merge", ...parents),
      commit("unrelated", "other"),
    ]);
    expect(graph.laneCount).toBe(GIT_HISTORY_GRAPH_LANE_LIMIT);
    expect(graph.rows[0].segments).toHaveLength(GIT_HISTORY_GRAPH_LANE_LIMIT);
    expect(graph.rows[0].omittedEdgeCount).toBe(8);
    expect(graph.rows[1].node).toBeNull();
    expect(graph.rows[1].omittedEdgeCount).toBe(2);
    expect(graph.omittedEdgeCount).toBe(10);
    expect(graph.rows[1].segments.every((edge) => edge.from.lane === edge.to.lane)).toBe(true);
  });

  it("never attaches an omitted parent to another occupied lane", () => {
    const parents = Array.from({ length: 13 }, (_, index) => `p${index}`);
    const graph = projectGitHistoryGraph([
      commit("merge", ...parents),
      commit("p0"),
      commit("p12"),
    ]);
    expect(graph.rows[2].node?.lane).toBe(0);
    expect(graph.rows[2].segments.some((edge) => edge.from.lane === 0)).toBe(false);
  });

  it.each([
    { commits: [commit("a"), commit("a")], hash: "a", valid: 1 },
    { commits: [commit("parent"), commit("child", "parent")], hash: "child", valid: 1 },
    { commits: [commit("self", "self")], hash: "self", valid: 0 },
    { commits: [commit("duplicate", "parent", "parent")], hash: "duplicate", valid: 0 },
    { commits: [commit("empty-parent", "")], hash: "empty-parent", valid: 0 },
    { commits: [commit("")], hash: "", valid: 0 },
  ])("fails closed on invalid ordering or identities: $hash", ({ commits, hash, valid }) => {
    const graph = projectGitHistoryGraph(commits);
    expect(graph.rows).toHaveLength(valid);
    expect(graph.invalidCommitHash).toBe(hash);
    expect(graph.omittedCommitCount).toBe(commits.length - valid);
  });

  it("rejects excessive parent counts before projecting edges", () => {
    const graph = projectGitHistoryGraph([
      commit("merge", ...Array.from({ length: 65 }, (_, index) => `p${index}`)),
    ]);
    expect(graph.invalidCommitHash).toBe("merge");
    expect(graph.rows).toHaveLength(0);
  });

  it("bounds identity lengths in invalid output", () => {
    const graph = projectGitHistoryGraph([commit("a".repeat(10000))]);
    expect(graph.invalidCommitHash).toHaveLength(128);
  });

  it("bounds loaded commits and exposes truncation", () => {
    const commits = Array.from({ length: 600 }, (_, index) => commit(`c${index}`, `c${index + 1}`));
    const graph = projectGitHistoryGraph(commits);
    expect(graph.rows).toHaveLength(GIT_HISTORY_GRAPH_COMMIT_LIMIT);
    expect(graph.omittedCommitCount).toBe(100);
    expect(graph.invalidCommitHash).toBeNull();
  });

  it("does not mutate frozen inputs and remains deterministic", () => {
    const commits = Object.freeze(
      mergeHistory.map((item) =>
        Object.freeze({ hash: item.hash, parents: Object.freeze([...item.parents]) }),
      ),
    );
    expect(projectGitHistoryGraph(commits)).toEqual(projectGitHistoryGraph(commits));
  });
});
