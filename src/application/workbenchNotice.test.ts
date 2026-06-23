import { describe, expect, it } from "vitest";
import {
  capDiagnosticNotices,
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
} from "./workbenchNotice";

describe("replaceWorkbenchNoticeGroup", () => {
  it("replaces only notices from the same group", () => {
    const current = [
      createWorkbenchNotice("error", "phpactor", "old", "diagnostics:a"),
      createWorkbenchNotice("warning", "phpactor", "other", "diagnostics:b"),
    ];
    const replacement = [
      createWorkbenchNotice("info", "phpactor", "new", "diagnostics:a"),
    ];

    expect(replaceWorkbenchNoticeGroup(current, "diagnostics:a", replacement)).toEqual([
      replacement[0],
      current[1],
    ]);
  });
});

describe("capDiagnosticNotices", () => {
  const overflowNotice = (hidden: number) =>
    createWorkbenchNotice(
      "info",
      "phpactor",
      `${hidden} more`,
      "diagnostics:a",
    );

  it("returns the notices unchanged when at or below the limit", () => {
    const notices = [
      createWorkbenchNotice("error", "phpactor", "a", "diagnostics:a"),
      createWorkbenchNotice("error", "phpactor", "b", "diagnostics:a"),
    ];

    expect(capDiagnosticNotices(notices, 2, overflowNotice)).toBe(notices);
    expect(capDiagnosticNotices(notices, 5, overflowNotice)).toBe(notices);
  });

  it("keeps the first `limit` notices and appends an overflow indicator", () => {
    const notices = Array.from({ length: 300 }, (_, index) =>
      createWorkbenchNotice(
        "error",
        "phpactor",
        `diagnostic ${index}`,
        "diagnostics:a",
      ),
    );

    const capped = capDiagnosticNotices(notices, 100, overflowNotice);

    // 100 kept diagnostics + 1 overflow indicator, never the full 300.
    expect(capped).toHaveLength(101);
    expect(capped.slice(0, 100)).toEqual(notices.slice(0, 100));
    // The overflow indicator must report the truthful hidden count (not lie).
    expect(capped[100].message).toBe("200 more");
    expect(capped[100].severity).toBe("info");
  });

  it("does not append an overflow indicator when nothing is hidden", () => {
    const notices = [
      createWorkbenchNotice("error", "phpactor", "a", "diagnostics:a"),
    ];

    expect(capDiagnosticNotices(notices, 1, overflowNotice)).toBe(notices);
  });
});
