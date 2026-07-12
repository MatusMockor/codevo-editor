import { describe, expect, it, vi } from "vitest";
import { workbenchPhpstanCommands } from "./workbenchPhpstanCommands";

const context = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    hasPhpWorkspace: true,
    isRunning: false,
    runPhpstanAnalysis: vi.fn(),
    hasDiagnosticAtCursor: true,
    isActiveBufferClean: true,
    isWorkspaceTrusted: true,
    ignoreIssueAtCursor: vi.fn(),
    ...overrides,
  };
}

describe("workbenchPhpstanCommands", () => {
  it("registers the workspace analysis command only for a PHP-capable workspace", () => {
    const [command] = workbenchPhpstanCommands(options());

    expect(command).toMatchObject({
      id: "phpstan.analyseWorkspace",
      title: "PHPStan: Analyse Workspace",
      category: "PHP",
    });
    expect(command.isEnabled(context)).toBe(true);
    expect(
      workbenchPhpstanCommands(options({ hasPhpWorkspace: false }))[0]
        .isEnabled(context),
    ).toBe(false);
  });

  it("disables while analysis is in flight and delegates run", () => {
    const runPhpstanAnalysis = vi.fn();
    const [runningCommand] = workbenchPhpstanCommands(
      options({ isRunning: true, runPhpstanAnalysis }),
    );

    expect(runningCommand.isEnabled(context)).toBe(false);
    runningCommand.run();
    expect(runPhpstanAnalysis).toHaveBeenCalledOnce();
  });

  it.each([
    ["an untrusted workspace", { isWorkspaceTrusted: false }],
    ["a dirty buffer", { isActiveBufferClean: false }],
    [
      "no identified diagnostic on the cursor line",
      { hasDiagnosticAtCursor: false },
    ],
  ])("disables ignore for %s", (_label, overrides) => {
    expect(
      workbenchPhpstanCommands(options(overrides))[1].isEnabled(context),
    ).toBe(false);
  });

  it("enables and delegates ignore when every gate passes", () => {
    const ignoreIssueAtCursor = vi.fn();
    const command = workbenchPhpstanCommands(
      options({ ignoreIssueAtCursor }),
    )[1];

    expect(command).toMatchObject({
      id: "phpstan.ignoreIssueAtCursor",
      title: "PHPStan: Ignore Issue at Cursor",
    });
    expect(command.isEnabled(context)).toBe(true);
    command.run();
    expect(ignoreIssueAtCursor).toHaveBeenCalledOnce();
  });
});
