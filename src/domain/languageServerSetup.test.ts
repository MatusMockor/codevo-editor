import { describe, expect, it } from "vitest";
import type { LanguageServerPlan } from "./languageServer";
import { createPhpactorSetupGuide } from "./languageServerSetup";

describe("createPhpactorSetupGuide", () => {
  it("returns install commands when PHPactor is unavailable", () => {
    const guide = createPhpactorSetupGuide(plan("unavailable"));

    expect(guide?.title).toBe("PHP IDE Engine Setup");
    expect(guide?.commands.map((command) => command.id)).toEqual([
      "managed-install",
      "managed-verify",
    ]);
    expect(guide?.commands[0]?.command).toContain(
      "Application Support/Codevo Editor/tools/phpactor",
    );
    expect(guide?.commands[0]?.command).toContain(
      "composer init --name codevo/editor-php-engine",
    );
  });

  it("returns blocked guidance without install commands", () => {
    const guide = createPhpactorSetupGuide(plan("blocked"));

    expect(guide?.title).toBe("PHP IDE Engine Blocked");
    expect(guide?.commands).toEqual([]);
  });

  it("does not create guidance for ready plans", () => {
    expect(createPhpactorSetupGuide(plan("ready"))).toBeNull();
  });
});

function plan(status: LanguageServerPlan["status"]): LanguageServerPlan {
  return {
    command: null,
    initializeRequest: null,
    message: "PHPactor was not found.",
    provider: "phpactor",
    status,
  };
}
