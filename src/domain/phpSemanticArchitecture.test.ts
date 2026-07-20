import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DOMAIN_ROOT = join(SOURCE_ROOT, "domain");

const PHP_SEMANTIC_CORE_FOUNDATIONS = new Set<string>([
  "phpClassNameResolution.ts",
  "phpDocTemplates.ts",
  "phpParameterTypes.ts",
  "phpReceiverExpressions.ts",
  "phpTypeAnalysis.ts",
  "phpTypes.ts",
]);

const PHP_SEMANTIC_CORE_PREFIX =
  /^php(?:ExpressionType|Inheritance|Member|Oop|Semantic|Symbol)/;
const PHP_FRAMEWORK_ADAPTER_NAME =
  /(?:Blade|Framework|Laravel|Latte|Neon|Nette)/i;

const EXISTING_FRAMEWORK_EDGES: readonly string[] = [
  'domain/snippets.ts -> embedded "blade"',
  'domain/snippets.ts -> embedded "latte"',
  "domain/snippets.ts -> embedded BLADE",
  "domain/snippets.ts -> embedded LATTE",
  'domain/workspace.ts -> embedded "blade"',
  'domain/workspace.ts -> embedded "latte"',
  'domain/workspace.ts -> embedded "neon"',
  "domain/workspace.ts -> embedded latte",
  "domain/workspace.ts -> embedded neon",
];

interface ArchitectureViolation {
  chain: string[];
  importerPath: string;
  moduleSpecifier: string;
}

interface EmbeddedFrameworkMarker {
  marker: string;
  sourcePath: string;
}

interface SourceTree {
  list(path: string): string[];
  read(path: string): string;
  sourceRoot: string;
}

function isPhpSemanticCoreModule(fileName: string): boolean {
  if (!fileName.endsWith(".ts") || fileName.endsWith(".test.ts")) {
    return false;
  }

  if (PHP_FRAMEWORK_ADAPTER_NAME.test(fileName)) {
    return false;
  }

  return (
    PHP_SEMANTIC_CORE_FOUNDATIONS.has(fileName) ||
    PHP_SEMANTIC_CORE_PREFIX.test(fileName)
  );
}

function phpSemanticCoreEntryPaths(
  domainRoot: string,
  tree: SourceTree,
): string[] {
  return tree
    .list(domainRoot)
    .filter(isPhpSemanticCoreModule)
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => join(domainRoot, fileName));
}

function moduleSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
      continue;
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression)
    ) {
      specifiers.push(statement.moduleReference.expression.text);
    }
  }

  return specifiers;
}

function normalizedModuleStem(moduleSpecifier: string): string {
  return moduleSpecifier
    .split("\\")
    .join("/")
    .replace(/\.(?:[cm]?[jt]sx?)$/i, "")
    .replace(/\/index$/i, "");
}

function isConcreteFrameworkModule(moduleSpecifier: string): boolean {
  const stem = normalizedModuleStem(moduleSpecifier);
  const segments = stem.split("/");
  const moduleName = segments[segments.length - 1] ?? stem;

  return (
    /^(?:blade|laravel|latte|neon|nette)/i.test(moduleName) ||
    /^php(?:framework)?(?:laravel|nette)/i.test(moduleName) ||
    /^(?:phpFrameworkProviders|phpNavigation)$/i.test(moduleName)
  );
}

function resolveLocalModule(
  importerPath: string,
  moduleSpecifier: string,
): string | null {
  if (!moduleSpecifier.startsWith(".")) {
    return null;
  }

  const unresolved = resolve(dirname(importerPath), moduleSpecifier);
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    join(unresolved, "index.ts"),
    join(unresolved, "index.tsx"),
  ];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // A source tree may intentionally omit a fixture candidate.
    }
  }

  return null;
}

function frameworkViolations(
  entryPaths: readonly string[],
  tree: SourceTree,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const entryPath of entryPaths) {
    inspectModule(entryPath, [entryPath], new Set<string>());
  }

  return violations.sort((left, right) =>
    violationLabel(left, tree.sourceRoot).localeCompare(
      violationLabel(right, tree.sourceRoot),
    ),
  );

  function inspectModule(
    importerPath: string,
    chain: string[],
    visited: Set<string>,
  ): void {
    if (visited.has(importerPath)) {
      return;
    }

    const nextVisited = new Set(visited).add(importerPath);
    const source = tree.read(importerPath);

    for (const moduleSpecifier of moduleSpecifiers(source, importerPath)) {
      const importedPath = resolveLocalModule(importerPath, moduleSpecifier);

      if (isConcreteFrameworkModule(moduleSpecifier)) {
        violations.push({ chain, importerPath, moduleSpecifier });
        continue;
      }

      if (!importedPath) {
        continue;
      }

      inspectModule(importedPath, [...chain, importedPath], nextVisited);
    }
  }
}

function discoveredModulePaths(
  entryPaths: readonly string[],
  tree: SourceTree,
): string[] {
  const discovered = new Set<string>();

  for (const entryPath of entryPaths) {
    visit(entryPath);
  }

  return [...discovered];

  function visit(sourcePath: string): void {
    if (discovered.has(sourcePath)) {
      return;
    }

    discovered.add(sourcePath);

    for (const moduleSpecifier of moduleSpecifiers(
      tree.read(sourcePath),
      sourcePath,
    )) {
      if (isConcreteFrameworkModule(moduleSpecifier)) {
        continue;
      }

      const importedPath = resolveLocalModule(sourcePath, moduleSpecifier);

      if (!importedPath) {
        continue;
      }

      visit(importedPath);
    }
  }
}

function embeddedFrameworkMarkers(
  entryPaths: readonly string[],
  tree: SourceTree,
): EmbeddedFrameworkMarker[] {
  const markers: EmbeddedFrameworkMarker[] = [];
  const markerKeys = new Set<string>();

  for (const sourcePath of discoveredModulePaths(entryPaths, tree)) {
    const source = tree.read(sourcePath);
    const sourceFile = ts.createSourceFile(
      sourcePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    inspectNode(sourceFile);

    function inspectNode(node: ts.Node): void {
      if (
        ts.isIdentifier(node) &&
        /^(?:blade|illuminate|laravel|latte|neon|nette)(?:[A-Z_]|$)/i.test(
          node.text,
        )
      ) {
        addMarker(node.text);
      }

      if (
        ts.isStringLiteralLike(node) &&
        !isModuleSpecifier(node) &&
        /^(?:blade|illuminate|laravel|latte|neon|nette)(?::|[-_A-Z\\]|$)/i.test(
          node.text,
        )
      ) {
        addMarker(JSON.stringify(node.text));
      }

      ts.forEachChild(node, inspectNode);
    }

    function addMarker(marker: string): void {
      const key = `${sourcePath}\0${marker}`;

      if (markerKeys.has(key)) {
        return;
      }

      markerKeys.add(key);
      markers.push({ marker, sourcePath });
    }
  }

  return markers.sort((left, right) =>
    embeddedMarkerLabel(left, tree.sourceRoot).localeCompare(
      embeddedMarkerLabel(right, tree.sourceRoot),
    ),
  );
}

function isModuleSpecifier(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;

  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  ) {
    return true;
  }

  return ts.isExternalModuleReference(parent) && parent.expression === node;
}

function embeddedMarkerLabel(
  marker: EmbeddedFrameworkMarker,
  sourceRoot: string,
): string {
  const sourcePath = relative(sourceRoot, marker.sourcePath)
    .split("\\")
    .join("/");

  return `${sourcePath} -> embedded ${marker.marker}`;
}

function architectureViolationLabels(
  entries: readonly string[],
  tree: SourceTree,
): string[] {
  return [
    ...frameworkViolations(entries, tree).map((violation) =>
      violationLabel(violation, tree.sourceRoot),
    ),
    ...embeddedFrameworkMarkers(entries, tree).map((marker) =>
      embeddedMarkerLabel(marker, tree.sourceRoot),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function violationLabel(
  violation: ArchitectureViolation,
  sourceRoot: string,
): string {
  const entryPath = violation.chain[0] ?? violation.importerPath;
  const importer = relative(sourceRoot, entryPath).split("\\").join("/");
  const chain = violation.chain
    .slice(1)
    .map((path) => relative(sourceRoot, path).split("\\").join("/"));
  const via = chain.length > 0 ? ` via ${chain.join(" -> ")}` : "";

  return `${importer} -> ${violation.moduleSpecifier}${via}`;
}

function diskSourceTree(sourceRoot: string): SourceTree {
  return {
    list: (path) => readdirSync(path),
    read: (path) => readFileSync(path, "utf8"),
    sourceRoot,
  };
}

describe("PHP semantic core dependency architecture", () => {
  it("keeps the complete discovered OOP core graph free from framework implementations", () => {
    const tree = diskSourceTree(SOURCE_ROOT);
    const entries = phpSemanticCoreEntryPaths(DOMAIN_ROOT, tree);
    const newViolations = architectureViolationLabels(entries, tree).filter(
      (label) => !EXISTING_FRAMEWORK_EDGES.includes(label),
    );

    expect(newViolations).toEqual([]);
  });

  it("discovers new semantic core modules while excluding framework adapters", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "codevo-php-core-discovery-"),
    );

    try {
      const newCorePath = join(fixtureRoot, "phpMemberResolution.ts");
      const adapterPath = join(fixtureRoot, "phpSemanticNetteAdapter.ts");
      const unrelatedPath = join(fixtureRoot, "phpMoveStatement.ts");
      const frameworkPath = join(fixtureRoot, "phpFrameworkNetteProvider.ts");

      writeFileSync(
        newCorePath,
        "import { provider } from './phpFrameworkNetteProvider';\nexport const member = provider;\n",
      );
      writeFileSync(
        adapterPath,
        "import { provider } from './phpFrameworkNetteProvider';\nexport const adapter = provider;\n",
      );
      writeFileSync(unrelatedPath, "export const moveStatement = true;\n");
      writeFileSync(frameworkPath, "export const provider = {};\n");

      const tree = diskSourceTree(fixtureRoot);
      const entries = phpSemanticCoreEntryPaths(fixtureRoot, tree);

      expect(entries.map((path) => relative(fixtureRoot, path))).toEqual([
        "phpMemberResolution.ts",
      ]);
      expect(architectureViolationLabels(entries, tree)).toEqual([
        "phpMemberResolution.ts -> ./phpFrameworkNetteProvider",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("does not let discovered semantic-core framework debt grow", () => {
    const tree = diskSourceTree(SOURCE_ROOT);
    const entries = phpSemanticCoreEntryPaths(DOMAIN_ROOT, tree);

    expect(architectureViolationLabels(entries, tree)).toEqual(
      EXISTING_FRAMEWORK_EDGES,
    );
  });

  it("detects direct and ordinary indirect framework imports without text false positives", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "codevo-php-architecture-"));

    try {
      const cleanCorePath = join(fixtureRoot, "cleanCore.ts");
      const directCorePath = join(fixtureRoot, "directCore.ts");
      const indirectCorePath = join(fixtureRoot, "indirectCore.ts");
      const helperPath = join(fixtureRoot, "semanticHelper.ts");
      const frameworkPath = join(fixtureRoot, "phpFrameworkLaravelProvider.ts");

      writeFileSync(
        cleanCorePath,
        [
          "// import './phpFrameworkLaravelProvider';",
          "const example = \"export * from './phpFrameworkNetteProvider'\";",
          "export { example };",
        ].join("\n"),
      );
      writeFileSync(
        directCorePath,
        "import type { Provider } from './phpFrameworkLaravelProvider';\n",
      );
      writeFileSync(
        indirectCorePath,
        "import { resolveType } from './semanticHelper';\nexport { resolveType };\n",
      );
      writeFileSync(
        helperPath,
        "import { provider } from './phpFrameworkLaravelProvider';\nexport const resolveType = () => provider;\n",
      );
      writeFileSync(
        frameworkPath,
        "export interface Provider {}\nexport const provider = {};\n",
      );

      const tree = diskSourceTree(fixtureRoot);

      expect(frameworkViolations([cleanCorePath], tree)).toEqual([]);
      expect(
        frameworkViolations([directCorePath, indirectCorePath], tree).map(
          (violation) => violationLabel(violation, fixtureRoot),
        ),
      ).toEqual([
        "directCore.ts -> ./phpFrameworkLaravelProvider",
        "indirectCore.ts -> ./phpFrameworkLaravelProvider via semanticHelper.ts",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("detects framework-specific identifiers embedded directly in core", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "codevo-php-markers-"));

    try {
      const cleanCorePath = join(fixtureRoot, "cleanCore.ts");
      const leakyCorePath = join(fixtureRoot, "leakyCore.ts");

      writeFileSync(
        cleanCorePath,
        [
          "// const laravelResolver = true;",
          "const description = 'framework names in documentation are harmless';",
          "export const genericResolver = description;",
        ].join("\n"),
      );
      writeFileSync(
        leakyCorePath,
        [
          "export const laravelResolver = () => null;",
          "export const frameworkKind = 'netteDatabase';",
        ].join("\n"),
      );

      const tree = diskSourceTree(fixtureRoot);

      expect(embeddedFrameworkMarkers([cleanCorePath], tree)).toEqual([]);
      expect(
        embeddedFrameworkMarkers([leakyCorePath], tree).map((marker) =>
          embeddedMarkerLabel(marker, fixtureRoot),
        ),
      ).toEqual([
        'leakyCore.ts -> embedded "netteDatabase"',
        "leakyCore.ts -> embedded laravelResolver",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("detects framework FQN class-name strings embedded directly in core", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "codevo-php-fqn-markers-"));

    try {
      const leakyCorePath = join(fixtureRoot, "leakyCore.ts");

      writeFileSync(
        leakyCorePath,
        [
          'export const requestClass = "Illuminate\\\\Http\\\\Request";',
          'export const rowClass = "Nette\\\\Database\\\\Table\\\\ActiveRow";',
        ].join("\n"),
      );

      const tree = diskSourceTree(fixtureRoot);

      expect(
        embeddedFrameworkMarkers([leakyCorePath], tree).map((marker) =>
          embeddedMarkerLabel(marker, fixtureRoot),
        ),
      ).toEqual([
        'leakyCore.ts -> embedded "Illuminate\\\\Http\\\\Request"',
        'leakyCore.ts -> embedded "Nette\\\\Database\\\\Table\\\\ActiveRow"',
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("detects framework markers in transitively imported helpers", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "codevo-php-marker-transitive-"),
    );

    try {
      const corePath = join(fixtureRoot, "phpSemanticFuture.ts");
      const helperPath = join(fixtureRoot, "memberSupport.ts");

      writeFileSync(
        corePath,
        "export { rowClass } from './memberSupport';\n",
      );
      writeFileSync(
        helperPath,
        'export const rowClass = "Nette\\\\Database\\\\Table\\\\ActiveRow";\n',
      );

      const tree = diskSourceTree(fixtureRoot);
      const entries = phpSemanticCoreEntryPaths(fixtureRoot, tree);

      expect(entries.map((path) => relative(fixtureRoot, path))).toEqual([
        "phpSemanticFuture.ts",
      ]);
      expect(architectureViolationLabels(entries, tree)).toEqual([
        'memberSupport.ts -> embedded "Nette\\\\Database\\\\Table\\\\ActiveRow"',
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("detects framework-specific identifiers in newly discovered core dependencies", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "codevo-php-marker-graph-"));

    try {
      const corePath = join(fixtureRoot, "phpSemanticFuture.ts");
      const helperPath = join(fixtureRoot, "phpMemberTypeResolver.ts");

      writeFileSync(
        corePath,
        "export { resolveMember } from './phpMemberTypeResolver';\n",
      );
      writeFileSync(
        helperPath,
        "export const netteMemberResolver = () => null;\nexport const resolveMember = netteMemberResolver;\n",
      );

      const tree = diskSourceTree(fixtureRoot);
      const entries = phpSemanticCoreEntryPaths(fixtureRoot, tree);

      expect(architectureViolationLabels(entries, tree)).toEqual([
        "phpMemberTypeResolver.ts -> embedded netteMemberResolver",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
