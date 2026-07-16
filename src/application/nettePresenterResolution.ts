import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import {
  nettePresenterClassFromName,
  nettePresenterNameFromClass,
  type NettePresenterMapping,
} from "../domain/nettePresenterMapping";
import { componentClassCandidatePathsForTemplate } from "../domain/nettePathResolution";
import type { NetteControlDependencies } from "./netteControlContracts";
import {
  aggregateNetteFactoryTemplateOwnerLifecycleMembers,
  loadNetteFactoryTemplateOwnerHierarchy,
  type NetteFactoryTemplateOwnerHierarchy,
} from "./netteFactoryTemplateOwnerHierarchy";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";

export interface NettePresenterResolvedOwner {
  factoryHierarchy?: NetteFactoryTemplateOwnerHierarchy;
  path: string;
  source: string;
}

export interface NettePresenterResolutionDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
  readPhpClassSource?(
    className: string,
  ): Promise<NettePresenterResolvedOwner | null>;
  resolveDeclaredType?(source: string, typeHint: string | null): string | null;
}

export interface NettePresenterResolutionCapabilities {
  presenterClassCandidatePathsForLink(
    target: NetteLinkTarget,
    currentRelativePath: string,
  ): string[];
}

export interface NettePresenterResolutionContext {
  currentRelativePath: string;
  deps: NettePresenterResolutionDependencies;
  frameworkCapabilities: NettePresenterResolutionCapabilities;
  isRequestedRootActive(): boolean;
  isPresenterMappingGenerationCurrent?(): boolean;
  loadFactoryTemplateOwner(
    templatePath: string,
  ): Promise<NetteFactoryTemplateOwner | null>;
  loadPresenterMappings?(): Promise<readonly NettePresenterMapping[]>;
  requestedRoot: string;
}

export interface NettePresenterResolutionRun {
  sources: Map<string, string | null>;
}

export type NettePresenterFactoryOwnerContext = Pick<
  NettePresenterResolutionContext,
  | "currentRelativePath"
  | "deps"
  | "isRequestedRootActive"
  | "loadFactoryTemplateOwner"
>;

export function createNettePresenterResolutionRun(): NettePresenterResolutionRun {
  return { sources: new Map() };
}

export function loadNettePresenterFactoryOwnerHierarchy(
  context: NettePresenterFactoryOwnerContext,
): Promise<NetteFactoryTemplateOwnerHierarchy | null> {
  return loadNetteFactoryTemplateOwnerHierarchy(
    {
      deps: {
        ...(context.deps as NetteControlDependencies),
        resolveDeclaredType:
          context.deps.resolveDeclaredType ?? ((_source, typeHint) => typeHint),
      },
      isRequestedRootActive: context.isRequestedRootActive,
      loadOwner: context.loadFactoryTemplateOwner,
    },
    context.currentRelativePath,
  );
}

export async function resolveNettePresenterOwner(
  context: NettePresenterResolutionContext,
  target: NetteLinkTarget,
  run: NettePresenterResolutionRun = createNettePresenterResolutionRun(),
): Promise<NettePresenterResolvedOwner | null> {
  if (!isResolutionCurrent(context)) {
    return null;
  }

  if (target.isSignal && target.presenter === null) {
    const conventionalComponent = await resolveConventionalOwner(
      context,
      componentClassCandidatePathsForTemplate(context.currentRelativePath),
      run,
    );

    if (!isResolutionCurrent(context)) {
      return null;
    }

    if (conventionalComponent) {
      return conventionalComponent;
    }

    const factory = await resolveFactoryTemplateOwner(context);

    if (!isResolutionCurrent(context)) {
      return null;
    }

    if (factory) {
      return factory;
    }
  }

  const mappings = context.loadPresenterMappings
    ? await context.loadPresenterMappings()
    : [];

  if (!isResolutionCurrent(context)) {
    return null;
  }

  if (target.presenter !== null) {
    const logical = await logicalPresenterNames(context, target, mappings, run);

    if (!isResolutionCurrent(context) || logical.ambiguous) {
      return null;
    }

    const stages = mappedClassStages(logical.names, mappings);

    if (stages.length > 0 && !context.deps.readPhpClassSource) {
      return null;
    }

    for (const stage of stages) {
      if (stage.ambiguous) {
        return null;
      }

      if (!stage.className) {
        continue;
      }

      const owner = await context.deps.readPhpClassSource?.(stage.className);

      if (!isResolutionCurrent(context)) {
        return null;
      }

      if (owner) {
        run.sources.set(owner.path, owner.source);
        return owner;
      }
    }

    if (stages.length > 0) {
      return null;
    }
  }

  return resolveConventionalOwner(
    context,
    context.frameworkCapabilities.presenterClassCandidatePathsForLink(
      target,
      context.currentRelativePath,
    ),
    run,
  );
}

async function resolveConventionalOwner(
  context: NettePresenterResolutionContext,
  relativePaths: readonly string[],
  run: NettePresenterResolutionRun,
): Promise<NettePresenterResolvedOwner | null> {
  for (const relativePath of relativePaths) {
    if (!isResolutionCurrent(context)) {
      return null;
    }

    const path = context.deps.joinPath(context.requestedRoot, relativePath);
    const source = await readSource(context, path, run);

    if (!isResolutionCurrent(context)) {
      return null;
    }

    if (source !== null) {
      return { path, source };
    }
  }

  return null;
}

async function resolveFactoryTemplateOwner(
  context: NettePresenterResolutionContext,
): Promise<NettePresenterResolvedOwner | null> {
  const hierarchy = await loadNettePresenterFactoryOwnerHierarchy(context);

  if (!hierarchy) {
    return null;
  }

  if (
    !hierarchy.precedence ||
    !aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy)
  ) {
    return null;
  }

  return {
    factoryHierarchy: hierarchy,
    path: hierarchy.owner.path,
    source: hierarchy.owner.source,
  };
}

async function logicalPresenterNames(
  context: NettePresenterResolutionContext,
  target: NetteLinkTarget,
  mappings: readonly NettePresenterMapping[],
  run: NettePresenterResolutionRun,
): Promise<{ ambiguous: boolean; names: string[] }> {
  const targetSegments = [
    ...(target.module?.split(":") ?? []),
    target.presenter ?? "",
  ].filter(Boolean);

  if (target.absolute) {
    return { ambiguous: false, names: [targetSegments.join(":")] };
  }

  const current = await currentPresenterModule(context, mappings, run);

  if (current.ambiguous) {
    return { ambiguous: true, names: [] };
  }

  if (current.module.length > 0) {
    return {
      ambiguous: false,
      names: [[...current.module, ...targetSegments].join(":")],
    };
  }

  return { ambiguous: false, names: [targetSegments.join(":")].filter(Boolean) };
}

async function currentPresenterModule(
  context: NettePresenterResolutionContext,
  mappings: readonly NettePresenterMapping[],
  run: NettePresenterResolutionRun,
): Promise<{ ambiguous: boolean; module: string[] }> {
  const currentTarget: NetteLinkTarget = {
    absolute: false,
    action: "default",
    isSignal: false,
    module: null,
    presenter: null,
  };
  const paths = context.frameworkCapabilities.presenterClassCandidatePathsForLink(
    currentTarget,
    context.currentRelativePath,
  );

  for (const relativePath of paths) {
    if (!isResolutionCurrent(context)) {
      return { ambiguous: false, module: [] };
    }

    const path = context.deps.joinPath(context.requestedRoot, relativePath);
    const source = await readSource(context, path, run);

    if (source === null) {
      continue;
    }

    const className = phpPrimaryQualifiedClassName(source);
    const presenterNames = className
      ? presenterNamesFromClass(className, mappings)
      : [];

    if (presenterNames.length === 0) {
      continue;
    }

    const modules = dedupe(
      presenterNames.map((name) => name.split(":").slice(0, -1).join(":")),
    );

    if (modules.length > 1) {
      return { ambiguous: true, module: [] };
    }

    return { ambiguous: false, module: (modules[0] ?? "").split(":").filter(Boolean) };
  }

  return { ambiguous: false, module: [] };
}

function mappedClassStages(
  presenterNames: readonly string[],
  mappings: readonly NettePresenterMapping[],
): Array<{ ambiguous: boolean; className: string | null }> {
  const stages: Array<{ ambiguous: boolean; className: string | null }> = [];

  for (const presenterName of presenterNames) {
    const module = presenterName.includes(":")
      ? presenterName.split(":")[0] ?? ""
      : "";
    const exactMappings = module
      ? distinctMappings(mappings.filter((mapping) => mapping.module === module))
      : [];
    const wildcardMappings = distinctMappings(
      mappings.filter((mapping) => mapping.module === "*"),
    );

    if (exactMappings.length > 0) {
      stages.push(mappingStage(presenterName, exactMappings));
      continue;
    }

    if (wildcardMappings.length > 0) {
      stages.push(mappingStage(presenterName, wildcardMappings));
    }
  }

  return stages;
}

function mappingStage(
  presenterName: string,
  mappings: readonly NettePresenterMapping[],
): { ambiguous: boolean; className: string | null } {
  if (mappings.length !== 1) {
    return { ambiguous: true, className: null };
  }

  return {
    ambiguous: false,
    className: nettePresenterClassFromName(presenterName, mappings),
  };
}

async function readSource(
  context: NettePresenterResolutionContext,
  path: string,
  run: NettePresenterResolutionRun,
): Promise<string | null> {
  if (run.sources.has(path)) {
    return run.sources.get(path) ?? null;
  }

  try {
    const source = await context.deps.readFileContent(path);
    run.sources.set(path, source);
    return source;
  } catch {
    if (!isResolutionCurrent(context)) {
      return null;
    }

    run.sources.set(path, null);
    return null;
  }
}

function phpPrimaryQualifiedClassName(source: string): string | null {
  const className = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(source)?.[1];

  if (!className) {
    return null;
  }

  const namespace = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source)?.[1]?.trim();

  return namespace ? `${namespace}\\${className}` : className;
}

function presenterNamesFromClass(
  className: string,
  mappings: readonly NettePresenterMapping[],
): string[] {
  return dedupe(
    mappings.flatMap((mapping) => {
      const name = nettePresenterNameFromClass(className, [mapping]);
      return name ? [name] : [];
    }),
  );
}

function distinctMappings(
  mappings: readonly NettePresenterMapping[],
): NettePresenterMapping[] {
  const distinct = new Map<string, NettePresenterMapping>();

  for (const mapping of mappings) {
    distinct.set(
      [mapping.module, mapping.namespace, mapping.moduleMask, mapping.presenterMask]
        .join("\0"),
      mapping,
    );
  }

  return Array.from(distinct.values());
}

function isResolutionCurrent(context: NettePresenterResolutionContext): boolean {
  if (!context.isRequestedRootActive()) {
    return false;
  }

  return context.isPresenterMappingGenerationCurrent
    ? context.isPresenterMappingGenerationCurrent()
    : true;
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
