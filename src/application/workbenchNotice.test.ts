import { describe, expect, it } from "vitest";
import {
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
