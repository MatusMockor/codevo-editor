import { describe, expect, it } from "vitest";
import {
  capDiagnosticNotices,
  capWorkbenchNotices,
  createWorkbenchNotice,
  GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
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

describe("capWorkbenchNotices", () => {
  const buildNotices = (count: number) =>
    Array.from({ length: count }, (_unused, index) =>
      createWorkbenchNotice(
        "error",
        "phpactor",
        `diagnostic ${index}`,
        `language-server-diagnostics:file-${index}`,
      ),
    );

  it("returns the notices unchanged when at or below the global limit", () => {
    const notices = buildNotices(5);

    expect(capWorkbenchNotices(notices, 5)).toBe(notices);
    expect(capWorkbenchNotices(notices, 10)).toBe(notices);
  });

  it("keeps the first `limit` notices and appends one global overflow indicator", () => {
    const notices = buildNotices(2500);

    const capped = capWorkbenchNotices(notices, 2000);

    // 2000 kept notices + 1 global overflow indicator, never the full 2500.
    expect(capped).toHaveLength(2001);
    expect(capped.slice(0, 2000)).toEqual(notices.slice(0, 2000));

    const overflow = capped[2000];
    expect(overflow.kind).toBe("overflow");
    expect(overflow.severity).toBe("warning");
    expect(overflow.groupKey).toBe(GLOBAL_NOTICE_OVERFLOW_GROUP_KEY);
    // Truthful hidden count, never a lie.
    expect(overflow.message).toContain("500");
  });

  it("never truncates notices the predicate marks as protected", () => {
    // Protected notices (e.g. errors / setup prompts) sit among many cappable
    // diagnostic notices. The cap must keep every protected notice even when the
    // total exceeds the limit, capping only the diagnostic ones.
    const protectedNotices = [
      createWorkbenchNotice("error", "runtime", "server crashed", "php-setup"),
      createWorkbenchNotice("error", "runtime", "another failure"),
    ];
    const diagnosticNotices = buildNotices(2100);
    const isCappable = (notice: ReturnType<typeof createWorkbenchNotice>) =>
      notice.groupKey?.startsWith("language-server-diagnostics:") ?? false;

    const capped = capWorkbenchNotices(
      [...protectedNotices, ...diagnosticNotices],
      2000,
      isCappable,
    );

    protectedNotices.forEach((notice) => {
      expect(capped).toContain(notice);
    });
    const cappableKept = capped.filter((notice) => isCappable(notice));
    expect(cappableKept).toHaveLength(2000);
    const overflow = capped.filter(
      (notice) => notice.groupKey === GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
    );
    expect(overflow).toHaveLength(1);
    expect(overflow[0].message).toContain("100");
  });

  it("never double-counts a stale global overflow indicator when re-capping", () => {
    // An already-capped list (2000 notices + 1 overflow) that then gains a fresh
    // group at the front. Re-capping must drop the stale tail overflow before
    // recomputing so the hidden count stays truthful and the indicator never
    // duplicates.
    const capped = capWorkbenchNotices(buildNotices(2500), 2000);
    const freshGroup = createWorkbenchNotice(
      "error",
      "phpactor",
      "fresh diagnostic",
      "language-server-diagnostics:fresh",
    );
    const withFreshGroup = [freshGroup, ...capped];

    const reCapped = capWorkbenchNotices(withFreshGroup, 2000);

    const overflowNotices = reCapped.filter(
      (notice) => notice.groupKey === GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
    );
    expect(overflowNotices).toHaveLength(1);
    expect(reCapped).toHaveLength(2001);
    expect(reCapped[0]).toBe(freshGroup);
  });
});
