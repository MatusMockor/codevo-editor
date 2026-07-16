// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { resolvePhpClassName, phpMethodPosition } from "../domain/phpNavigation";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
import { phpReceiverExpressionTypeInSource } from "../domain/phpSemanticEngine";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createLatteIntelligence } from "./useLatteIntelligence";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpClassMemberCollectors,
  type PhpClassMemberCollectors,
} from "./usePhpClassMemberCollectors";
import {
  usePhpMethodTargetNavigation,
  type PhpMethodTargetNavigation,
  type PhpMethodTargetNavigationDependencies,
} from "./usePhpMethodTargetNavigation";
import {
  usePhpMethodCompletionResolvers,
  type PhpMethodCompletionResolvers,
} from "./usePhpMethodCompletionResolvers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FIXTURE_ROOT = path.join(
  process.cwd(),
  "src/application/fixtures/netteImplicitUser",
);
const TEMPLATE_PATH = path.join(FIXTURE_ROOT, "portability_claims.latte");
const USER_PATH = path.join(FIXTURE_ROOT, "User.php");
const NETTE_USER_TYPE = "Nette\\Security\\User";
const NETTE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [phpNetteFrameworkProvider.id],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});

interface SemanticHarnessApi {
  completions: PhpMethodCompletionResolvers;
  members: PhpClassMemberCollectors;
  navigation: PhpMethodTargetNavigation;
}

function workspaceDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath: FIXTURE_ROOT,
  };
}

function renderSemanticHarness(
  userSource: string,
  openNavigationTarget: PhpMethodTargetNavigationDependencies[
    "openNavigationTarget"
  ],
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: SemanticHarnessApi | null } = { current: null };
  const currentWorkspaceRootRef = { current: FIXTURE_ROOT };
  const resolvePhpClassSourcePaths = async (className: string) =>
    className.trim().replace(/^\\+/, "") === NETTE_USER_TYPE
      ? [USER_PATH]
      : [];

  function Harness() {
    const members = usePhpClassMemberCollectors({
      currentPhpFrameworkSourceContext: () => ({
        signature: "nette-user",
        workspaceSources: [userSource],
      }),
      currentWorkspaceRootRef,
      frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
      readNavigationFileContent: (filePath) => readFile(filePath, "utf8"),
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpClassSourcePaths,
      resolvePhpDeclaredType: (source, typeName) =>
        typeName ? resolvePhpClassName(source, typeName) : null,
      resolvePhpFrameworkBoundConcrete: async () => null,
      workspaceDescriptor: workspaceDescriptor(),
      workspaceRoot: FIXTURE_ROOT,
    });
    const completions = usePhpMethodCompletionResolvers({
      collectPhpFrameworkSyntheticMethodsForClass:
        members.collectPhpFrameworkSyntheticMethodsForClass,
      collectPhpMethodsForClass: members.collectPhpMethodsForClass,
      currentPhpFrameworkSourceContext: () => ({
        workspaceSources: [userSource],
      }),
      frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
      phpNormalizedReceiverExpressionIsThis: (expression) =>
        expression.trim() === "$this",
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpExpressionType: (source, position, receiverExpression) =>
        Promise.resolve(
          phpReceiverExpressionTypeInSource(
            source,
            position,
            receiverExpression,
            { frameworkProviders: [phpNetteFrameworkProvider] },
          ),
        ),
      resolvePhpFrameworkBuilderModelType: async () => null,
    });
    const navigation = usePhpMethodTargetNavigation({
      currentWorkspaceRootRef,
      intelligenceMode: "basic",
      openNavigationTarget,
      projectSymbolSearch: { searchProjectSymbols: async () => [] },
      readNavigationFileContent: (filePath) => readFile(filePath, "utf8"),
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpClassSourcePaths,
      resolvePhpFrameworkBoundConcrete: async () => null,
      workspaceDescriptor: workspaceDescriptor(),
      workspaceRoot: FIXTURE_ROOT,
    });

    captured.current = { completions, members, navigation };
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    api: () => {
      if (!captured.current) {
        throw new Error("semantic harness not mounted");
      }

      return captured.current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function editorPositionAtOffset(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: offset - lineStart + 1,
    lineNumber: before.split("\n").length,
  };
}

describe("portable ebox-shaped implicit Nette user semantic smoke", () => {
  it("completes and navigates User::isAllowed from portability_claims.latte", async () => {
    const [template, userSource] = await Promise.all([
      readFile(TEMPLATE_PATH, "utf8"),
      readFile(USER_PATH, "utf8"),
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const semantic = renderSemanticHarness(userSource, openNavigationTarget);
    const deps: LatteIntelligenceDependencies = {
      collectTranslationTargets: async () => [],
      currentWorkspaceRootRef: { current: FIXTURE_ROOT },
      findTranslationTarget: async () => null,
      frameworkIntelligence: NETTE_FRAMEWORK,
      getActiveDocument: () => ({ path: TEMPLATE_PATH }),
      isSemanticIntelligenceActive: true,
      joinPath: (rootPath, relativePath) => path.join(rootPath, relativePath),
      listDirectory: async () => [],
      openPhpMethodTarget: (className, methodName, request) =>
        semantic.api().navigation.openDirectPhpMethodTarget(
          className,
          methodName,
          request,
        ),
      openPhpPropertyTarget: async () => false,
      openTarget: async () => false,
      readFileContent: (filePath) => readFile(filePath, "utf8"),
      resolveDeclaredType: (source, typeHint) =>
        typeHint ? resolvePhpClassName(source, typeHint) : null,
      resolveExpressionType: async () => null,
      resolvePhpReceiverCompletions: (source, position, receiverExpression) =>
        semantic.api().completions.resolvePhpReceiverMethodCompletions(
          source,
          position,
          receiverExpression,
        ),
      searchText: async () => [],
      synthesizeTypedReceiverSource: (variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      }),
      toRelativePath: (rootPath, filePath) =>
        path.relative(rootPath, filePath).split(path.sep).join("/"),
      workspaceRoot: FIXTURE_ROOT,
    };
    const latte = createLatteIntelligence(() => deps);
    const completionSource = template.replace("$user->isAllowed", "$user->isA");
    const completionOffset =
      completionSource.indexOf("$user->isA") + "$user->isA".length;

    expect(template).toContain("$user->isAllowed");
    const completions = await latte.provideLatteCompletions(
      completionSource,
      editorPositionAtOffset(completionSource, completionOffset),
    );
    expect(completions.map(({ label }) => label)).toContain("isAllowed");

    const adversarialSource = `<?php
/** @var \\App\\Security\\OtherUser $user */
$user->`;
    await expect(
      semantic.api().completions.resolvePhpReceiverMethodCompletions(
        adversarialSource,
        { column: 8, lineNumber: 3 },
        "$user",
      ),
    ).resolves.toEqual([]);
    await expect(
      semantic.api().completions.resolvePhpReceiverMethodCompletions(
        deps.synthesizeTypedReceiverSource("user", NETTE_USER_TYPE).source,
        { column: 1, lineNumber: 1 },
        "$user",
      ),
    ).resolves.toEqual([]);
    await expect(
      semantic.api().completions.resolvePhpReceiverMethodCompletions(
        deps.synthesizeTypedReceiverSource("user", NETTE_USER_TYPE).source,
        { column: 1, lineNumber: 3 },
        "$other",
      ),
    ).resolves.toEqual([]);

    await expect(
      latte.provideLatteDefinition(
        template,
        template.indexOf("isAllowed") + 2,
      ),
    ).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      USER_PATH,
      phpMethodPosition(userSource, "isAllowed"),
      "isAllowed()",
      { shouldCommit: expect.any(Function) },
    );

    semantic.unmount();
  });
});
