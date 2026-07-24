import { nodePackageScriptIdentity, type NodePackageScript } from "./nodePackageScripts";
import type { NpmRunSelectedScriptIdentity } from "./npmOpenScriptLocation";

export const npmRunSelectedScriptCommandId = "npm.runSelectedScript" as const;
export const npmRunSelectedScriptTitle = "Run Script" as const;

/** Returns one canonical discovery result, never the caller-owned selection object. */
export function exactDiscoveredNodePackageScript(
  scripts: readonly NodePackageScript[],
  selected: NpmRunSelectedScriptIdentity,
): NodePackageScript | null {
  const matches = scripts.filter(
    (script) =>
      script.manifestRelativePath === selected.manifestRelativePath &&
      script.scriptName === selected.scriptName &&
      script.key === nodePackageScriptIdentity(script) &&
      script.manifestRelativePath ===
        (script.packageRootRelativePath
          ? `${script.packageRootRelativePath}/package.json`
          : "package.json"),
  );
  return matches.length === 1 ? matches[0]! : null;
}
