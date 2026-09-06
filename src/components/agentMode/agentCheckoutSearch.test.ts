import { describe, expect, it } from "vitest";
import { agentPickerOption } from "./agentPickerOption";
import {
  checkoutDisplayLabel,
  checkoutRepositoryStart,
  createCheckoutSearch,
  type CheckoutSearchResult,
} from "./agentCheckoutSearch";

describe("checkout search projection", () => {
  it("processes at most100 repositories per turn and retains only the requested page", () => {
    let labelsRead = 0;
    const options = Array.from({ length: 500 }, (_, index) => ({
      ...agentPickerOption(`root:/repo-${index}`, ""),
      get label() {
        labelsRead += 1;
        return `Repo-${index}`;
      },
    }));
    const advance = createCheckoutSearch(options, 0, "repo", 9);
    let result: CheckoutSearchResult | null = null;
    for (let batch = 0; batch < 5; batch += 1) {
      const before = labelsRead;
      result = advance();
      expect(labelsRead - before).toBeLessThanOrEqual(200);
      if (batch < 4) expect(result).toBeNull();
    }
    expect(result?.rows).toHaveLength(50);
    expect(result?.total).toBe(500);
    expect(result?.rows[0]?.value).toBe("root:/repo-450");
    expect(result?.rows[49]?.value).toBe("root:/repo-499");
  });

  it("counts oversized mappings truthfully without lowercasing large strings", () => {
    const long = "x".repeat(4097);
    const options = [
      agentPickerOption("root:/valid", "Valid"),
      agentPickerOption("root:/label", long),
      agentPickerOption(`root:/${long}`, "Oversized path"),
    ];
    const result = createCheckoutSearch(options, 0, "valid", 0)();
    expect(result).toEqual({ rows: [options[0]], total: 1, excluded: 2 });
    expect(checkoutDisplayLabel(long)).toHaveLength(4096 + "… (name exceeds display limit)".length);
    expect(checkoutDisplayLabel("Valid")).toBe("Valid");
  });

  it("fully matches paths at the limit with Unicode case-insensitivity and literal metacharacters", () => {
    const path = "x".repeat(4090) + "É[.*]x";
    const option = agentPickerOption(`root:${path}`, "Label");
    expect(createCheckoutSearch([option], 0, "é[.*]", 0)()?.rows).toEqual([option]);
    expect(createCheckoutSearch([option], 0, "[no.*]", 0)()?.total).toBe(0);
  });

  it("keeps generic options out of repository search", () => {
    expect(checkoutRepositoryStart([agentPickerOption("plan", "Plan")])).toBe(1);
    expect(
      checkoutRepositoryStart([
        agentPickerOption("in-place", "Local"),
        agentPickerOption("root:/project", "Project"),
        agentPickerOption("root:/nested", "Nested"),
      ]),
    ).toBe(2);
  });
});
