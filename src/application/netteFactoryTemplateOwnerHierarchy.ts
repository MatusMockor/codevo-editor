import {
  netteComponentAncestorReferences,
  nettePresenterLifecycleInfo,
  type NettePresenterLifecycleEntry,
} from "../domain/netteComponents";
import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
  type PhpMethodMember,
  type PhpTypeKind,
} from "../domain/phpClassStructure";
import { maskPhpSource } from "../domain/phpSourceMask";
import { netteAncestorComponentSources } from "./netteComponentAncestry";
import type { NetteControlDependencies } from "./netteControlContracts";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";

export interface NetteFactoryTemplateOwnerHierarchyContext {
  deps: NetteControlDependencies;
  isRequestedRootActive(): boolean;
  loadOwner(templatePath: string): Promise<NetteFactoryTemplateOwner | null>;
}

export interface NetteFactoryTemplateOwnerSource {
  path: string;
  source: string;
}

export interface NetteFactoryTemplateOwnerPrecedenceNode {
  methods: PhpMethodMember[];
  parentIndex: number | null;
  source: NetteFactoryTemplateOwnerSource;
  traitIndexes: number[];
}

export interface NetteFactoryTemplateOwnerPrecedence {
  nodes: NetteFactoryTemplateOwnerPrecedenceNode[];
  rootIndex: number;
}

export interface NetteFactoryTemplateOwnerHierarchy {
  owner: NetteFactoryTemplateOwner;
  /** Null when declarations or relationships cannot be modeled uniquely. */
  precedence: NetteFactoryTemplateOwnerPrecedence | null;
  /** Owner first, followed by sources in bounded ancestry discovery order. */
  sources: NetteFactoryTemplateOwnerSource[];
}

export interface NetteFactoryTemplateOwnerMethodSource {
  method: PhpMethodMember;
  source: NetteFactoryTemplateOwnerSource;
}

export interface NetteFactoryTemplateOwnerLifecycleMember
  extends NetteFactoryTemplateOwnerMethodSource {
  lifecycle: NettePresenterLifecycleEntry;
}

interface ParsedSource {
  declaredClassName: string;
  hasTraitAdaptationBlock: boolean;
  kind: PhpTypeKind;
  methods: PhpMethodMember[];
  source: NetteFactoryTemplateOwnerSource;
}

type ReferenceIndex = number | null | "ambiguous";
type MethodResolution =
  | { kind: "ambiguous" }
  | { kind: "missing" }
  | {
      kind: "resolved";
      method: PhpMethodMember;
      nodeIndex: number;
    };

const PHP_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const METHOD_SOURCE_KINDS: ReadonlySet<PhpTypeKind> = new Set([
  "abstract-class",
  "class",
  "trait",
]);
const TRAIT_ADAPTATION_BLOCK =
  /\buse\s+\\?[A-Za-z_][\\A-Za-z0-9_]*(?:\s*,\s*\\?[A-Za-z_][\\A-Za-z0-9_]*)*\s*\{/i;

export async function loadNetteFactoryTemplateOwnerHierarchy(
  context: NetteFactoryTemplateOwnerHierarchyContext,
  templatePath: string,
): Promise<NetteFactoryTemplateOwnerHierarchy | null> {
  if (!context.isRequestedRootActive() || !templatePath.trim()) {
    return null;
  }

  const owner = await context.loadOwner(templatePath);

  if (!context.isRequestedRootActive() || !owner) {
    return null;
  }

  const ancestors = await netteAncestorComponentSources(
    context.deps,
    context.isRequestedRootActive,
    owner.source,
  );

  if (!context.isRequestedRootActive()) {
    return null;
  }

  const sources = [
    { path: owner.path, source: owner.source },
    ...ancestors,
  ];

  return {
    owner,
    precedence: buildPrecedence(context.deps, owner, sources),
    sources,
  };
}

/** Resolves one effective declaration using class/trait/parent PHP precedence. */
export function findNetteFactoryTemplateOwnerMethodSource(
  hierarchy: NetteFactoryTemplateOwnerHierarchy,
  methodName: string,
): NetteFactoryTemplateOwnerMethodSource | null {
  const normalizedName = methodName.trim();

  if (!PHP_IDENTIFIER.test(normalizedName) || !hierarchy.precedence) {
    return null;
  }

  const resolution = resolveMethod(
    hierarchy.precedence,
    hierarchy.precedence.rootIndex,
    normalizedName.toLowerCase(),
    new Set(),
  );

  if (resolution.kind !== "resolved") {
    return null;
  }

  const node = hierarchy.precedence.nodes[resolution.nodeIndex];

  if (!node) {
    return null;
  }

  return { method: resolution.method, source: node.source };
}

/**
 * Aggregates effective Nette lifecycle declarations. Null means at least one
 * lifecycle name has ambiguous trait composition or an unmodeled adaptation.
 */
export function aggregateNetteFactoryTemplateOwnerLifecycleMembers(
  hierarchy: NetteFactoryTemplateOwnerHierarchy,
): NetteFactoryTemplateOwnerLifecycleMember[] | null {
  const precedence = hierarchy.precedence;

  if (!precedence) {
    return null;
  }

  const lifecycleNames = new Set<string>();

  for (const node of precedence.nodes) {
    for (const lifecycle of nettePresenterLifecycleInfo(node.source.source)
      .lifecycle) {
      lifecycleNames.add(lifecycle.methodName.toLowerCase());
    }
  }

  const members: Array<
    NetteFactoryTemplateOwnerLifecycleMember & { nodeIndex: number }
  > = [];

  for (const methodName of lifecycleNames) {
    const resolution = resolveMethod(
      precedence,
      precedence.rootIndex,
      methodName,
      new Set(),
    );

    if (resolution.kind === "ambiguous") {
      return null;
    }

    if (resolution.kind === "missing") {
      continue;
    }

    const node = precedence.nodes[resolution.nodeIndex];
    const lifecycle = node
      ? exactLifecycle(node.source.source, resolution.method.name)
      : null;

    if (!node || !lifecycle) {
      return null;
    }

    members.push({
      lifecycle,
      method: resolution.method,
      nodeIndex: resolution.nodeIndex,
      source: node.source,
    });
  }

  const ranks = precedenceRanks(precedence);
  members.sort((left, right) => {
    const rankDifference =
      (ranks.get(left.nodeIndex) ?? Number.MAX_SAFE_INTEGER) -
      (ranks.get(right.nodeIndex) ?? Number.MAX_SAFE_INTEGER);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return left.method.declarationOffset - right.method.declarationOffset;
  });

  return members.map(({ lifecycle, method, source }) => ({
    lifecycle,
    method,
    source,
  }));
}

function buildPrecedence(
  deps: NetteControlDependencies,
  owner: NetteFactoryTemplateOwner,
  sources: NetteFactoryTemplateOwnerSource[],
): NetteFactoryTemplateOwnerPrecedence | null {
  const parsedSources: ParsedSource[] = [];

  for (const source of sources) {
    const parsed = parseExactSource(source, owner);

    if (!parsed) {
      return null;
    }

    if (parsed.hasTraitAdaptationBlock) {
      return null;
    }

    parsedSources.push(parsed);
  }

  const classNames = parsedSources.map((parsed, index) => {
    if (index === 0) {
      return normalizeClassName(owner.className);
    }

    return normalizeClassName(
      deps.resolveDeclaredType(parsed.source.source, parsed.declaredClassName) ??
        parsed.declaredClassName,
    );
  });
  const nodes: NetteFactoryTemplateOwnerPrecedenceNode[] = [];

  for (const parsed of parsedSources) {
    const references = netteComponentAncestorReferences(parsed.source.source);
    const traitIndexes: number[] = [];

    for (const traitName of references.traitNames) {
      const traitIndex = resolveReferenceIndex(
        deps,
        parsed.source.source,
        traitName,
        classNames,
      );

      if (traitIndex === "ambiguous") {
        return null;
      }

      if (traitIndex === null) {
        return null;
      }

      const traitSource = parsedSources[traitIndex];

      if (!traitSource || traitSource.kind !== "trait") {
        return null;
      }

      traitIndexes.push(traitIndex);
    }

    const parentIndex = references.parentClassName
      ? resolveReferenceIndex(
          deps,
          parsed.source.source,
          references.parentClassName,
          classNames,
        )
      : null;

    if (parentIndex === "ambiguous") {
      return null;
    }

    if (references.parentClassName && parentIndex === null) {
      return null;
    }

    if (parentIndex !== null) {
      const parentSource = parsedSources[parentIndex];

      if (!parentSource || parentSource.kind === "trait") {
        return null;
      }
    }

    nodes.push({
      methods: parsed.methods,
      parentIndex,
      source: parsed.source,
      traitIndexes,
    });
  }

  return { nodes, rootIndex: 0 };
}

function resolveMethod(
  precedence: NetteFactoryTemplateOwnerPrecedence,
  nodeIndex: number,
  methodKey: string,
  visiting: Set<number>,
): MethodResolution {
  if (visiting.has(nodeIndex)) {
    return { kind: "ambiguous" };
  }

  const node = precedence.nodes[nodeIndex];

  if (!node) {
    return { kind: "missing" };
  }

  const ownMethod = node.methods.find(
    (method) => method.name.toLowerCase() === methodKey,
  );

  if (ownMethod) {
    return { kind: "resolved", method: ownMethod, nodeIndex };
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeIndex);
  const traitMatches: Extract<MethodResolution, { kind: "resolved" }>[] = [];

  for (const traitIndex of node.traitIndexes) {
    const traitResolution = resolveMethod(
      precedence,
      traitIndex,
      methodKey,
      nextVisiting,
    );

    if (traitResolution.kind === "ambiguous") {
      return traitResolution;
    }

    if (traitResolution.kind === "resolved") {
      traitMatches.push(traitResolution);
    }
  }

  if (traitMatches.length > 1) {
    return { kind: "ambiguous" };
  }

  const traitMatch = traitMatches[0];

  if (traitMatch) {
    return traitMatch;
  }

  if (node.parentIndex === null) {
    return { kind: "missing" };
  }

  return resolveMethod(
    precedence,
    node.parentIndex,
    methodKey,
    nextVisiting,
  );
}

function precedenceRanks(
  precedence: NetteFactoryTemplateOwnerPrecedence,
): Map<number, number> {
  const ranks = new Map<number, number>();

  function visit(nodeIndex: number, visiting: Set<number>): void {
    if (ranks.has(nodeIndex) || visiting.has(nodeIndex)) {
      return;
    }

    ranks.set(nodeIndex, ranks.size);
    const node = precedence.nodes[nodeIndex];

    if (!node) {
      return;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeIndex);

    for (const traitIndex of node.traitIndexes) {
      visit(traitIndex, nextVisiting);
    }

    if (node.parentIndex !== null) {
      visit(node.parentIndex, nextVisiting);
    }
  }

  visit(precedence.rootIndex, new Set());
  return ranks;
}

function resolveReferenceIndex(
  deps: NetteControlDependencies,
  source: string,
  reference: string,
  classNames: string[],
): ReferenceIndex {
  const resolved = normalizeClassName(
    deps.resolveDeclaredType(source, reference) ?? reference,
  );
  const exactMatches = matchingIndexes(
    classNames,
    (className) => className === resolved,
  );

  if (exactMatches.length === 1) {
    return exactMatches[0] ?? null;
  }

  if (exactMatches.length > 1) {
    return "ambiguous";
  }

  const shortName = shortClassName(resolved);
  const shortMatches = matchingIndexes(
    classNames,
    (className) => shortClassName(className) === shortName,
  );

  if (shortMatches.length > 1) {
    return "ambiguous";
  }

  return shortMatches[0] ?? null;
}

function matchingIndexes(
  values: string[],
  predicate: (value: string) => boolean,
): number[] {
  const indexes: number[] = [];

  values.forEach((value, index) => {
    if (predicate(value)) {
      indexes.push(index);
    }
  });

  return indexes;
}

function parseExactSource(
  source: NetteFactoryTemplateOwnerSource,
  owner: NetteFactoryTemplateOwner,
): ParsedSource | null {
  const declaredNames = phpTopLevelTypeDeclarationNames(source.source);

  if (declaredNames.length !== 1) {
    return null;
  }

  const declaredClassName = declaredNames[0];

  if (!declaredClassName) {
    return null;
  }

  if (
    source.path === owner.path &&
    declaredClassName.toLowerCase() !==
      shortClassName(owner.className).toLowerCase()
  ) {
    return null;
  }

  const structure = parsePhpClassStructure(source.source, declaredClassName);

  if (!structure.kind || !METHOD_SOURCE_KINDS.has(structure.kind)) {
    return null;
  }

  const typeDeclaration = structure.typeDeclaration;

  if (!typeDeclaration) {
    return null;
  }

  const typeBody = maskPhpSource(source.source).slice(
    typeDeclaration.bodyStartOffset + 1,
    typeDeclaration.bodyEndOffset,
  );

  const methodNames = new Set<string>();

  for (const method of structure.methods) {
    const methodKey = method.name.toLowerCase();

    if (methodNames.has(methodKey)) {
      return null;
    }

    methodNames.add(methodKey);
  }

  return {
    declaredClassName,
    hasTraitAdaptationBlock: TRAIT_ADAPTATION_BLOCK.test(typeBody),
    kind: structure.kind,
    methods: structure.methods,
    source,
  };
}

function exactLifecycle(
  source: string,
  methodName: string,
): NettePresenterLifecycleEntry | null {
  const matches = nettePresenterLifecycleInfo(source).lifecycle.filter(
    (entry) => entry.methodName.toLowerCase() === methodName.toLowerCase(),
  );

  return matches.length === 1 ? matches[0] ?? null : null;
}

function normalizeClassName(className: string): string {
  return className.trim().replace(/^\\+/, "").toLowerCase();
}

function shortClassName(className: string): string {
  return normalizeClassName(className).split("\\").pop() ?? "";
}
