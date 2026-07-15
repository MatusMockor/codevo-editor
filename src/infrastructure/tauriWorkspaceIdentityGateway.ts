import { invoke } from "@tauri-apps/api/core";
import {
  createWorkspaceRoot,
  parseWorkspacePath,
  type WorkspacePathPolicy,
} from "../domain/workspacePath";

export type NativeUnicodeNormalizationPolicy =
  | "canonicalDecomposition"
  | "preserved"
  | "unknown";

export interface NativeWorkspaceDescriptor {
  workspaceId: string;
  selectedRootPath: string;
  canonicalRootPath: string;
  caseSensitive: boolean | null;
  unicodeNormalizationPolicy: NativeUnicodeNormalizationPolicy;
}

export interface WorkspaceIdentityDescriptor {
  workspaceId: string;
  selectedPath: string;
  canonicalRoot: string;
  caseSensitive: boolean | null;
  unicodeNormalizationPolicy: NativeUnicodeNormalizationPolicy;
  policy: WorkspacePathPolicy;
}

export type NativeWorkspaceOpenResult =
  | { status: "cancelled" }
  | { status: "opened"; descriptor: NativeWorkspaceDescriptor };

export type WorkspaceOpenResult =
  | { status: "cancelled" }
  | { status: "opened"; descriptor: WorkspaceIdentityDescriptor };

export interface WorkspaceIdentityGateway {
  openFromPicker(): Promise<WorkspaceOpenResult>;
  openPath?(path: string): Promise<WorkspaceIdentityDescriptor>;
  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor>;
  unregister(workspaceId: string): Promise<void>;
}

export interface WorkspaceIdentityDescriptorResolver {
  descriptorForPath(path: string): WorkspaceIdentityDescriptor | null;
  matchForPath?(
    path: string,
    workspaceId?: string,
  ): WorkspaceIdentityPathMatch | null;
}

export interface WorkspaceIdentityPathMatch {
  descriptor: WorkspaceIdentityDescriptor;
  matchedRoot: string;
  relativePath: string;
}

export class TauriWorkspaceIdentityGateway
  implements WorkspaceIdentityGateway, WorkspaceIdentityDescriptorResolver
{
  private readonly descriptors = new Map<string, WorkspaceIdentityDescriptor>();
  private readonly aliases = new Map<string, readonly string[]>();
  private readonly unregisterSequences = new Map<string, number>();
  private operationSequence = 0;
  private operationTail: Promise<void> = Promise.resolve();

  openFromPicker(): Promise<WorkspaceOpenResult> {
    const sequence = this.nextOperationSequence();
    return this.serialize(async () => {
      const result = await invoke<NativeWorkspaceOpenResult>(
        "open_workspace_from_picker",
      );

      if (result.status === "cancelled") {
        return result;
      }

      const descriptor = this.cacheDescriptor(result.descriptor, sequence);

      return {
        status: "opened",
        descriptor,
      };
    });
  }

  openPath(path: string): Promise<WorkspaceIdentityDescriptor> {
    const sequence = this.nextOperationSequence();
    return this.serialize(async () => {
      const descriptor = await invoke<NativeWorkspaceDescriptor>(
        "register_workspace_path",
        { rootPath: path },
      );
      return this.cacheDescriptor(descriptor, sequence);
    });
  }

  descriptorForPath(path: string): WorkspaceIdentityDescriptor | null {
    return this.matchForPath(path)?.descriptor ?? null;
  }

  matchForPath(
    path: string,
    workspaceId?: string,
  ): WorkspaceIdentityPathMatch | null {
    let best: WorkspaceIdentityPathMatch | null = null;
    let bestSpecificity: WorkspaceRootSpecificity | null = null;
    for (const [candidateWorkspaceId, aliases] of this.aliases) {
      if (workspaceId && candidateWorkspaceId !== workspaceId) {
        continue;
      }

      const descriptor = this.descriptors.get(candidateWorkspaceId);
      if (!descriptor) {
        continue;
      }

      const match = matchedWorkspaceAlias(descriptor, aliases, path);
      if (!match) {
        continue;
      }

      const specificity = canonicalRootSpecificity(descriptor);
      if (!specificity) {
        continue;
      }

      if (isMoreSpecific(specificity, bestSpecificity)) {
        best = match;
        bestSpecificity = specificity;
      }
    }

    return best;
  }

  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor> {
    return invoke<NativeWorkspaceDescriptor>("get_workspace_descriptor", {
      workspaceId,
    });
  }

  unregister(workspaceId: string): Promise<void> {
    const sequence = this.nextOperationSequence();
    this.unregisterSequences.set(workspaceId, sequence);
    this.descriptors.delete(workspaceId);
    this.aliases.delete(workspaceId);
    return this.serialize(async () => {
      this.descriptors.delete(workspaceId);
      this.aliases.delete(workspaceId);
      await invoke<void>("unregister_workspace", { workspaceId });
    });
  }

  private cacheDescriptor(
    nativeDescriptor: NativeWorkspaceDescriptor,
    operationSequence: number,
  ): WorkspaceIdentityDescriptor {
    const descriptor = workspaceIdentityDescriptor(
      nativeDescriptor,
      nativeDescriptor.selectedRootPath,
    );
    const unregisterSequence =
      this.unregisterSequences.get(descriptor.workspaceId) ?? 0;
    if (unregisterSequence > operationSequence) {
      return descriptor;
    }

    const previousDescriptor = this.descriptors.get(descriptor.workspaceId);
    const previousAliases = this.aliases.get(descriptor.workspaceId) ?? [];
    const aliases =
      previousDescriptor?.canonicalRoot === descriptor.canonicalRoot
        ? [...new Set([...previousAliases, ...descriptorAliases(descriptor)])]
        : descriptorAliases(descriptor);

    this.descriptors.set(descriptor.workspaceId, descriptor);
    this.aliases.set(descriptor.workspaceId, aliases);
    return descriptor;
  }

  private nextOperationSequence(): number {
    this.operationSequence += 1;
    return this.operationSequence;
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function descriptorAliases(
  descriptor: WorkspaceIdentityDescriptor,
): string[] {
  return [descriptor.selectedPath, descriptor.canonicalRoot];
}

function matchedWorkspaceAlias(
  descriptor: WorkspaceIdentityDescriptor,
  aliases: readonly string[],
  path: string,
): WorkspaceIdentityPathMatch | null {
  let best: WorkspaceIdentityPathMatch | null = null;
  let bestSpecificity: WorkspaceRootSpecificity | null = null;
  for (const alias of aliases) {
    const relativePath = workspaceRelativePathForRoot(descriptor, alias, path);
    if (relativePath === null) {
      continue;
    }

    const specificity = workspaceRootSpecificity(descriptor, alias);
    if (!specificity || !isMoreSpecific(specificity, bestSpecificity)) {
      continue;
    }

    best = { descriptor, matchedRoot: alias, relativePath };
    bestSpecificity = specificity;
  }

  return best;
}

interface WorkspaceRootSpecificity {
  depth: number;
  pathLength: number;
}

function canonicalRootSpecificity(
  descriptor: WorkspaceIdentityDescriptor,
): WorkspaceRootSpecificity | null {
  return workspaceRootSpecificity(descriptor, descriptor.canonicalRoot);
}

function workspaceRootSpecificity(
  descriptor: WorkspaceIdentityDescriptor,
  rootPath: string,
): WorkspaceRootSpecificity | null {
  const root = createWorkspaceRoot(
    descriptor.workspaceId,
    rootPath,
    descriptor.policy,
  );
  if (!root.ok) {
    return null;
  }

  const normalizedPath = root.value.nativePath;
  return {
    depth: normalizedPath.split("/").filter(Boolean).length,
    pathLength: normalizedPath.length,
  };
}

function isMoreSpecific(
  candidate: WorkspaceRootSpecificity,
  current: WorkspaceRootSpecificity | null,
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.depth !== current.depth) {
    return candidate.depth > current.depth;
  }

  return candidate.pathLength > current.pathLength;
}

export function workspaceRelativePathForDescriptor(
  descriptor: WorkspaceIdentityDescriptor,
  path: string,
): string | null {
  for (const root of [descriptor.selectedPath, descriptor.canonicalRoot]) {
    const relativePath = workspaceRelativePathForRoot(descriptor, root, path);
    if (relativePath !== null) {
      return relativePath;
    }
  }

  return null;
}

function workspaceRelativePathForRoot(
  descriptor: WorkspaceIdentityDescriptor,
  rootPath: string,
  path: string,
): string | null {
  const root = createWorkspaceRoot(
    descriptor.workspaceId,
    rootPath,
    descriptor.policy,
  );
  if (!root.ok) {
    return null;
  }

  const parsed = parseWorkspacePath(root.value, path);
  return parsed.ok ? parsed.value.relativePath : null;
}

export function workspaceIdentityDescriptor(
  descriptor: NativeWorkspaceDescriptor,
  selectedPath: string = descriptor.canonicalRootPath,
): WorkspaceIdentityDescriptor {
  return {
    workspaceId: descriptor.workspaceId,
    selectedPath,
    canonicalRoot: descriptor.canonicalRootPath,
    caseSensitive: descriptor.caseSensitive,
    unicodeNormalizationPolicy: descriptor.unicodeNormalizationPolicy,
    policy: workspacePathPolicy(descriptor),
  };
}

function workspacePathPolicy(
  descriptor: NativeWorkspaceDescriptor,
): WorkspacePathPolicy {
  const unicodeNormalization =
    descriptor.unicodeNormalizationPolicy === "canonicalDecomposition"
      ? "NFD"
      : "none";

  if (descriptor.caseSensitive !== false) {
    return { caseSensitive: true, unicodeNormalization };
  }

  return {
    caseSensitive: false,
    foldCase: (value) => value.toLocaleLowerCase("en-US"),
    unicodeNormalization,
  };
}
