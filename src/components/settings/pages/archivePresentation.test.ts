import { describe, expect, it } from "vitest";
import { archivedThreadGroups } from "./archivePresentation";

const NOW = Date.UTC(2026, 8, 24);
const DAY = 86_400_000;

function view(
  threadId: string,
  repositoryLabel: string,
  archived: boolean,
  ageMs: number,
  rootKey = `/work/${repositoryLabel}`,
) {
  return {
    repositoryLabel,
    thread: {
      threadId,
      title: `Thread ${threadId}`,
      archived,
      createdAtEpochMs: NOW - ageMs,
      owner: { rootKey },
    },
  };
}

describe("archivedThreadGroups", () => {
  it("keeps only archived threads, groups them by project, newest first", () => {
    const groups = archivedThreadGroups(
      [
        view("a", "orders-api", true, 14 * DAY),
        view("b", "web-dashboard", true, 30 * DAY),
        view("c", "orders-api", false, DAY),
        view("d", "orders-api", true, 21 * DAY),
      ],
      NOW,
    );
    expect(groups.map((group) => group.projectLabel)).toEqual(["orders-api", "web-dashboard"]);
    expect(groups[0]?.threads.map((thread) => thread.threadId)).toEqual(["a", "d"]);
    expect(groups[0]?.threads[0]?.createdLabel).toBe("Created 2w ago");
    expect(groups[1]?.threads[0]?.createdLabel).toBe("Created 1mo ago");
  });

  it("keeps two projects with the same label apart", () => {
    const groups = archivedThreadGroups(
      [view("a", "api", true, DAY, "/one/api"), view("b", "api", true, DAY, "/two/api")],
      NOW,
    );
    expect(groups.map((group) => [group.projectKey, group.projectLabel])).toEqual([
      ["/one/api", "api"],
      ["/two/api", "api"],
    ]);
  });

  it.each([
    [0, "Created 0m ago"],
    [-5 * 60_000, "Created 0m ago"],
    [59 * 60_000, "Created 59m ago"],
    [3 * 3_600_000, "Created 3h ago"],
    [2 * DAY, "Created 2d ago"],
    [400 * DAY, "Created 13mo ago"],
  ])("labels an age of %d ms as %s", (ageMs, label) => {
    expect(
      archivedThreadGroups([view("a", "api", true, ageMs)], NOW)[0]?.threads[0]?.createdLabel,
    ).toBe(label);
  });

  it("returns no groups when nothing is archived", () => {
    expect(archivedThreadGroups([view("x", "orders-api", false, DAY)], NOW)).toEqual([]);
  });
});
