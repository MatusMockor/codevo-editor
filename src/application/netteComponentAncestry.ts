import { netteComponentAncestorReferences } from "../domain/netteComponents";
import { phpTopLevelTypeDeclarationNames } from "../domain/phpClassStructure";
import type { NetteControlDependencies } from "./netteControlContracts";

export interface NetteAncestorComponentSource {
  path: string;
  source: string;
}

const MAX_ANCESTOR_DEPTH = 5;
const MAX_ANCESTOR_SOURCE_READS = 64;
const MAX_ANCESTOR_SOURCES = 32;

export async function netteAncestorComponentSources(
  deps: NetteControlDependencies,
  isRequestedRootActive: () => boolean,
  ownerSource: string,
): Promise<NetteAncestorComponentSource[]> {
  const readPhpClassSource = deps.readPhpClassSource;

  if (!readPhpClassSource) {
    return [];
  }

  const ancestors: NetteAncestorComponentSource[] = [];
  let sourceReads = 0;
  const visitedClassKeys = new Set<string>();
  const visitedPaths = new Set<string>();
  const queue: Array<{ depth: number; source: string }> = [
    { depth: 0, source: ownerSource },
  ];

  markDeclaredClassesVisited(deps, ownerSource, visitedClassKeys);

  for (
    let current = queue.shift();
    current !== undefined;
    current = queue.shift()
  ) {
    for (const reference of ancestorClassReferences(current.source)) {
      if (ancestors.length >= MAX_ANCESTOR_SOURCES) {
        return ancestors;
      }

      if (sourceReads >= MAX_ANCESTOR_SOURCE_READS) {
        return ancestors;
      }

      const resolved =
        deps.resolveDeclaredType(current.source, reference) ?? reference;
      const className = resolved.trim().replace(/^\\+/, "");
      const classKey = className.toLowerCase();

      if (!className || visitedClassKeys.has(classKey)) {
        continue;
      }

      visitedClassKeys.add(classKey);

      sourceReads += 1;
      const ancestor = await readPhpClassSource(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      if (!ancestor || visitedPaths.has(ancestor.path)) {
        continue;
      }

      visitedPaths.add(ancestor.path);
      markDeclaredClassesVisited(deps, ancestor.source, visitedClassKeys);
      ancestors.push({ path: ancestor.path, source: ancestor.source });

      if (current.depth + 1 < MAX_ANCESTOR_DEPTH) {
        queue.push({ depth: current.depth + 1, source: ancestor.source });
      }
    }
  }

  return ancestors;
}

function ancestorClassReferences(source: string): string[] {
  const references = netteComponentAncestorReferences(source);

  if (!references.parentClassName) {
    return references.traitNames;
  }

  return [...references.traitNames, references.parentClassName];
}

function markDeclaredClassesVisited(
  deps: NetteControlDependencies,
  source: string,
  visitedClassKeys: Set<string>,
): void {
  for (const declaredName of phpTopLevelTypeDeclarationNames(source)) {
    const resolved =
      deps.resolveDeclaredType(source, declaredName) ?? declaredName;
    const classKey = resolved.trim().replace(/^\\+/, "").toLowerCase();

    if (classKey) {
      visitedClassKeys.add(classKey);
    }
  }
}
