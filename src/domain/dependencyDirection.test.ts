import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("domain dependency direction", () => {
  const domainDirectory = join(process.cwd(), "src", "domain");
  const applicationDirectory = join(process.cwd(), "src", "application");
  const domainFiles = productionTypeScriptFiles(domainDirectory);
  const applicationFiles = productionTypeScriptFiles(applicationDirectory);
  const legacyExceptions = new Set([
    "useLanguageServerFeatureErrorReporting.ts -> ../infrastructure/globalErrorSafetyNet",
    "useWorkbenchController.ts -> ../components/composerManifestMonacoProviders",
    "useWorkbenchController.ts -> ../components/npmManifestMonacoProviders",
    "useWorkbenchController.ts -> ../infrastructure/globalErrorSafetyNet",
    "useWorkbenchController.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
    "useWorkbenchNativeMenuCommands.ts -> ../infrastructure/safeUnsubscribe",
    "useWorkbenchPintCommand.ts -> ../infrastructure/tauriPintGateway",
    "useWorkspaceStateCache.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentAttachmentGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentTaskGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentHistoryGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentHistoryCatalogGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriExternalSessionImportGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriAgentTurnLogGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriDebugGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriEslintDiagnosticsGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriExternalSessionGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriGitIntegrationGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriGitWorktreeGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriPhpSyntaxDiagnosticsGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriPhpstanDiagnosticsGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriPintGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/tauriPrettierGateway",
    "workbenchDefaultGateways.ts -> ../infrastructure/webviewAgentImageSurface",
    "workbenchOwnerDocumentSaveAdapters.ts -> ../infrastructure/tauriWorkspaceIdentityGateway",
  ]);

  it.each(domainFiles.map((fileName) => relative(domainDirectory, fileName)))(
    "keeps production domain module %s independent from outer layers",
    (relativePath) => {
      const fileName = join(domainDirectory, relativePath);
      const source = readFileSync(fileName, "utf8");
      const violations = moduleSpecifiers(source, fileName)
        .filter((specifier) =>
          /(?:^|\/)(?:application|components|infrastructure)(?:\/|$)/.test(specifier),
        )
        .map((specifier) => `${relativePath} -> ${specifier}`);
      expect(violations).toEqual([]);
    },
  );

  it("retains a production file for every legacy application exception", () => {
    const existingFiles = new Set(
      applicationFiles.map((fileName) => relative(applicationDirectory, fileName)),
    );
    const missing = [...legacyExceptions].filter(
      (exception) => !existingFiles.has(exception.split(" -> ")[0]),
    );
    expect(missing).toEqual([]);
  });

  it.each(applicationFiles.map((fileName) => relative(applicationDirectory, fileName)))(
    "ratchets application imports in %s away from UI and infrastructure layers",
    (relativePath) => {
      const fileName = join(applicationDirectory, relativePath);
      const source = readFileSync(fileName, "utf8");
      const outerLayerDependencies = moduleSpecifiers(source, fileName)
        .filter((specifier) => /(?:^|\/)(?:components|infrastructure)(?:\/|$)/.test(specifier))
        .map((specifier) => `${relativePath} -> ${specifier}`);
      const expected = [...legacyExceptions].filter((exception) =>
        exception.startsWith(`${relativePath} -> `),
      );
      expect([...new Set(outerLayerDependencies)].sort()).toEqual(expected.sort());
    },
  );
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
