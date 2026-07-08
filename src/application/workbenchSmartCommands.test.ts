import { describe, expect, it, vi } from "vitest";
import type { LanguageServerPlan } from "../domain/languageServer";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type {
  IntelligenceMode,
  PhpToolAvailability,
  WorkspaceDescriptor,
} from "../domain/workspace";
import type { CommandContext } from "./commandRegistry";
import { workbenchSmartCommands } from "./workbenchSmartCommands";

const disabledContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

const enabledContext: CommandContext = {
  activeDocumentDirty: true,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchSmartCommands", () => {
  it("returns smart commands in registry order with metadata", () => {
    const commands = commandsFor();

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "smart.toggle",
        title: "Toggle IDE Mode",
        category: "Intelligence",
        shortcut: undefined,
      },
      {
        id: "smart.phpactorSetup",
        title: "Show PHPactor Setup",
        category: "Intelligence",
        shortcut: undefined,
      },
      {
        id: "smart.installManagedPhpactor",
        title: "Install Managed PHP IDE Engine",
        category: "Intelligence",
        shortcut: undefined,
      },
      {
        id: "smart.startLanguageServer",
        title: "Start PHP Language Server",
        category: "Intelligence",
        shortcut: undefined,
      },
      {
        id: "smart.stopLanguageServer",
        title: "Stop PHP Language Server",
        category: "Intelligence",
        shortcut: undefined,
      },
    ]);
  });

  it("enables smart.toggle only with a workspace", () => {
    const toggle = command("smart.toggle", commandsFor());

    expect(toggle.isEnabled(disabledContext)).toBe(false);
    expect(toggle.isEnabled(enabledContext)).toBe(true);
  });

  it("enables smart.phpactorSetup only when the plan has a setup guide", () => {
    expect(
      command(
        "smart.phpactorSetup",
        commandsFor({ languageServerPlan: null }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.phpactorSetup",
        commandsFor({ languageServerPlan: plan({ status: "ready" }) }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.phpactorSetup",
        commandsFor({
          languageServerPlan: plan({
            provider: "intelephense",
            status: "unavailable",
          }),
        }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.phpactorSetup",
        commandsFor({ languageServerPlan: plan({ status: "blocked" }) }),
      ).isEnabled(enabledContext),
    ).toBe(true);
    expect(
      command(
        "smart.phpactorSetup",
        commandsFor({ languageServerPlan: plan({ status: "unavailable" }) }),
      ).isEnabled(enabledContext),
    ).toBe(true);
  });

  it("enables smart.installManagedPhpactor only for a PHP workspace missing PHPactor while not installing", () => {
    expect(
      command("smart.installManagedPhpactor", commandsFor()).isEnabled(
        enabledContext,
      ),
    ).toBe(true);
    expect(
      command(
        "smart.installManagedPhpactor",
        commandsFor({ workspaceRoot: null }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.installManagedPhpactor",
        commandsFor({ workspaceDescriptor: workspaceDescriptor({ php: null }) }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.installManagedPhpactor",
        commandsFor({ phpTools: phpTools({ phpactor: true }) }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.installManagedPhpactor",
        commandsFor({ phpTools: null }),
      ).isEnabled(enabledContext),
    ).toBe(true);
    expect(
      command(
        "smart.installManagedPhpactor",
        commandsFor({ installingManagedPhpactor: true }),
      ).isEnabled(enabledContext),
    ).toBe(false);
  });

  it("enables smart.startLanguageServer only for full smart ready plans with no active server", () => {
    expect(
      command("smart.startLanguageServer", commandsFor()).isEnabled(
        enabledContext,
      ),
    ).toBe(true);

    for (const intelligenceMode of [
      "basic",
      "lightSmart",
    ] satisfies IntelligenceMode[]) {
      expect(
        command(
          "smart.startLanguageServer",
          commandsFor({ intelligenceMode }),
        ).isEnabled(enabledContext),
      ).toBe(false);
    }

    expect(
      command(
        "smart.startLanguageServer",
        commandsFor({ languageServerPlan: null }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.startLanguageServer",
        commandsFor({ languageServerPlan: plan({ status: "blocked" }) }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.startLanguageServer",
        commandsFor({ isLanguageServerActiveForWorkspace: () => true }),
      ).isEnabled(enabledContext),
    ).toBe(false);
  });

  it("uses the injected active predicate for start and stop language server commands", () => {
    const status = languageServerStatus();
    const isLanguageServerActiveForWorkspace = vi.fn(() => false);
    const commands = commandsFor({
      languageServerRuntimeStatus: status,
      languageServerRuntimeStatusRoot: "/workspace",
      workspaceRoot: "/workspace",
      isLanguageServerActiveForWorkspace,
    });

    command("smart.startLanguageServer", commands).isEnabled(enabledContext);
    command("smart.stopLanguageServer", commands).isEnabled(enabledContext);

    expect(isLanguageServerActiveForWorkspace).toHaveBeenNthCalledWith(
      1,
      status,
      "/workspace",
      "/workspace",
    );
    expect(isLanguageServerActiveForWorkspace).toHaveBeenNthCalledWith(
      2,
      status,
      "/workspace",
      "/workspace",
    );
  });

  it("enables smart.stopLanguageServer only when the active predicate is true", () => {
    expect(
      command(
        "smart.stopLanguageServer",
        commandsFor({ isLanguageServerActiveForWorkspace: () => false }),
      ).isEnabled(enabledContext),
    ).toBe(false);
    expect(
      command(
        "smart.stopLanguageServer",
        commandsFor({ isLanguageServerActiveForWorkspace: () => true }),
      ).isEnabled(enabledContext),
    ).toBe(true);
  });

  it("invokes the exact injected callbacks", async () => {
    const toggleSmartMode = vi.fn();
    const showPhpactorSetup = vi.fn();
    const installManagedPhpactor = vi.fn();
    const startLanguageServer = vi.fn();
    const stopLanguageServer = vi.fn();
    const commands = commandsFor({
      toggleSmartMode,
      showPhpactorSetup,
      installManagedPhpactor,
      startLanguageServer,
      stopLanguageServer,
    });

    expect(command("smart.toggle", commands).run).toBe(toggleSmartMode);
    expect(command("smart.phpactorSetup", commands).run).toBe(showPhpactorSetup);
    expect(command("smart.installManagedPhpactor", commands).run).toBe(
      installManagedPhpactor,
    );
    expect(command("smart.startLanguageServer", commands).run).toBe(
      startLanguageServer,
    );
    expect(command("smart.stopLanguageServer", commands).run).toBe(
      stopLanguageServer,
    );

    await command("smart.toggle", commands).run();
    await command("smart.phpactorSetup", commands).run();
    await command("smart.installManagedPhpactor", commands).run();
    await command("smart.startLanguageServer", commands).run();
    await command("smart.stopLanguageServer", commands).run();

    expect(toggleSmartMode).toHaveBeenCalledTimes(1);
    expect(showPhpactorSetup).toHaveBeenCalledTimes(1);
    expect(installManagedPhpactor).toHaveBeenCalledTimes(1);
    expect(startLanguageServer).toHaveBeenCalledTimes(1);
    expect(stopLanguageServer).toHaveBeenCalledTimes(1);
  });
});

type WorkbenchSmartCommandsOptions = Parameters<typeof workbenchSmartCommands>[0];

function commandsFor(
  overrides: Partial<WorkbenchSmartCommandsOptions> = {},
) {
  return workbenchSmartCommands({
    intelligenceMode: "fullSmart",
    languageServerPlan: plan({ status: "ready" }),
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    workspaceDescriptor: workspaceDescriptor(),
    workspaceRoot: "/workspace",
    phpTools: phpTools({ phpactor: false }),
    installingManagedPhpactor: false,
    isLanguageServerActiveForWorkspace: () => false,
    toggleSmartMode: vi.fn(),
    showPhpactorSetup: vi.fn(),
    installManagedPhpactor: vi.fn(),
    startLanguageServer: vi.fn(),
    stopLanguageServer: vi.fn(),
    ...overrides,
  });
}

function command(id: string, commands: ReturnType<typeof commandsFor>) {
  const found = commands.find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error(`Missing command ${id}`);
  }

  return found;
}

function plan(overrides: Partial<LanguageServerPlan> = {}): LanguageServerPlan {
  return {
    provider: "phpactor",
    status: "ready",
    message: "Ready",
    command: null,
    initializeRequest: null,
    ...overrides,
  };
}

function workspaceDescriptor(
  overrides: Partial<WorkspaceDescriptor> = {},
): WorkspaceDescriptor {
  return {
    rootPath: "/workspace",
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: "acme/app",
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    javaScriptTypeScript: null,
    ...overrides,
  };
}

function phpTools({ phpactor }: { phpactor: boolean }): PhpToolAvailability {
  return {
    phpactor: phpactor
      ? {
          executable: "phpactor",
          path: "/workspace/vendor/bin/phpactor",
          source: "workspaceVendorBin",
        }
      : null,
    intelephense: null,
  };
}

function languageServerStatus(): LanguageServerRuntimeStatus {
  return {
    kind: "stopped",
    rootPath: "/workspace",
  };
}
