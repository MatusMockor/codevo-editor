import type {
  PaletteProject,
  PaletteScript,
} from "../../application/commandPalette/commandPaletteProvider";
import type { NodePackageScript } from "../../domain/nodePackageScripts";

export function agentPaletteProjects(
  tabs: readonly string[],
  root: string | null,
): readonly PaletteProject[] {
  return tabs.map((path) => ({ key: path, label: folderName(path), path, current: path === root }));
}

export function agentPaletteScripts(
  scripts: readonly NodePackageScript[],
  commandEnabled: (commandId: string) => boolean,
): readonly PaletteScript[] {
  return scripts.map((script) => ({
    key: script.key,
    name: script.scriptName,
    detail: scriptDetail(script),
    runnable: commandEnabled(`script.node.${script.key}`),
  }));
}

function scriptDetail(script: NodePackageScript): string {
  const command = `${script.packageManager} run ${script.scriptName}`;
  if (script.packageRootRelativePath === "") return command;
  return `${command} · ${script.packageRootRelativePath}`;
}

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return (
    trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed
  );
}
