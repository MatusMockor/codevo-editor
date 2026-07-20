import { describe, expect, it } from "vitest";

import { vi } from "vitest";
import { createPhpFrameworkCodeActionContributionCatalog } from "./phpFrameworkCodeActionContributionCatalog";

describe("phpFrameworkCodeActionContributionCatalog", () => {
  it("composes framework code-action adapters outside the generic registry", () => {
    expect(
      createPhpFrameworkCodeActionContributionCatalog({
        collectViewTargets: vi.fn(async () => []),
        readTestFileIfExists: vi.fn(async () => null),
        workspaceRoot: "/workspace",
      }).map(({ id }) => id),
    ).toEqual(["missing-template-file", "nette-presenter-link-method"]);
  });
});
