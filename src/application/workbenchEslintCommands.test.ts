import { describe, expect, it, vi } from "vitest";
import { workbenchEslintCommands } from "./workbenchEslintCommands";

const context = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    hasPackageJson: true,
    isRunning: false,
    runEslintAnalysis: vi.fn(),
    hasFixesForActiveFile: true,
    isActiveBufferClean: true,
    isWorkspaceTrusted: true,
    fixAllInActiveFile: vi.fn(),
    hasDiagnosticAtCursor: true,
    disableRuleAtCursor: vi.fn(),
    ...overrides,
  };
}

describe("workbenchEslintCommands", () => {
  it("registers only for a workspace with package.json", () => {
    const [command] = workbenchEslintCommands(options());

    expect(command).toMatchObject({
      id: "eslint.analyseWorkspace",
      title: "ESLint: Analyse Workspace",
      category: "JavaScript",
    });
    expect(command.isEnabled(context)).toBe(true);
    expect(
      workbenchEslintCommands({
        ...options(),
        hasPackageJson: false,
      })[0].isEnabled(context),
    ).toBe(false);
  });

  it("disables while running and delegates", () => {
    const runEslintAnalysis = vi.fn();
    const [command] = workbenchEslintCommands(options({ isRunning: true, runEslintAnalysis }));
    expect(command.isEnabled(context)).toBe(false);
    command.run();
    expect(runEslintAnalysis).toHaveBeenCalledOnce();
  });

  it.each([
    ["a dirty buffer", { isActiveBufferClean: false }],
    ["no available fixes", { hasFixesForActiveFile: false }],
    ["an untrusted workspace", { isWorkspaceTrusted: false }],
  ])("disables fix all for %s", (_label, overrides) => {
    const fix = workbenchEslintCommands(options(overrides))[1];

    expect(fix.isEnabled(context)).toBe(false);
  });

  it("enables and delegates fix all when every gate passes", () => {
    const fixAllInActiveFile = vi.fn();
    const fix = workbenchEslintCommands(options({ fixAllInActiveFile }))[1];

    expect(fix).toMatchObject({
      id: "eslint.fixAllInActiveFile",
      title: "ESLint: Fix All in Active File",
    });
    expect(fix.isEnabled(context)).toBe(true);
    fix.run();
    expect(fixAllInActiveFile).toHaveBeenCalledOnce();
  });

  it.each([
    ["a dirty buffer", { isActiveBufferClean: false }],
    ["no diagnostic at the cursor", { hasDiagnosticAtCursor: false }],
    ["an untrusted workspace", { isWorkspaceTrusted: false }],
  ])("disables disable-rule for %s", (_label, overrides) => {
    const command = workbenchEslintCommands(options(overrides))[2];

    expect(command.isEnabled(context)).toBe(false);
  });

  it("enables and delegates disable-rule when every gate passes", () => {
    const disableRuleAtCursor = vi.fn();
    const command = workbenchEslintCommands(options({ disableRuleAtCursor }))[2];

    expect(command).toMatchObject({
      id: "eslint.disableRuleAtCursor",
      title: "ESLint: Disable Rule at Cursor",
    });
    expect(command.isEnabled(context)).toBe(true);
    command.run();
    expect(disableRuleAtCursor).toHaveBeenCalledOnce();
  });
});
