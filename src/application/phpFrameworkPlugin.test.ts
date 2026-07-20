import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PhpFrameworkPlugin contract", () => {
  it("stays independent from concrete framework dependency ports", () => {
    const source = readFileSync(new URL("./phpFrameworkPlugin.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/Blade|Eloquent|Laravel|Latte|Nette|Neon/);
    expect(source).not.toMatch(/php(?:Blade|Laravel|Nette)/);
  });

  it("owns contextual framework navigation outside the central hook", () => {
    const hookSource = readFileSync(
      new URL("./usePhpContextualMemberDefinitionNavigation.ts", import.meta.url),
      "utf8",
    );

    expect(hookSource).not.toContain(
      "createPhpLaravelContextualMemberDefinitionNavigationContribution",
    );
    expect(hookSource).not.toContain(
      'from "./phpLaravelContextualMemberDefinitionNavigationAdapter"',
    );
  });
});
