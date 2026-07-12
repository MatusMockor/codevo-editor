import {
  bestPsr4Match,
  renderPhpTypeSkeleton,
} from "./phpCreateClass";
import type { Psr4Root } from "./workspace";

export interface PhpNewFileTemplate {
  content: string;
}

export function phpNewFileTemplate(
  relativePath: string,
  psr4Roots: readonly Psr4Root[],
): PhpNewFileTemplate | null {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalizedPath.endsWith(".php")) {
    return null;
  }

  for (const root of psr4Roots) {
    const directory = normalizeDirectory(root.paths[0]);

    if (!directory || !root.namespace) {
      continue;
    }

    const directoryPrefix = `${directory}/`;

    if (!normalizedPath.startsWith(directoryPrefix)) {
      continue;
    }

    const relativeTypePath = normalizedPath.slice(directoryPrefix.length, -4);
    const segments = relativeTypePath.split("/");

    if (
      segments.length === 0 ||
      segments.some((segment: string) => !isPhpIdentifier(segment))
    ) {
      continue;
    }

    const fqn = `${root.namespace}${segments.join("\\")}`;
    const match = bestPsr4Match(psr4Roots, fqn);

    if (!match || normalizeDirectory(match.directory) !== directory) {
      continue;
    }

    const shortName = segments[segments.length - 1];

    if (!shortName) {
      continue;
    }

    const namespaceSegments = segments.slice(0, -1);
    const rootNamespace = root.namespace.replace(/^\\+|\\+$/g, "");
    const namespace = [rootNamespace, ...namespaceSegments]
      .filter(Boolean)
      .join("\\");

    return {
      content: renderPhpTypeSkeleton("class", shortName, namespace || null),
    };
  }

  return null;
}

function normalizeDirectory(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isPhpIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
