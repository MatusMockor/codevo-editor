import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchArtisanCommands } from "./workbenchArtisanCommands";

const workspaceContext: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: false,
  activeDocumentDirty: false,
};

describe("workbenchArtisanCommands", () => {
  it("includes an interactive tinker command when artisan is present", () => {
    const runInActiveTerminal = vi.fn();
    const commands = workbenchArtisanCommands({
      hasArtisan: true,
      openRoutesPanel: vi.fn(),
      runInActiveTerminal,
    });
    const tinkerCommand = commands.find(
      (command) => command.id === "artisan.tinker",
    );

    expect(tinkerCommand).toMatchObject({
      id: "artisan.tinker",
      category: "Artisan",
    });

    tinkerCommand?.run();

    expect(runInActiveTerminal).toHaveBeenCalledExactlyOnceWith(
      "php artisan tinker",
    );
    expect(runInActiveTerminal).not.toHaveBeenCalledWith(
      expect.stringContaining("--no-interaction"),
    );
  });

  it("omits the tinker command when artisan is not present", () => {
    const commands = workbenchArtisanCommands({
      hasArtisan: false,
      openRoutesPanel: vi.fn(),
      runInActiveTerminal: vi.fn(),
    });

    expect(commands.some((command) => command.id === "artisan.tinker")).toBe(
      false,
    );
  });

  it("generates the curated Artisan commands only when artisan is present", () => {
    expect(
      workbenchArtisanCommands({
        hasArtisan: false,
        openRoutesPanel: vi.fn(),
        runInActiveTerminal: vi.fn(),
      }),
    ).toEqual([]);

    const commands = workbenchArtisanCommands({
      hasArtisan: true,
      openRoutesPanel: vi.fn(),
      runInActiveTerminal: vi.fn(),
    });

    expect(
      commands
        .filter(({ id }) =>
          !["artisan.tinker", "artisan.route:list.terminal"].includes(id),
        )
        .map(({ id, title, category }) => ({ id, title, category })),
    ).toEqual([
      { id: "artisan.about", title: "artisan: about", category: "Artisan" },
      {
        id: "artisan.route:list",
        title: "artisan: route:list",
        category: "Artisan",
      },
      {
        id: "artisan.migrate:status",
        title: "artisan: migrate:status",
        category: "Artisan",
      },
      {
        id: "artisan.config:show",
        title: "artisan: config:show",
        category: "Artisan",
      },
      {
        id: "artisan.db:show",
        title: "artisan: db:show",
        category: "Artisan",
      },
      {
        id: "artisan.queue:failed",
        title: "artisan: queue:failed",
        category: "Artisan",
      },
      {
        id: "artisan.optimize:clear",
        title: "artisan: optimize:clear",
        category: "Artisan",
      },
      {
        id: "artisan.cache:clear",
        title: "artisan: cache:clear",
        category: "Artisan",
      },
    ]);
  });

  it("runs exact static commands and gates them on a workspace", () => {
    const runInActiveTerminal = vi.fn();
    const commands = workbenchArtisanCommands({
      hasArtisan: true,
      openRoutesPanel: vi.fn(),
      runInActiveTerminal,
    });

    commands
      .filter(({ id }) =>
        !["artisan.tinker", "artisan.route:list"].includes(id),
      )
      .forEach((command) => command.run());

    expect(runInActiveTerminal.mock.calls.map(([command]) => command)).toEqual([
      "php artisan about --no-interaction",
      "php artisan migrate:status --no-interaction",
      "php artisan config:show --no-interaction",
      "php artisan db:show --no-interaction",
      "php artisan queue:failed --no-interaction",
      "php artisan optimize:clear --no-interaction",
      "php artisan cache:clear --no-interaction",
      "php artisan route:list --no-interaction",
    ]);
    expect(commands.every((command) => command.isEnabled(workspaceContext))).toBe(
      true,
    );
    expect(
      commands.every((command) =>
        command.isEnabled({ ...workspaceContext, hasWorkspace: false }),
      ),
    ).toBe(false);
  });

  it("opens the structured route panel from artisan.route:list", () => {
    const openRoutesPanel = vi.fn();
    const runInActiveTerminal = vi.fn();
    const commands = workbenchArtisanCommands({
      hasArtisan: true,
      openRoutesPanel,
      runInActiveTerminal,
    });

    commands.find(({ id }) => id === "artisan.route:list")?.run();

    expect(openRoutesPanel).toHaveBeenCalledOnce();
    expect(runInActiveTerminal).not.toHaveBeenCalled();
  });
});
