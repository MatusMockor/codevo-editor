import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  latteTranslationCompletionAt,
  latteTranslationCompletions,
  resolveLatteTranslationDefinition,
} from "./latteTranslationTargets";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";

const ROOT = "/ws";
const NETTE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: ["nette"],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});

describe("latteTranslationTargets", () => {
  it("completes Nette Latte translation keys from framework translation targets", async () => {
    const source = "{_'users.component.'}";
    const reference = latteTranslationCompletionAt(
      source,
      source.indexOf("component.") + "component.".length,
    );
    const request = requestContext({
      collectTranslationTargets: vi.fn(async () => [
        {
          key: "users.component.user_tokens.header",
          path: `${ROOT}/app/modules/usersModule/lang/users.cs_CZ.neon`,
          position: { column: 13, lineNumber: 4 },
          relativePath: "app/modules/usersModule/lang/users.cs_CZ.neon",
        },
        {
          key: "invoice.title",
          path: `${ROOT}/app/modules/invoiceModule/lang/invoice.en_US.neon`,
          position: { column: 1, lineNumber: 2 },
          relativePath: "app/modules/invoiceModule/lang/invoice.en_US.neon",
        },
      ]),
    });

    expect(reference).not.toBeNull();
    await expect(
      latteTranslationCompletions(request, reference!),
    ).resolves.toEqual([
      {
        detail: "app/modules/usersModule/lang/users.cs_CZ.neon",
        insertText: "users.component.user_tokens.header",
        kind: "translation",
        label: "users.component.user_tokens.header",
        replaceEnd: source.indexOf("'}"),
        replaceStart: source.indexOf("'") + 1,
      },
    ]);
  });

  it("opens a Latte translation definition through framework targets", async () => {
    const source = "{_'users.component.user_tokens.header'}";
    const openTarget = vi.fn(async () => true);
    const request = requestContext({
      findTranslationTarget: vi.fn(async () => ({
        key: "users.component.user_tokens.header",
        path: `${ROOT}/app/modules/usersModule/lang/users.cs_CZ.neon`,
        position: { column: 17, lineNumber: 8 },
        relativePath: "app/modules/usersModule/lang/users.cs_CZ.neon",
      })),
      openTarget,
    });

    await expect(
      resolveLatteTranslationDefinition(
        request,
        source,
        source.indexOf("user_tokens"),
      ),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/modules/usersModule/lang/users.cs_CZ.neon`,
      { column: 17, lineNumber: 8 },
      "users.component.user_tokens.header",
    );
  });

  it("drops stale translation completion results after the root changes", async () => {
    const source = "{_'users.'}";
    const reference = latteTranslationCompletionAt(source, source.indexOf(".") + 1);
    const request = requestContext({
      collectTranslationTargets: vi.fn(async () => [
        {
          key: "users.component.user_tokens.header",
          path: `${ROOT}/app/modules/usersModule/lang/users.cs_CZ.neon`,
          position: { column: 1, lineNumber: 1 },
          relativePath: "app/modules/usersModule/lang/users.cs_CZ.neon",
        },
      ]),
      isActive: () => false,
    });

    await expect(
      latteTranslationCompletions(request, reference!),
    ).resolves.toEqual([]);
  });
});

function requestContext(
  overrides: {
    collectTranslationTargets?: LatteProviderRequestContext["deps"]["collectTranslationTargets"];
    findTranslationTarget?: LatteProviderRequestContext["deps"]["findTranslationTarget"];
    isActive?: () => boolean;
    openTarget?: LatteProviderRequestContext["deps"]["openTarget"];
  } = {},
): LatteProviderRequestContext {
  return {
    currentTemplateRelativePath: "app/UI/Home/default.latte",
    deps: {
      collectTranslationTargets:
        overrides.collectTranslationTargets ?? vi.fn(async () => []),
      currentWorkspaceRootRef: { current: ROOT },
      findTranslationTarget: overrides.findTranslationTarget ?? vi.fn(async () => null),
      frameworkIntelligence: NETTE_FRAMEWORK,
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      isSemanticIntelligenceActive: true,
      joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
      listDirectory: vi.fn(async () => []),
      openPhpMethodTarget: vi.fn(async () => false),
      openPhpPropertyTarget: vi.fn(async () => false),
      openTarget: overrides.openTarget ?? vi.fn(async () => false),
      readFileContent: vi.fn(async () => ""),
      resolveDeclaredType: (_source, typeHint) => typeHint,
      resolveExpressionType: vi.fn(async () => null),
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      searchText: vi.fn(async () => []),
      synthesizeTypedReceiverSource: (variableName, typeName) => ({
        position: { column: 1, lineNumber: 1 },
        source: `${variableName}:${typeName}`,
      }),
      toRelativePath: (rootPath, targetPath) =>
        targetPath.startsWith(`${rootPath}/`)
          ? targetPath.slice(rootPath.length + 1)
          : targetPath,
      workspaceRoot: ROOT,
    },
    isRequestedRootActive: overrides.isActive ?? (() => true),
    loadFactoryTemplateOwner: async () => null,
    requestedRoot: ROOT,
  };
}
