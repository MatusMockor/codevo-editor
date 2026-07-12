import { describe, expect, it, vi } from "vitest";
import { workbenchEslintCommands } from "./workbenchEslintCommands";

const context = {
  hasWorkspace: true,
  hasActiveDocument: false,
  activeDocumentDirty: false,
};

describe("workbenchEslintCommands", () => {
  it("registers only for a workspace with package.json", () => {
    const [command] = workbenchEslintCommands({
      hasPackageJson: true,
      isRunning: false,
      runEslintAnalysis: vi.fn(),
    });

    expect(command).toMatchObject({
      id: "eslint.analyseWorkspace",
      title: "ESLint: Analyse Workspace",
      category: "JavaScript",
    });
    expect(command.isEnabled(context)).toBe(true);
    expect(
      workbenchEslintCommands({
        hasPackageJson: false,
        isRunning: false,
        runEslintAnalysis: vi.fn(),
      })[0].isEnabled(context),
    ).toBe(false);
  });

  it("disables while running and delegates", () => {
    const runEslintAnalysis = vi.fn();
    const [command] = workbenchEslintCommands({
      hasPackageJson: true,
      isRunning: true,
      runEslintAnalysis,
    });
    expect(command.isEnabled(context)).toBe(false);
    command.run();
    expect(runEslintAnalysis).toHaveBeenCalledOnce();
  });
});
