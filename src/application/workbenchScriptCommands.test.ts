import { describe, expect, it, vi } from "vitest";
import { workbenchScriptCommands } from "./workbenchScriptCommands";

describe("workbenchScriptCommands", () => {
  it("generates ordered Composer commands with palette labels", () => {
    const commands = workbenchScriptCommands({
      composerScripts: [
        { name: "test", command: "phpunit" },
        { name: "quality:all", command: ["phpstan", "php-cs-fixer"] },
      ],
      runInActiveTerminal: vi.fn(),
    });

    expect(commands.map(({ id, title, category }) => ({ id, title, category }))).toEqual([
      {
        id: "script.composer.test",
        title: "composer: test",
        category: "Scripts",
      },
      {
        id: "script.composer.quality:all",
        title: "composer: quality:all",
        category: "Scripts",
      },
    ]);
  });

  it("runs exact by-name commands without using manifest bodies", () => {
    const runInActiveTerminal = vi.fn();
    const commands = workbenchScriptCommands({
      composerScripts: [{ name: "test", command: "touch should-not-run" }],
      runInActiveTerminal,
    });

    commands[0].run();

    expect(runInActiveTerminal).toHaveBeenNthCalledWith(1, "composer run-script test");
  });

  it("keeps composer commands unaffected by the node package manager", () => {
    const runInActiveTerminal = vi.fn();
    const commands = workbenchScriptCommands({
      composerScripts: [{ name: "test", command: "phpunit" }],
      runInActiveTerminal,
    });

    expect(commands.map((command) => command.title)).toEqual(["composer: test"]);

    commands[0].run();

    expect(runInActiveTerminal).toHaveBeenCalledWith("composer run-script test");
  });

  it("defensively excludes invalid names", () => {
    const commands = workbenchScriptCommands({
      composerScripts: [
        { name: "test; whoami", command: "phpunit" },
        { name: "safe", command: "phpunit" },
      ],
      runInActiveTerminal: vi.fn(),
    });

    expect(commands.map((command) => command.id)).toEqual(["script.composer.safe"]);
  });

  it("returns no commands for empty manifests", () => {
    expect(
      workbenchScriptCommands({
        composerScripts: [],
        runInActiveTerminal: vi.fn(),
      }),
    ).toEqual([]);
  });
});
