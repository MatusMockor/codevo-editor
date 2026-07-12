import { describe, expect, it, vi } from "vitest";
import { workbenchPhpstanCommands } from "./workbenchPhpstanCommands";

const context = {
  hasWorkspace: true,
  hasActiveDocument: false,
  activeDocumentDirty: false,
};

describe("workbenchPhpstanCommands", () => {
  it("registers the workspace analysis command only for a PHP-capable workspace", () => {
    const [command] = workbenchPhpstanCommands({
      hasPhpWorkspace: true,
      isRunning: false,
      runPhpstanAnalysis: vi.fn(),
    });

    expect(command).toMatchObject({
      id: "phpstan.analyseWorkspace",
      title: "PHPStan: Analyse Workspace",
      category: "PHP",
    });
    expect(command.isEnabled(context)).toBe(true);
    expect(
      workbenchPhpstanCommands({
        hasPhpWorkspace: false,
        isRunning: false,
        runPhpstanAnalysis: vi.fn(),
      })[0].isEnabled(context),
    ).toBe(false);
  });

  it("disables while analysis is in flight and delegates run", () => {
    const runPhpstanAnalysis = vi.fn();
    const [runningCommand] = workbenchPhpstanCommands({
      hasPhpWorkspace: true,
      isRunning: true,
      runPhpstanAnalysis,
    });

    expect(runningCommand.isEnabled(context)).toBe(false);
    runningCommand.run();
    expect(runPhpstanAnalysis).toHaveBeenCalledOnce();
  });
});
