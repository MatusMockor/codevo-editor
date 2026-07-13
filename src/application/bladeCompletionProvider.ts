import {
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
} from "../domain/bladeNavigation";
import { bladeFrameworkHelperCompletionContextAt } from "../domain/bladeFrameworkHelperCompletions";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpFrameworkTemplateNameFromRelativePath } from "../domain/phpFrameworkProviders";
import type { PhpLaravelViewVariable } from "../domain/phpLaravelViewData";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  BladeCompletionItem,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  bladeFrameworkHelperNameCompletions,
  bladeFrameworkLiteralCompletionItems,
} from "./bladeFrameworkHelperCompletionItems";
import {
  bladeComponentCompletionItems,
  bladeDirectiveCompletionItems,
} from "./bladeStaticCompletionItems";
import {
  BLADE_BUILT_IN_VARIABLES,
  bladeVariableCompletionItems,
} from "./bladeVariableCompletionItems";
import {
  bladeMemberCompletionItem,
  bladeOffsetAtEditorPosition,
  bladePhpLikeCompletionAt,
  bladePhpMemberAccessCompletionAt,
} from "./bladePhpCompletionContext";
import { resolvePhpFrameworkLiteralCompletions } from "./phpFrameworkLiteralCompletions";
import { synthesizePhpTypedReceiverSource } from "./phpTypedReceiverSource";

export interface BladeCompletionProviderDependencies {
  activeDocument: { content: string; path: string } | null;
  collectBladeComponentNames: () => Promise<string[]>;
  collectBladeForeachLoopVariables: (
    viewName: string,
    source: string,
    offset: number,
    alreadyListed: readonly PhpLaravelViewVariable[],
  ) => Promise<PhpLaravelViewVariable[]>;
  collectBladeViewVariablesWithDisplayTypes: (
    viewName: string,
  ) => Promise<PhpLaravelViewVariable[]>;
  collectConfigTargets: BladeIntelligenceDependencies["collectConfigTargets"];
  collectNamedRouteTargets: BladeIntelligenceDependencies["collectNamedRouteTargets"];
  collectTranslationTargets: BladeIntelligenceDependencies["collectTranslationTargets"];
  collectViewTargets: BladeIntelligenceDependencies["collectViewTargets"];
  currentWorkspaceRootRef: { readonly current: string | null };
  ensurePhpFrameworkSourceCollectionsLoaded: BladeIntelligenceDependencies["ensurePhpFrameworkSourceCollectionsLoaded"];
  frameworkRuntime: PhpFrameworkRuntimeContext;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  resolveBladeForeachElementTypeForVariable: (
    viewName: string,
    source: string,
    offset: number,
    variableName: string,
  ) => Promise<string | null>;
  resolveBladeViewVariableTypeForView: (
    viewName: string,
    variableName: string,
  ) => Promise<string | null>;
  resolvePhpReceiverMethodCompletions: BladeIntelligenceDependencies["resolvePhpReceiverMethodCompletions"];
  workspaceRoot: string | null;
}

export async function provideBladeCompletions(
  source: string,
  position: EditorPosition,
  dependencies: BladeCompletionProviderDependencies,
): Promise<BladeCompletionItem[]> {
  const {
    activeDocument,
    collectBladeComponentNames,
    collectBladeForeachLoopVariables,
    collectBladeViewVariablesWithDisplayTypes,
    collectConfigTargets,
    collectNamedRouteTargets,
    collectTranslationTargets,
    collectViewTargets,
    currentWorkspaceRootRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    frameworkRuntime,
    relativeWorkspacePath,
    resolveBladeForeachElementTypeForVariable,
    resolveBladeViewVariableTypeForView,
    resolvePhpReceiverMethodCompletions,
    workspaceRoot,
  } = dependencies;
  const supportsStringLiterals = frameworkRuntime.supports("stringLiterals");
  const supportsViews = frameworkRuntime.supports("views");
  const supportsViewData = frameworkRuntime.supports("viewData");
  const requestedRoot = workspaceRoot;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (!requestedRoot) {
    return [];
  }

  const offset = bladeOffsetAtEditorPosition(source, position);
  const directiveCompletion = detectBladeDirectiveCompletionAt(source, offset);
  const memberCompletion = bladePhpMemberAccessCompletionAt(source, offset);
  const phpLikeCompletion = bladePhpLikeCompletionAt(source, offset);

  if (directiveCompletion) {
    return bladeDirectiveCompletionItems(directiveCompletion.directivePrefix, {
      replaceEnd: offset,
      replaceStart: directiveCompletion.start + 1,
    });
  }

  if (memberCompletion) {
    const activePath = activeDocument?.path ?? "";
    const relativePath = activePath
      ? relativeWorkspacePath(requestedRoot, activePath)
      : "";
    const viewName = phpFrameworkTemplateNameFromRelativePath(
      relativePath,
      frameworkRuntime.providers,
    );

    if (!viewName) {
      return [];
    }

    if (supportsViewData) {
      void ensurePhpFrameworkSourceCollectionsLoaded(requestedRoot);
    }

    const viewVariableType = await resolveBladeViewVariableTypeForView(
      viewName,
      `$${memberCompletion.variableName}`,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    const resolvedType =
      viewVariableType ??
      (await resolveBladeForeachElementTypeForVariable(
        viewName,
        source,
        offset,
        memberCompletion.variableName,
      ));

    if (!isRequestedRootActive()) {
      return [];
    }

    if (!resolvedType) {
      return [];
    }

    const synthetic = synthesizePhpTypedReceiverSource(
      memberCompletion.variableName,
      resolvedType,
    );
    const members = await resolvePhpReceiverMethodCompletions(
      synthetic.source,
      synthetic.position,
      memberCompletion.receiverExpression,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    const normalizedPrefix = memberCompletion.prefix.toLowerCase();

    return orderPhpMemberCompletionsByCategory(members)
      .filter((member) => member.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((member) =>
        bladeMemberCompletionItem(member, {
          replaceEnd: memberCompletion.end,
          replaceStart: memberCompletion.start,
        }),
      );
  }

  if (phpLikeCompletion?.kind === "variable") {
    const activePath = activeDocument?.path ?? "";
    const relativePath = activePath
      ? relativeWorkspacePath(requestedRoot, activePath)
      : "";
    const viewName = phpFrameworkTemplateNameFromRelativePath(
      relativePath,
      frameworkRuntime.providers,
    );
    const variables = viewName
      ? await collectBladeViewVariablesWithDisplayTypes(viewName)
      : [];

    if (!isRequestedRootActive()) {
      return [];
    }

    const foreachVariables = viewName
      ? await collectBladeForeachLoopVariables(viewName, source, offset, variables)
      : [];

    if (!isRequestedRootActive()) {
      return [];
    }

    return bladeVariableCompletionItems(
      [...foreachVariables, ...variables, ...BLADE_BUILT_IN_VARIABLES],
      phpLikeCompletion.prefix,
      {
        replaceEnd: phpLikeCompletion.end,
        replaceStart: phpLikeCompletion.start,
      },
    );
  }

  if (phpLikeCompletion?.kind === "helper") {
    if (!supportsStringLiterals) {
      return [];
    }

    return bladeFrameworkHelperNameCompletions(
      phpLikeCompletion.prefix,
      {
        replaceEnd: phpLikeCompletion.end,
        replaceStart: phpLikeCompletion.start,
      },
      frameworkRuntime.providers,
    );
  }

  if (supportsStringLiterals) {
    const helperCompletion = bladeFrameworkHelperCompletionContextAt(
      source,
      position,
      frameworkRuntime.providers,
    );

    if (helperCompletion) {
      const completions = await resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: activeDocument?.path ?? "",
          },
          position: helperCompletion.position,
          providers: frameworkRuntime.providers,
          source: helperCompletion.source,
        },
        {
          collectConfigTargets,
          collectEnvTargets: async () => [],
          collectNamedRouteTargets,
          collectTranslationTargets,
          collectViewTargets,
          isRequestStillCurrent: isRequestedRootActive,
        },
      );

      return bladeFrameworkLiteralCompletionItems(
        completions ?? [],
        offset,
        helperCompletion.prefix,
      );
    }
  }

  const reference = detectBladeReferenceAt(source, offset);

  if (reference?.kind === "view") {
    if (!supportsViews) {
      return [];
    }

    const targets = await collectViewTargets();

    if (!isRequestedRootActive()) {
      return [];
    }

    const normalizedPrefix = reference.name.toLowerCase();

    return targets
      .filter((target) => target.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 100)
      .map((target) => ({
        detail: target.relativePath,
        insertText: target.name,
        kind: "view",
        label: target.name,
        replaceEnd: reference.nameEnd,
        replaceStart: reference.nameStart,
      }));
  }

  const componentCompletion = detectBladeComponentCompletionAt(source, offset);

  if (componentCompletion) {
    const componentNames = await collectBladeComponentNames();

    if (!isRequestedRootActive()) {
      return [];
    }

    return bladeComponentCompletionItems(
      componentNames,
      componentCompletion.prefix,
      {
        replaceEnd: componentCompletion.replaceEnd,
        replaceStart: componentCompletion.replaceStart,
      },
    );
  }

  return [];
}
