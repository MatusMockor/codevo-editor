import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseFrontendTauriCommandReferences,
  parseRegisteredTauriCommands,
  type FrontendTauriCommandReference,
} from "./tauriIpcContractArchitecture";

const PROJECT_ROOT = process.cwd();
const FRONTEND_ROOT = join(PROJECT_ROOT, "src");
const RUST_HANDLER_REGISTRY = join(
  PROJECT_ROOT,
  "src-tauri",
  "src",
  "lib_composition",
  "runtime.rs",
);

describe("Tauri IPC contract architecture (static command literals and named maps only)", () => {
  it("keeps statically declared frontend commands registered in generate_handler", () => {
    const registered = new Set(
      parseRegisteredTauriCommands(readFileSync(RUST_HANDLER_REGISTRY, "utf8")),
    );
    const references = sourceFiles(FRONTEND_ROOT).flatMap((fileName) =>
      parseFrontendTauriCommandReferences(
        readFileSync(fileName, "utf8"),
        relative(PROJECT_ROOT, fileName),
      ).map((reference) => ({ fileName, reference })),
    );
    const missing = references
      .filter(({ reference }) => !registered.has(reference.command))
      .map(formatMissingReference)
      .sort();

    expect(missing).toEqual([]);
  }, 15_000);

  it("exposes package-script execution only through the typed task registry", () => {
    const registered = new Set(
      parseRegisteredTauriCommands(readFileSync(RUST_HANDLER_REGISTRY, "utf8")),
    );

    expect(registered).toContain("workspace_start_node_package_task");
    expect(registered).toContain("workspace_stop_node_package_task");
    expect(registered).not.toContain("workspace_run_node_package_script_in_terminal");
  });

  it("parses module-qualified Rust handlers and rejects unsupported entries", () => {
    expect(
      parseRegisteredTauriCommands("tauri::generate_handler![open_file, debug::start_session,]"),
    ).toEqual(["open_file", "start_session"]);
    expect(() => parseRegisteredTauriCommands("tauri::generate_handler![make_handler()]")).toThrow(
      "Unsupported generate_handler entry",
    );
  });

  it("ignores unrelated literals while recognizing supported frontend shapes", () => {
    const references = parseFrontendTauriCommandReferences(
      `
        const COMMANDS = { kind: "tsserver", open: "open_workspace" };
        const EVENTS = { open: "workspace_opened" };
        invoke("save_workspace", {});
        this.invokeDebugCommand("debug_start", {});
        invokeDebugIpc(transport, "debug_stop", { sessionId: 1 });
        runCommand("editor_action", {});
      `,
      "fixture.ts",
    );

    expect(references.map(({ command }) => command)).toEqual([
      "open_workspace",
      "save_workspace",
      "debug_start",
      "debug_stop",
    ]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

function formatMissingReference({
  fileName,
  reference,
}: {
  readonly fileName: string;
  readonly reference: FrontendTauriCommandReference;
}): string {
  return `${relative(PROJECT_ROOT, fileName)}:${reference.line} ${reference.command} (${reference.source})`;
}
