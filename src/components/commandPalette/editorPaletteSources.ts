import type {
  PaletteBranchSource,
  PaletteProject,
  PaletteScript,
} from "../../application/commandPalette/commandPaletteProvider";
import type { GitGateway } from "../../domain/git";
import type { NodePackageScript } from "../../domain/nodePackageScripts";

export function editorPaletteProjects(
  tabs: readonly string[],
  root: string | null,
): readonly PaletteProject[] {
  return tabs.map((path) => ({ key: path, label: folderName(path), path, current: path === root }));
}

export function editorPaletteScripts(
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

export type EditorBranchListing = Pick<GitGateway, "branchList" | "remoteBranchList">;

export interface EditorBranchPorts {
  readonly root: string;
  readonly listing: EditorBranchListing;
  switchGitBranch(name: string): Promise<void>;
  checkoutRemoteBranch(name: string): Promise<void>;
}

export function editorBranchSource(ports: EditorBranchPorts): PaletteBranchSource {
  return {
    scopeKey: ports.root,
    scopeLabel: folderName(ports.root),
    async load() {
      const { listing, root } = ports;
      const [local, remote] = await Promise.all([
        listing.branchList(root),
        listing.remoteBranchList?.(root) ?? Promise.resolve([]),
      ]);
      return [
        ...local.map((branch) => ({ name: branch.name, current: branch.isCurrent, remote: false })),
        ...remote.map((branch) => ({ name: branch.name, current: false, remote: true })),
      ];
    },
    async switchTo(branch) {
      if (branch.remote) {
        await ports.checkoutRemoteBranch(branch.name);
        return;
      }
      await ports.switchGitBranch(branch.name);
    },
  };
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
