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

describe("createWorkbenchNotice", () => {
  it("leaves kind undefined for ordinary notices", () => {
    const notice = createWorkbenchNotice("error", "phpactor", "boom");

    expect(notice.kind).toBeUndefined();
  });

  it("tags the notice with an overflow kind when requested", () => {
    const notice = createWorkbenchNotice(
      "info",
      "phpactor",
      "10 more",
      "diagnostics:a",
      undefined,
      "overflow",
    );

    expect(notice.kind).toBe("overflow");
  });
});

describe("capDiagnosticNotices", () => {
  const overflowNotice = (hidden: number) =>
    createWorkbenchNotice(
      "info",
      "phpactor",
      `${hidden} more`,
      "diagnostics:a",
      undefined,
      "overflow",
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
    // The overflow indicator must be machine-recognizable (not text-matched).
    expect(capped[100].kind).toBe("overflow");
  });

  it("does not append an overflow indicator when nothing is hidden", () => {
    const notices = [
      createWorkbenchNotice("error", "phpactor", "a", "diagnostics:a"),
    ];

    expect(capDiagnosticNotices(notices, 1, overflowNotice)).toBe(notices);
  });
});
