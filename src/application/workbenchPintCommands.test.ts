import { describe, expect, it, vi } from "vitest";
import { workbenchPintCommands } from "./workbenchPintCommands";

const context = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    hasPhpWorkspace: true,
    isRunning: false,
    isWorkspaceTrusted: true,
    hasActivePhpDocument: true,
    formatChangedFiles: vi.fn(),
    formatActiveFile: vi.fn(),
    ...overrides,
  };
}

describe("workbenchPintCommands", () => {
  it("registers both manual palette commands", () => {
    const commands = workbenchPintCommands(options());

    expect(commands.map(({ id, title }) => ({ id, title }))).toEqual([
      {
        id: "pint.formatChangedFiles",
        title: "Pint: Format Changed Files",
      },
      { id: "pint.formatActiveFile", title: "Pint: Format Active File" },
    ]);
  });

  it.each([
    ["without a workspace", {}, { ...context, hasWorkspace: false }],
    ["outside a PHP workspace", { hasPhpWorkspace: false }, context],
    ["while untrusted", { isWorkspaceTrusted: false }, context],
    ["while Pint is running", { isRunning: true }, context],
  ])("disables both commands %s", (_label, overrides, commandContext) => {
    const commands = workbenchPintCommands(options(overrides));

    expect(commands.every((command) => !command.isEnabled(commandContext))).toBe(true);
  });

  it.each([
    ["without an active document", {}, { ...context, hasActiveDocument: false }],
    ["for a non-PHP document", { hasActivePhpDocument: false }, context],
  ])("disables only active-file formatting %s", (_label, overrides, commandContext) => {
    const [changed, active] = workbenchPintCommands(options(overrides));

    expect(changed.isEnabled(commandContext)).toBe(true);
    expect(active.isEnabled(commandContext)).toBe(false);
  });

  it("delegates both commands", () => {
    const formatChangedFiles = vi.fn();
    const formatActiveFile = vi.fn();
    const [changed, active] = workbenchPintCommands(
      options({ formatChangedFiles, formatActiveFile }),
    );

    changed.run();
    active.run();

    expect(formatChangedFiles).toHaveBeenCalledOnce();
    expect(formatActiveFile).toHaveBeenCalledOnce();
  });
});
