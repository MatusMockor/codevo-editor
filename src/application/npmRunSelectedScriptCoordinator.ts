import type { NodePackageScript } from "../domain/nodePackageScripts";
import { npmRunSelectedScriptAt } from "../domain/npmOpenScriptLocation";
import { exactDiscoveredNodePackageScript } from "../domain/npmRunSelectedScript";
import { joinWorkspacePath } from "../domain/workspace";
import { isWellFormedUnicode } from "../domain/unicodeText";
import {
  parseWorkspacePath,
  type WorkspacePathKey,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";

export const npmRunSelectedScriptInvalidSelectionMessage =
  "Could not find a valid npm script at the selection.";

export interface NpmRunSelectedScriptOwner {
  readonly activationEpoch: number;
  readonly ownerKey: string;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface NpmRunSelectedScriptEditorCapture extends NpmRunSelectedScriptOwner {
  readonly anchorOffset: number;
  readonly content: string;
  readonly documentPath: string;
  readonly modelIdentity: object;
  readonly modelVersion: number;
}

export interface NpmRunSelectedScriptAuthority extends NpmRunSelectedScriptOwner {
  /** Monotonic across every authority/trust/root/editor-port replacement, including A→B→A. */
  readonly authorityGeneration: number;
  /** Monotonic for every package-script discovery snapshot replacement. */
  readonly discoveryGeneration: number;
  readonly editor: NpmRunSelectedScriptEditorCapture | null;
  readonly executionAvailable: boolean;
  readonly scripts: readonly NodePackageScript[];
  readonly trusted: boolean;
  readonly workspaceRoots: readonly WorkspaceRootDescriptor[];
}

export interface NpmRunSelectedScriptTaskLifecycle {
  isActive(): boolean;
  run(script: NodePackageScript): void;
}

export interface NpmRunSelectedScriptCoordinator {
  runSelectedScript(): boolean;
}

interface ScriptSnapshot {
  readonly key: string;
  readonly manifestRelativePath: string;
  readonly original: NodePackageScript;
  readonly packageRootRelativePath: string;
  readonly scriptName: string;
}

interface AuthoritySnapshot extends NpmRunSelectedScriptOwner {
  readonly authorityGeneration: number;
  readonly discoveryGeneration: number;
  readonly editor: NpmRunSelectedScriptEditorCapture;
  readonly executionAvailable: boolean;
  readonly roots: readonly WorkspaceRootDescriptor[];
  readonly scripts: readonly ScriptSnapshot[];
  readonly trusted: boolean;
}

/** Atomic editor-context adapter for the existing typed package-task lifecycle. */
export function createNpmRunSelectedScriptCoordinator(
  readAuthority: () => NpmRunSelectedScriptAuthority | null,
  lifecycle: NpmRunSelectedScriptTaskLifecycle,
  reportError: (error: Error) => void,
): NpmRunSelectedScriptCoordinator {
  let inFlight = false;
  return {
    runSelectedScript(): boolean {
      if (inFlight) return false;
      inFlight = true;
      try {
        const captured = snapshotAuthority(readAuthority());
        if (!eligible(captured, lifecycle)) return false;
        const manifest = localManifest(captured);
        if (!manifest) return false;
        const selected = npmRunSelectedScriptAt({
          anchorOffset: captured.editor.anchorOffset,
          manifestContent: captured.editor.content,
          manifestRelativePath: manifest.relativePath,
        });
        if (!selected) {
          reportError(new Error(npmRunSelectedScriptInvalidSelectionMessage));
          return false;
        }
        const canonical = exactCurrentDiscoveryScript(captured, manifest.key, selected.scriptName);
        if (!canonical) return false;

        const current = snapshotAuthority(readAuthority());
        const currentCanonical = current
          ? exactCurrentDiscoveryScript(current, manifest.key, selected.scriptName)
          : null;
        if (
          !eligible(current, lifecycle) ||
          !sameAuthority(current, captured) ||
          !sameEditorCapture(current.editor, captured.editor) ||
          localManifest(current)?.key !== manifest.key ||
          !currentCanonical ||
          !sameCanonicalScript(currentCanonical, canonical)
        ) {
          return false;
        }
        lifecycle.run(currentCanonical);
        return lifecycle.isActive();
      } catch {
        return false;
      } finally {
        inFlight = false;
      }
    },
  };
}

function snapshotAuthority(value: NpmRunSelectedScriptAuthority | null): AuthoritySnapshot | null {
  if (!value?.editor) return null;
  const editor = value.editor;
  return {
    activationEpoch: value.activationEpoch,
    authorityGeneration: value.authorityGeneration,
    discoveryGeneration: value.discoveryGeneration,
    editor: {
      activationEpoch: editor.activationEpoch,
      anchorOffset: editor.anchorOffset,
      content: editor.content,
      documentPath: editor.documentPath,
      modelIdentity: editor.modelIdentity,
      modelVersion: editor.modelVersion,
      ownerKey: editor.ownerKey,
      rootPath: editor.rootPath,
      workspaceId: editor.workspaceId,
    },
    executionAvailable: value.executionAvailable,
    ownerKey: value.ownerKey,
    rootPath: value.rootPath,
    roots: value.workspaceRoots.map((root) => ({ ...root, policy: { ...root.policy } })),
    scripts: value.scripts.map((script) => ({
      key: script.key,
      manifestRelativePath: script.manifestRelativePath,
      original: script,
      packageRootRelativePath: script.packageRootRelativePath,
      scriptName: script.scriptName,
    })),
    trusted: value.trusted,
    workspaceId: value.workspaceId,
  };
}

function eligible(
  authority: AuthoritySnapshot | null,
  lifecycle: NpmRunSelectedScriptTaskLifecycle,
): authority is AuthoritySnapshot {
  return Boolean(
    authority?.trusted &&
    authority.executionAvailable &&
    validOwner(authority) &&
    validGeneration(authority.authorityGeneration) &&
    validGeneration(authority.discoveryGeneration) &&
    sameOwner(authority, authority.editor) &&
    validEditor(authority.editor) &&
    !lifecycle.isActive(),
  );
}

function validOwner(owner: AuthoritySnapshot): boolean {
  if (
    !safeOwnerString(owner.ownerKey) ||
    !safeOwnerString(owner.rootPath) ||
    !safeOwnerString(owner.workspaceId) ||
    !validGeneration(owner.activationEpoch) ||
    owner.roots.length === 0 ||
    owner.roots.some((root) => root.workspaceId !== owner.workspaceId) ||
    new Set(owner.roots.map((root) => `${root.nativePath}\0${root.fileUri}`)).size !==
      owner.roots.length
  ) {
    return false;
  }
  return owner.roots.filter((root) => isExactRoot(root, owner.rootPath)).length === 1;
}

function validEditor(editor: NpmRunSelectedScriptEditorCapture): boolean {
  return (
    Number.isSafeInteger(editor.anchorOffset) &&
    editor.anchorOffset >= 0 &&
    Number.isSafeInteger(editor.modelVersion) &&
    editor.modelVersion >= 0 &&
    editor.documentPath.length > 0
  );
}

function localManifest(
  authority: AuthoritySnapshot,
): { readonly key: WorkspacePathKey; readonly relativePath: string } | null {
  const paths = new Map<WorkspacePathKey, string>();
  for (const root of authority.roots) {
    const parsed = parseWorkspacePath(root, authority.editor.documentPath);
    if (!parsed.ok) continue;
    const previous = paths.get(parsed.value.key);
    if (previous !== undefined && previous !== parsed.value.relativePath) return null;
    paths.set(parsed.value.key, parsed.value.relativePath);
  }
  if (paths.size !== 1) return null;
  const [key, relativePath] = [...paths.entries()][0]!;
  const parts = relativePath.split("/");
  return parts[parts.length - 1] === "package.json" ? { key, relativePath } : null;
}

function exactCurrentDiscoveryScript(
  authority: AuthoritySnapshot,
  documentKey: WorkspacePathKey,
  scriptName: string,
): NodePackageScript | null {
  const candidates = authority.scripts.filter((script) => {
    if (
      script.scriptName !== scriptName ||
      exactDiscoveredNodePackageScript([script.original], script) !== script.original
    ) {
      return false;
    }
    return manifestKey(authority, script.manifestRelativePath) === documentKey;
  });
  return candidates.length === 1 ? candidates[0]!.original : null;
}

function manifestKey(
  authority: AuthoritySnapshot,
  manifestRelativePath: string,
): WorkspacePathKey | null {
  const root = authority.roots.find((candidate) => isExactRoot(candidate, authority.rootPath));
  if (!root) return null;
  const parsed = parseWorkspacePath(root, joinWorkspacePath(root.nativePath, manifestRelativePath));
  return parsed.ok && parsed.value.relativePath === manifestRelativePath ? parsed.value.key : null;
}

function isExactRoot(root: WorkspaceRootDescriptor, path: string): boolean {
  const parsed = parseWorkspacePath(root, path);
  return (
    parsed.ok && parsed.value.relativePath === "" && parsed.value.nativePath === root.nativePath
  );
}

function sameAuthority(left: AuthoritySnapshot, right: AuthoritySnapshot): boolean {
  return (
    sameOwner(left, right) &&
    left.authorityGeneration === right.authorityGeneration &&
    left.discoveryGeneration === right.discoveryGeneration &&
    left.trusted === right.trusted &&
    left.executionAvailable === right.executionAvailable &&
    sameRoots(left.roots, right.roots) &&
    sameScripts(left.scripts, right.scripts)
  );
}

function sameRoots(
  left: readonly WorkspaceRootDescriptor[],
  right: readonly WorkspaceRootDescriptor[],
): boolean {
  return (
    left.length === right.length &&
    left.every((root) => right.filter((candidate) => sameRoot(root, candidate)).length === 1)
  );
}

function sameRoot(left: WorkspaceRootDescriptor, right: WorkspaceRootDescriptor): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.nativePath === right.nativePath &&
    left.fileUri === right.fileUri &&
    left.anchor === right.anchor &&
    left.flavor === right.flavor &&
    left.policy.caseSensitive === right.policy.caseSensitive &&
    left.policy.unicodeNormalization === right.policy.unicodeNormalization &&
    (left.policy.caseSensitive ||
      (right.policy.caseSensitive === false && left.policy.foldCase === right.policy.foldCase))
  );
}

function sameScripts(left: readonly ScriptSnapshot[], right: readonly ScriptSnapshot[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (script, index) =>
        script.key === right[index]?.key &&
        script.manifestRelativePath === right[index]?.manifestRelativePath &&
        script.packageRootRelativePath === right[index]?.packageRootRelativePath &&
        script.scriptName === right[index]?.scriptName,
    )
  );
}

function sameCanonicalScript(left: NodePackageScript, right: NodePackageScript): boolean {
  return (
    left.key === right.key &&
    left.manifestRelativePath === right.manifestRelativePath &&
    left.packageRootRelativePath === right.packageRootRelativePath &&
    left.scriptName === right.scriptName
  );
}

function sameOwner(left: NpmRunSelectedScriptOwner, right: NpmRunSelectedScriptOwner): boolean {
  return (
    left.activationEpoch === right.activationEpoch &&
    left.ownerKey === right.ownerKey &&
    left.rootPath === right.rootPath &&
    left.workspaceId === right.workspaceId
  );
}

function sameEditorCapture(
  left: NpmRunSelectedScriptEditorCapture,
  right: NpmRunSelectedScriptEditorCapture,
): boolean {
  return (
    sameOwner(left, right) &&
    left.modelIdentity === right.modelIdentity &&
    left.modelVersion === right.modelVersion &&
    left.content === right.content &&
    left.anchorOffset === right.anchorOffset &&
    left.documentPath === right.documentPath
  );
}

function safeOwnerString(value: string): boolean {
  return value.trim().length > 0 && isWellFormedUnicode(value) && !/\p{Cc}/u.test(value);
}

function validGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
