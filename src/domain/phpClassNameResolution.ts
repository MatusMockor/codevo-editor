export function resolvePhpClassName(
  source: string,
  className: string,
): string | null {
  const trimmedClassName = className.trim();
  const isFullyQualified = trimmedClassName.startsWith("\\");
  const normalizedClassName = trimmedClassName.replace(/^\\+/, "");

  if (!normalizedClassName) {
    return null;
  }

  const imports = phpUseImports(source);
  const [firstSegment, ...remainingSegments] = normalizedClassName.split("\\");
  const importedName = imports.get(firstSegment.toLowerCase());

  if (importedName) {
    return [importedName, ...remainingSegments].join("\\");
  }

  if (isFullyQualified) {
    return normalizedClassName;
  }

  const namespace = phpNamespace(source);

  if (namespace) {
    return `${namespace}\\${normalizedClassName}`;
  }

  return normalizedClassName;
}

function phpUseImports(source: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importSource = source.slice(0, firstPhpTypeDeclarationOffset(source));

  for (const match of importSource.matchAll(/^\s*use\s+(?!function\b|const\b)([^;]+);/gm)) {
    const importName = (match[1] || "").trim();

    if (!importName) {
      continue;
    }

    if (importName.includes("{")) {
      for (const groupedImport of phpGroupedUseImports(importName)) {
        imports.set(groupedImport.alias.toLowerCase(), groupedImport.name);
      }

      continue;
    }

    const parsedImport = phpUseImport(importName);

    if (parsedImport) {
      imports.set(parsedImport.alias.toLowerCase(), parsedImport.name);
    }
  }

  return imports;
}

function phpGroupedUseImports(
  importName: string,
): Array<{ alias: string; name: string }> {
  const match = /^(.*?)\{([\s\S]+)\}$/.exec(importName.trim());
  const prefix = match?.[1]?.trim().replace(/\\+$/, "") ?? "";
  const body = match?.[2] ?? "";

  if (!prefix || !body) {
    return [];
  }

  return body
    .split(",")
    .map((entry) => phpUseImport(`${prefix}\\${entry.trim()}`))
    .filter((entry): entry is { alias: string; name: string } => Boolean(entry));
}

function phpUseImport(importName: string): { alias: string; name: string } | null {
  const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(importName);
  const fullyQualifiedName = (aliasMatch?.[1] || importName)
    .trim()
    .replace(/^\\+/, "");
  const alias = aliasMatch?.[2] || shortPhpName(fullyQualifiedName);

  if (!fullyQualifiedName || !alias) {
    return null;
  }

  return { alias, name: fullyQualifiedName };
}

function firstPhpTypeDeclarationOffset(source: string): number {
  const match = /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+/m.exec(
    source,
  );

  return match?.index ?? source.length;
}

function phpNamespace(source: string): string | null {
  const match = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  return match?.[1]?.trim().replace(/^\\+/, "") || null;
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}
