import {
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
} from "../domain/bladeNavigation";
import { bladeLaravelHelperCompletionContextAt } from "../domain/bladeLaravelHelperCompletions";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpLaravelViewVariable } from "../domain/phpLaravelViewData";
import { phpLaravelViewNameFromRelativePath } from "../domain/phpLaravelViews";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  BladeCompletionItem,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";
import {
  provideBladeLaravelHelperCompletionItems,
  bladeLaravelHelperNameCompletions,
} from "./bladeLaravelHelperCompletionItems";
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
  collectPhpLaravelConfigTargets: BladeIntelligenceDependencies["collectPhpLaravelConfigTargets"];
  collectPhpLaravelNamedRouteTargets: BladeIntelligenceDependencies["collectPhpLaravelNamedRouteTargets"];
  collectPhpLaravelTranslationTargets: BladeIntelligenceDependencies["collectPhpLaravelTranslationTargets"];
  collectPhpLaravelViewTargets: BladeIntelligenceDependencies["collectPhpLaravelViewTargets"];
  currentWorkspaceRootRef: { readonly current: string | null };
  ensurePhpFrameworkSourceCollectionsLoaded: BladeIntelligenceDependencies["ensurePhpFrameworkSourceCollectionsLoaded"];
  isLaravelFrameworkActive: boolean;
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
    collectPhpLaravelConfigTargets,
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelTranslationTargets,
    collectPhpLaravelViewTargets,
    currentWorkspaceRootRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    isLaravelFrameworkActive,
    relativeWorkspacePath,
    resolveBladeForeachElementTypeForVariable,
    resolveBladeViewVariableTypeForView,
    resolvePhpReceiverMethodCompletions,
    workspaceRoot,
  } = dependencies;
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
    const viewName = phpLaravelViewNameFromRelativePath(relativePath);

    if (!viewName) {
      return [];
    }

    if (isLaravelFrameworkActive) {
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
    const viewName = phpLaravelViewNameFromRelativePath(relativePath);
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
    return bladeLaravelHelperNameCompletions(phpLikeCompletion.prefix, {
      replaceEnd: phpLikeCompletion.end,
      replaceStart: phpLikeCompletion.start,
    });
  }

  if (isLaravelFrameworkActive) {
    const helperCompletion = bladeLaravelHelperCompletionContextAt(
      source,
      position,
    );

    if (helperCompletion) {
      return provideBladeLaravelHelperCompletionItems(helperCompletion, offset, {
        collectPhpLaravelConfigTargets,
        collectPhpLaravelNamedRouteTargets,
        collectPhpLaravelTranslationTargets,
        currentDocumentContent: source,
        currentDocumentPath: activeDocument?.path ?? "",
        isRequestedRootActive,
      });
    }
  }

  const reference = detectBladeReferenceAt(source, offset);

  if (reference?.kind === "view") {
    const targets = await collectPhpLaravelViewTargets();

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
