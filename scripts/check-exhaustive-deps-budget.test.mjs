import { describe, expect, it } from "vitest";
import { compareSnapshots, snapshotFromEslintReport } from "./check-exhaustive-deps-budget.mjs";

describe("exhaustive-deps debt ratchet", () => {
  it("counts only exhaustive-deps findings and normalizes paths", () => {
    const snapshot = snapshotFromEslintReport(
      [
        {
          filePath: "/repo/src/useFeature.ts",
          messages: [
            { ruleId: "react-hooks/exhaustive-deps" },
            { ruleId: "@typescript-eslint/no-unused-vars" },
          ],
        },
      ],
      "/repo",
    );

    expect(snapshot).toEqual({
      budget: 1,
      files: { "src/useFeature.ts": 1 },
      rule: "react-hooks/exhaustive-deps",
    });
  });

  it("rejects debt in new files and growth in legacy files", () => {
    const result = compareSnapshots(
      { files: { "src/legacy.ts": 2 } },
      { files: { "src/legacy.ts": 3, "src/new.ts": 1 } },
    );

    expect(result.growth).toEqual([
      { actual: 3, expected: 2, path: "src/legacy.ts" },
      { actual: 1, expected: 0, path: "src/new.ts" },
    ]);
  });

  it("requires reductions to be recorded so debt cannot return", () => {
    const result = compareSnapshots(
      { files: { "src/legacy.ts": 2 } },
      { files: { "src/legacy.ts": 1 } },
    );

    expect(result.reductions).toEqual([{ actual: 1, expected: 2, path: "src/legacy.ts" }]);
  });
});
