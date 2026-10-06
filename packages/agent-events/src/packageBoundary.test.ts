import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(process.cwd(), "packages/agent-events");
const sourceRoot = resolve(packageRoot, "src");
const forbiddenGlobals = new Set([
  "Intl",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "fetch",
  "window",
  "document",
  "navigator",
  "localStorage",
  "process",
  "Buffer",
  "require",
  "__dirname",
  "globalThis",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function isInsideSource(path: string): boolean {
  const pathFromSource = relative(sourceRoot, path);
  return pathFromSource !== ".." && !pathFromSource.startsWith(`..${sep}`);
}

function importSpecifiers(source: string): string[] {
  const staticImports = Array.from(
    source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g),
    (match) => match[1],
  );
  const dynamicImports = Array.from(
    source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    (match) => match[1],
  );
  return [...staticImports, ...dynamicImports];
}

function resolveImport(file: string, specifier: string): string {
  const path = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
  const candidates = [path];
  const target = candidates.find((candidate) => {
    if (!isInsideSource(candidate)) return false;
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  expect(target, `${file}: unresolved import ${specifier}`).toBeDefined();
  return target ?? path;
}

describe("agent-events package boundary", () => {
  const files = sourceFiles(sourceRoot);
  const productionFiles = files.filter(
    (file) => !file.endsWith(".test.ts") && !file.endsWith(".d.ts"),
  );

  it("contains only relative imports within its source boundary", () => {
    for (const file of productionFiles) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        expect(specifier, file).toMatch(/^\.\.?\//);
        expect(specifier, file).toMatch(/\.js$/);
        expect(isInsideSource(resolve(dirname(file), specifier)), file).toBe(true);
        expect(productionFiles, file).toContain(resolveImport(file, specifier));
      }
    }
  });

  it("contains only the approved host declaration file", () => {
    expect(files.filter((file) => file.endsWith(".d.ts"))).toEqual([
      resolve(sourceRoot, "hostGlobals.d.ts"),
    ]);
  });

  it("contains no reference directives or dynamic imports", () => {
    for (const file of productionFiles) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/^\s*\/\/\/\s*<reference\b/m);
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      expect(source.referencedFiles, file).toEqual([]);
      expect(source.typeReferenceDirectives, file).toEqual([]);
      expect(source.libReferenceDirectives, file).toEqual([]);
      expect(source.hasNoDefaultLib, file).toBe(false);
      const dynamicImports: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          dynamicImports.push(node.getText(source));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(dynamicImports, file).toEqual([]);
    }
  });

  it("has no React source or runtime dependencies", () => {
    expect(files.filter((file) => file.endsWith(".tsx"))).toEqual([]);
    const manifest: Record<string, unknown> = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    );
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it("exposes every production module through the public entry point", () => {
    const reachable = new Set<string>();
    const pending = [resolve(sourceRoot, "index.ts")];
    while (pending.length > 0) {
      const file = pending.pop();
      if (!file || reachable.has(file)) continue;
      reachable.add(file);
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        pending.push(resolveImport(file, specifier));
      }
    }
    expect(productionFiles.filter((file) => !reachable.has(file))).toEqual([]);
  });

  it("uses only TextEncoder and TextDecoder as host APIs", () => {
    const program = ts.createProgram(productionFiles, {
      noLib: true,
      noResolve: true,
    });
    const checker = program.getTypeChecker();
    const violations: string[] = [];
    for (const file of productionFiles) {
      const source = program.getSourceFile(file);
      if (!source) throw new Error(`Missing source file: ${file}`);
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) {
          const symbol = checker.getSymbolAtLocation(node);
          const isLocal = symbol?.declarations?.some(
            (declaration) => declaration.getSourceFile() === source,
          );
          if (!isLocal) violations.push(`${relative(sourceRoot, file)}: ${node.text}`);
        }
        if (ts.isPropertyAccessExpression(node)) {
          const isForbiddenMethod = ["normalize", "localeCompare"].includes(node.name.text);
          const isDateNow =
            ts.isIdentifier(node.expression) &&
            node.expression.text === "Date" &&
            node.name.text === "now";
          if (isForbiddenMethod || isDateNow) {
            violations.push(`${relative(sourceRoot, file)}: ${node.getText(source)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
    const ambient = readFileSync(resolve(sourceRoot, "hostGlobals.d.ts"), "utf8");
    const declaredGlobals = Array.from(
      ambient.matchAll(/\bdeclare\s+(?:class|const|var|function)\s+(\w+)/g),
      (match) => match[1],
    );
    expect(declaredGlobals.sort()).toEqual(["TextDecoder", "TextEncoder"]);
  });
});
