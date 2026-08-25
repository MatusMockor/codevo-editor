import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("domain dependency direction", () => {
  it("keeps production domain modules independent from outer layers", () => {
    const domainDirectory = join(process.cwd(), "src", "domain");
    const violations = productionTypeScriptFiles(domainDirectory).flatMap((fileName) => {
      const source = readFileSync(fileName, "utf8");
      return moduleSpecifiers(source, fileName)
        .filter((specifier) =>
          /(?:^|\/)(?:application|components|infrastructure)(?:\/|$)/.test(specifier),
        )
        .map((specifier) => `${relative(domainDirectory, fileName)} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("ratchets application imports away from UI and infrastructure layers", () => {
    const applicationDirectory = join(process.cwd(), "src", "application");
    const legacyExceptions = new Set([
      "useLanguageServerFeatureErrorReporting.ts -> ../infrastructure/globalErrorSafetyNet",
      "useWorkbenchCloseLifecycle.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
      "useWorkbenchController.ts -> ../components/composerManifestMonacoProviders",
      "useWorkbenchController.ts -> ../components/npmManifestMonacoProviders",
      "useWorkbenchController.ts -> ../infrastructure/globalErrorSafetyNet",
      "useWorkbenchController.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
      "useWorkbenchNativeMenuCommands.ts -> ../infrastructure/safeUnsubscribe",
      "useWorkbenchPintCommand.ts -> ../infrastructure/tauriPintGateway",
      "useWorkspaceStateCache.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentTaskGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentThreadStoreGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriDebugGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriEslintDiagnosticsGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriGitIntegrationGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriGitWorktreeGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriPhpSyntaxDiagnosticsGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriPhpstanDiagnosticsGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriPintGateway",
      "workbenchDefaultGateways.ts -> ../infrastructure/tauriPrettierGateway",
      "workbenchOwnerDocumentSaveAdapters.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
    ]);
    const outerLayerDependencies = productionTypeScriptFiles(applicationDirectory).flatMap(
      (fileName) => {
        const source = readFileSync(fileName, "utf8");
        return moduleSpecifiers(source, fileName)
          .filter((specifier) => /(?:^|\/)(?:components|infrastructure)(?:\/|$)/.test(specifier))
          .map((specifier) => `${relative(applicationDirectory, fileName)} -> ${specifier}`);
      },
    );

    expect([...new Set(outerLayerDependencies)].sort()).toEqual([...legacyExceptions].sort());
  });
});

function moduleSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}
