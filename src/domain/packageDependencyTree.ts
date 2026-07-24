import type { NpmPackageDescriptor } from "./workspace";

export type PackageDependencyGroupKind = "production" | "development";
export type PackageDependencyInstallStatus = "installed" | "missing";

export interface PackageDependencyTreeItem {
  readonly declaredRange: string;
  readonly group: PackageDependencyGroupKind;
  readonly id: string;
  readonly installedVersion: string | null;
  readonly name: string;
  readonly status: PackageDependencyInstallStatus;
}

export interface PackageDependencyTreeGroup {
  readonly id: PackageDependencyGroupKind;
  readonly items: readonly PackageDependencyTreeItem[];
  readonly label: string;
}

export interface PackageDependencyLocation {
  readonly column: number;
  readonly lineNumber: number;
}

const GROUP_LABELS: Record<PackageDependencyGroupKind, string> = {
  development: "Development dependencies",
  production: "Production dependencies",
};

export function buildPackageDependencyTree(
  packages: readonly NpmPackageDescriptor[],
  query = "",
): PackageDependencyTreeGroup[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const groups: PackageDependencyTreeGroup[] = [];

  for (const group of ["production", "development"] as const) {
    const items = packages
      .filter((descriptor) => descriptor.dev === (group === "development"))
      .map((descriptor): PackageDependencyTreeItem => {
        const status: PackageDependencyInstallStatus = descriptor.installPath
          ? "installed"
          : "missing";
        return {
          declaredRange: descriptor.declaredRange,
          group,
          id: `${group}:${descriptor.name}`,
          installedVersion: descriptor.installedVersion,
          name: descriptor.name,
          status,
        };
      })
      .filter((item) => {
        const searchable = [
          item.name,
          item.declaredRange,
          item.installedVersion ?? "",
          item.status,
          GROUP_LABELS[item.group],
        ]
          .join(" ")
          .toLocaleLowerCase();
        return terms.every((term) => searchable.includes(term));
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    if (items.length > 0) {
      groups.push({ id: group, items, label: GROUP_LABELS[group] });
    }
  }

  return groups;
}

export function packageDependencyCount(groups: readonly PackageDependencyTreeGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

export function locatePackageDependencyKey(
  source: string,
  dependency: Pick<PackageDependencyTreeItem, "group" | "name">,
): PackageDependencyLocation | null {
  const sectionPriority =
    dependency.group === "development"
      ? (["devDependencies"] as const)
      : (["dependencies", "peerDependencies", "optionalDependencies"] as const);
  const acceptedSections = new Set<string>(sectionPriority);
  const tokens = tokenizeJson(source);
  let rootDepth = 0;
  let pendingSection: string | null = null;
  let activeSection: { depth: number; name: string } | null = null;
  const locatedBySection = new Map<string, PackageDependencyLocation>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;

    if (token.kind === "open") {
      rootDepth += 1;
      const previous = tokens[index - 1];
      const isImmediateObjectValue =
        previous?.kind === "colon" &&
        source.slice(previous.offset + 1, token.offset).trim().length === 0;
      if (pendingSection && acceptedSections.has(pendingSection) && isImmediateObjectValue) {
        activeSection = { depth: rootDepth, name: pendingSection };
      }
      pendingSection = null;
      continue;
    }
    if (token.kind === "close") {
      if (activeSection?.depth === rootDepth) activeSection = null;
      rootDepth = Math.max(0, rootDepth - 1);
      pendingSection = null;
      continue;
    }
    if (token.kind === "comma") {
      if (rootDepth === 1) pendingSection = null;
      continue;
    }
    if (token.kind !== "string") continue;

    const followedByColon = tokens[index + 1]?.kind === "colon";
    if (!followedByColon) continue;
    if (rootDepth === 1) {
      pendingSection = token.value;
      if (acceptedSections.has(token.value)) locatedBySection.delete(token.value);
      continue;
    }
    if (activeSection?.depth === rootDepth && token.value === dependency.name) {
      locatedBySection.set(activeSection.name, offsetLocation(source, token.offset));
    }
  }

  for (const section of sectionPriority) {
    const location = locatedBySection.get(section);
    if (location) return location;
  }
  return null;
}

type JsonToken =
  | { readonly kind: "open" | "close" | "colon" | "comma"; readonly offset: number }
  | { readonly kind: "string"; readonly offset: number; readonly value: string };

function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source[offset];
    if (character === "{") tokens.push({ kind: "open", offset });
    else if (character === "}") tokens.push({ kind: "close", offset });
    else if (character === ":") tokens.push({ kind: "colon", offset });
    else if (character === ",") tokens.push({ kind: "comma", offset });
    else if (character === '"') {
      const start = offset;
      let escaped = false;
      offset += 1;
      while (offset < source.length) {
        const current = source[offset];
        if (!escaped && current === '"') break;
        if (!escaped && current === "\\") escaped = true;
        else escaped = false;
        offset += 1;
      }
      if (offset >= source.length) break;
      const raw = source.slice(start, offset + 1);
      try {
        tokens.push({ kind: "string", offset: start, value: JSON.parse(raw) as string });
      } catch {
        return tokens;
      }
    }
  }
  return tokens;
}

function offsetLocation(source: string, offset: number): PackageDependencyLocation {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}
