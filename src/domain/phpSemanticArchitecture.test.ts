import {
  mkdirSync,
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
  /(?:Blade|Eloquent|Framework|Laravel|Latte|Neon|Nette)/i;
const CONCRETE_FRAMEWORK_MARKER_PREFIXES: readonly string[] = [
  "blade",
  "eloquent",
  "illuminate",
  "laravel",
  "latte",
  "neon",
  "nette",
];
const UNAMBIGUOUS_FRAMEWORK_TOKENS = new Set<string>([
  "eloquent",
  "illuminate",
  "laravel",
  "nette",
]);
const CONTEXTUAL_FRAMEWORK_TOKENS = new Map<string, ReadonlySet<string>>([
  [
    "blade",
    new Set([
      "adapter",
      "capability",
      "component",
      "completion",
      "compiler",
      "core",
      "diagnostic",
      "directive",
      "framework",
      "parser",
      "provider",
      "resolver",
      "service",
      "template",
      "view",
    ]),
  ],
  [
    "latte",
    new Set([
      "adapter",
      "capability",
      "completion",
      "core",
      "diagnostic",
      "engine",
      "framework",
      "lexer",
      "macro",
      "parser",
      "provider",
      "resolver",
      "template",
    ]),
  ],
  [
    "neon",
    new Set([
      "adapter",
      "capability",
      "completion",
      "config",
      "core",
      "diagnostic",
      "decoder",
      "framework",
      "parser",
      "provider",
      "reader",
      "resolver",
      "schema",
    ]),
  ],
]);
const PHP_NEUTRAL_FRAMEWORK_BOUNDARY_ROLE =
  /Capabilit(?:y|ies)|(?:Core|Selection|Dispatch|ProviderFeatures?|Contracts?)$/;
const EXISTING_PROVIDER_BOUNDARY_EDGES = new Set<string>([
  "domain/phpFrameworkLiteralDispatch.ts -> ./phpFrameworkProviders",
  "domain/phpFrameworkMemberDispatch.ts -> ./phpFrameworkProviders",
  "domain/phpFrameworkSemanticContracts.ts -> embedded supportsEloquentModelSemantics",
  "domain/phpFrameworkSemanticContracts.ts -> embedded supportsNetteDatabaseSemantics",
  "domain/phpFrameworkTargetCapabilities.ts -> ./phpFrameworkProviders",
  "domain/phpFrameworkTemplateDispatch.ts -> ./phpFrameworkProviders",
  "domain/phpFrameworkValidationDispatch.ts -> ./phpFrameworkProviders",
]);

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

function isNeutralFrameworkBoundaryModule(fileName: string): boolean {
  if (!fileName.endsWith(".ts") || fileName.endsWith(".test.ts")) {
    return false;
  }

  const moduleName = fileName.slice(0, -".ts".length);

  if (
    !moduleName.startsWith("phpFramework") ||
    isConcreteFrameworkModule(`./${moduleName}`) ||
    /Adapters?$/.test(moduleName)
  ) {
    return false;
  }

  return (
    moduleName === "phpFrameworkPlugin" ||
    PHP_NEUTRAL_FRAMEWORK_BOUNDARY_ROLE.test(moduleName)
  );
}

function neutralFrameworkBoundaryPaths(
  sourceRoot: string,
  tree: SourceTree,
): string[] {
  return ["application", "domain"]
    .flatMap((directory) => {
      const directoryPath = join(sourceRoot, directory);

      return tree
        .list(directoryPath)
        .filter(isNeutralFrameworkBoundaryModule)
        .map((fileName) => join(directoryPath, fileName));
    })
    .sort((left, right) => left.localeCompare(right));
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

function identifierTokens(value: string): string[] {
  return value
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) =>
      part.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g) ??
      [],
    )
    .map((token) => token.toLowerCase());
}

function containsConcreteFrameworkTokens(tokens: readonly string[]): boolean {
  if (tokens.some((token) => UNAMBIGUOUS_FRAMEWORK_TOKENS.has(token))) {
    return true;
  }

  if (
    tokens.length === 1 &&
    CONTEXTUAL_FRAMEWORK_TOKENS.has(tokens[0] ?? "")
  ) {
    return true;
  }

  return tokens.some((token) => {
    const requiredContext = CONTEXTUAL_FRAMEWORK_TOKENS.get(token);

    if (!requiredContext) {
      return false;
    }

    return tokens.some((candidate) => requiredContext.has(candidate));
  });
}

function isConcreteFrameworkModule(moduleSpecifier: string): boolean {
  const stem = normalizedModuleStem(moduleSpecifier);
  const segments = stem.split("/").filter(Boolean);
  const moduleName = segments[segments.length - 1] ?? stem;

  return (
    segments.some((segment) =>
      containsConcreteFrameworkTokens(identifierTokens(segment)),
    ) ||
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
  const markers = discoveredModulePaths(entryPaths, tree).flatMap(
    (sourcePath) => embeddedFrameworkMarkersInFile(sourcePath, tree),
  );

  return markers.sort((left, right) =>
    embeddedMarkerLabel(left, tree.sourceRoot).localeCompare(
      embeddedMarkerLabel(right, tree.sourceRoot),
    ),
  );
}

function embeddedFrameworkMarkersInFile(
  sourcePath: string,
  tree: SourceTree,
): EmbeddedFrameworkMarker[] {
  const markers: EmbeddedFrameworkMarker[] = [];
  const markerKeys = new Set<string>();
  const sourceFile = ts.createSourceFile(
    sourcePath,
    tree.read(sourcePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  inspectNode(sourceFile);

  return markers;

  function inspectNode(node: ts.Node): void {
    if (
      ts.isIdentifier(node) &&
      isConcreteFrameworkIdentifier(node.text)
    ) {
      addMarker(node.text);
    }

    if (
      ts.isStringLiteralLike(node) &&
      !isModuleSpecifier(node) &&
      isConcreteFrameworkStringMarker(node.text)
    ) {
      addMarker(JSON.stringify(node.text));
    }

    ts.forEachChild(node, inspectNode);
  }

  function addMarker(marker: string): void {
    if (markerKeys.has(marker)) {
      return;
    }

    markerKeys.add(marker);
    markers.push({ marker, sourcePath });
  }
}

function isConcreteFrameworkStringMarker(value: string): boolean {
  const normalized = value.toLowerCase();

  return CONCRETE_FRAMEWORK_MARKER_PREFIXES.some((prefix) => {
    if (normalized === prefix) {
      return true;
    }

    if (!normalized.startsWith(prefix)) {
      return false;
    }

    const boundary = value[prefix.length];

    if (
      boundary !== ":" &&
      boundary !== "-" &&
      boundary !== "_" &&
      boundary !== "\\" &&
      boundary === boundary?.toLowerCase()
    ) {
      return false;
    }

    if (UNAMBIGUOUS_FRAMEWORK_TOKENS.has(prefix)) {
      return true;
    }

    return containsConcreteFrameworkTokens(identifierTokens(value));
  });
}

function isConcreteFrameworkIdentifier(identifier: string): boolean {
  return containsConcreteFrameworkTokens(identifierTokens(identifier));
}

function providerBoundaryViolationLabels(
  boundaryPaths: readonly string[],
  tree: SourceTree,
): string[] {
  const violations: string[] = [];

  for (const sourcePath of boundaryPaths) {
    for (const moduleSpecifier of moduleSpecifiers(
      tree.read(sourcePath),
      sourcePath,
    )) {
      if (!isConcreteFrameworkModule(moduleSpecifier)) {
        continue;
      }

      const importer = relative(tree.sourceRoot, sourcePath)
        .split("\\")
        .join("/");
      violations.push(`${importer} -> ${moduleSpecifier}`);
    }

    for (const marker of embeddedFrameworkMarkersInFile(sourcePath, tree)) {
      violations.push(embeddedMarkerLabel(marker, tree.sourceRoot));
    }
  }

  return violations.sort((left, right) => left.localeCompare(right));
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
  it("does not let concrete framework knowledge grow across neutral provider boundaries", () => {
    const tree = diskSourceTree(SOURCE_ROOT);
    const boundaryPaths = neutralFrameworkBoundaryPaths(SOURCE_ROOT, tree);
    const observedViolations = providerBoundaryViolationLabels(
      boundaryPaths,
      tree,
    );
    const newViolations = observedViolations.filter(
      (label) => !EXISTING_PROVIDER_BOUNDARY_EDGES.has(label),
    );
    const staleAllowances = [...EXISTING_PROVIDER_BOUNDARY_EDGES].filter(
      (label) => !observedViolations.includes(label),
    );

    expect(newViolations).toEqual([]);
    expect(staleAllowances).toEqual([]);
  });

  it("allows generic provider terminology while detecting concrete provider leakage", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "codevo-provider-boundary-"),
    );

    try {
      const cleanBoundaryPath = join(
        fixtureRoot,
        "phpFrameworkCapabilityRegistry.ts",
      );
      const leakyBoundaryPath = join(
        fixtureRoot,
        "phpFrameworkProviderCore.ts",
      );

      writeFileSync(
        cleanBoundaryPath,
        [
          "export interface FrameworkProvider { readonly capability: string; }",
          "export const genericFramework = 'framework-provider';",
          "export const eloquentlyNamedCapability = 'eloquent prose';",
          "export const BladeRunner = 'unrelated proper name';",
          "export const latteArt = 'coffee';",
          "export const neonLight = 'sign';",
          "export const movieTitle = 'BladeRunner';",
          "export const coffeeStyle = 'latteArt';",
          "export const signKind = 'neonLight';",
        ].join("\n"),
      );
      writeFileSync(
        leakyBoundaryPath,
        [
          "import { provider } from './laravel/provider';",
          "import './latte/provider';",
          "import { semantics } from '@vendor/phpEloquentSemantics';",
          "import '@vendor/blade-core';",
          "import '@vendor/blade-compiler';",
          "import '@vendor/phpBladeAdapter';",
          "import '@vendor/phpBladeCompiler';",
          "import '@vendor/latte-lexer';",
          "import '@vendor/phpLatteAdapter';",
          "import '@vendor/phpLatteLexer';",
          "import '@vendor/neon-decoder';",
          "import '@vendor/neon-parser';",
          "import '@vendor/phpNeonAdapter';",
          "import '@vendor/phpNeonDecoder';",
          "import type { Database } from '@nette/database';",
          "export const bladeService = null;",
          "export const bladeCompiler = null;",
          "export const latteEngine = null;",
          "export const latteLexer = null;",
          "export const neonDecoder = null;",
          "export const neonReader = null;",
          "export type PhpBladeCapability = unknown;",
          "export type PhpLaravelCapability = typeof provider;",
          "export const NeonParser = null;",
          "export const phpEloquentResolver = semantics;",
          "export const phpLatteResolver = null;",
          "export const netteDatabaseSemantics: Database | null = null;",
        ].join("\n"),
      );

      const tree = diskSourceTree(fixtureRoot);

      expect(
        providerBoundaryViolationLabels([cleanBoundaryPath], tree),
      ).toEqual([]);
      expect(
        providerBoundaryViolationLabels([leakyBoundaryPath], tree),
      ).toEqual([
        "phpFrameworkProviderCore.ts -> ./laravel/provider",
        "phpFrameworkProviderCore.ts -> ./latte/provider",
        "phpFrameworkProviderCore.ts -> @nette/database",
        "phpFrameworkProviderCore.ts -> @vendor/blade-compiler",
        "phpFrameworkProviderCore.ts -> @vendor/blade-core",
        "phpFrameworkProviderCore.ts -> @vendor/latte-lexer",
        "phpFrameworkProviderCore.ts -> @vendor/neon-decoder",
        "phpFrameworkProviderCore.ts -> @vendor/neon-parser",
        "phpFrameworkProviderCore.ts -> @vendor/phpBladeAdapter",
        "phpFrameworkProviderCore.ts -> @vendor/phpBladeCompiler",
        "phpFrameworkProviderCore.ts -> @vendor/phpEloquentSemantics",
        "phpFrameworkProviderCore.ts -> @vendor/phpLatteAdapter",
        "phpFrameworkProviderCore.ts -> @vendor/phpLatteLexer",
        "phpFrameworkProviderCore.ts -> @vendor/phpNeonAdapter",
        "phpFrameworkProviderCore.ts -> @vendor/phpNeonDecoder",
        "phpFrameworkProviderCore.ts -> embedded bladeCompiler",
        "phpFrameworkProviderCore.ts -> embedded bladeService",
        "phpFrameworkProviderCore.ts -> embedded latteEngine",
        "phpFrameworkProviderCore.ts -> embedded latteLexer",
        "phpFrameworkProviderCore.ts -> embedded neonDecoder",
        "phpFrameworkProviderCore.ts -> embedded NeonParser",
        "phpFrameworkProviderCore.ts -> embedded neonReader",
        "phpFrameworkProviderCore.ts -> embedded netteDatabaseSemantics",
        "phpFrameworkProviderCore.ts -> embedded PhpBladeCapability",
        "phpFrameworkProviderCore.ts -> embedded phpEloquentResolver",
        "phpFrameworkProviderCore.ts -> embedded PhpLaravelCapability",
        "phpFrameworkProviderCore.ts -> embedded phpLatteResolver",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("discovers neutral framework boundaries while excluding concrete implementations", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "codevo-provider-boundary-discovery-"),
    );

    try {
      const applicationRoot = join(fixtureRoot, "application");
      const domainRoot = join(fixtureRoot, "domain");
      const fixturePaths = [
        "application/phpFrameworkPlugin.ts",
        "application/phpFrameworkPluginContract.ts",
        "domain/phpFrameworkCapabilityRegistry.ts",
        "domain/phpFrameworkLiteralDispatch.ts",
        "domain/phpFrameworkProviderCore.ts",
        "domain/phpFrameworkProviderFeature.ts",
        "domain/phpFrameworkProviderSelection.ts",
        "domain/phpFrameworkSemanticContracts.ts",
      ];

      mkdirSync(applicationRoot);
      mkdirSync(domainRoot);

      for (const fixturePath of fixturePaths) {
        writeFileSync(join(fixtureRoot, fixturePath), "export {};\n");
      }

      for (const excludedPath of [
        "application/phpFrameworkPluginCatalog.ts",
        "application/phpLaravelFrameworkPlugin.ts",
        "domain/phpFrameworkProviderAdapter.ts",
        "domain/phpFrameworkProviderCore.test.ts",
        "domain/phpFrameworkProviders.ts",
        "domain/phpFrameworkLaravelProviderCore.ts",
      ]) {
        writeFileSync(join(fixtureRoot, excludedPath), "export {};\n");
      }

      const tree = diskSourceTree(fixtureRoot);

      expect(
        neutralFrameworkBoundaryPaths(fixtureRoot, tree).map((path) =>
          relative(fixtureRoot, path).split("\\").join("/"),
        ),
      ).toEqual(fixturePaths);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

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
