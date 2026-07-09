import {
  bladeComponentNavigationCandidateRelativePaths,
  bladeViewCandidateRelativePaths,
  detectBladeReferenceAt,
  isInsideBladeComment,
} from "../domain/bladeNavigation";
import { bladeLaravelStringLiteralHelperAt } from "../domain/bladeLaravelHelperCompletions";
import {
  resolveLaravelConfigTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
} from "../domain/laravelPathResolution";
import { phpIdentifierContextAt } from "../domain/phpNavigation";
import { phpLaravelViewNameFromRelativePath } from "../domain/phpLaravelViews";
import { joinWorkspacePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { BladeIntelligenceDependencies } from "./bladeIntelligenceContracts";
import { editorPositionAtOffset } from "./bladePhpCompletionContext";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface BladeDefinitionProviderDependencies {
  activeDocument: BladeIntelligenceDependencies["activeDocument"];
  collectPhpLaravelNamedRouteTargets: BladeIntelligenceDependencies["collectPhpLaravelNamedRouteTargets"];
  currentWorkspaceRootRef: BladeIntelligenceDependencies["currentWorkspaceRootRef"];
  findPhpLaravelConfigTarget: BladeIntelligenceDependencies["findPhpLaravelConfigTarget"];
  findPhpLaravelTranslationTarget: BladeIntelligenceDependencies["findPhpLaravelTranslationTarget"];
  findPhpLaravelViewTarget: BladeIntelligenceDependencies["findPhpLaravelViewTarget"];
  frameworkRuntime: PhpFrameworkRuntimeContext;
  openDirectPhpMethodTarget: BladeIntelligenceDependencies["openDirectPhpMethodTarget"];
  openDirectPhpPropertyTarget: BladeIntelligenceDependencies["openDirectPhpPropertyTarget"];
  openNavigationTarget: BladeIntelligenceDependencies["openNavigationTarget"];
  openPhpLaravelModelAttributeTarget: BladeIntelligenceDependencies["openPhpLaravelModelAttributeTarget"];
  readNavigationFileContent: BladeIntelligenceDependencies["readNavigationFileContent"];
  relativeWorkspacePath: BladeIntelligenceDependencies["relativeWorkspacePath"];
  resolveBladeViewVariableTypeForView: (
    viewName: string,
    variableName: string,
  ) => Promise<string | null>;
  workspaceRoot: BladeIntelligenceDependencies["workspaceRoot"];
}

export async function provideBladeDefinition(
  source: string,
  offset: number,
  dependencies: BladeDefinitionProviderDependencies,
): Promise<boolean> {
  const {
    activeDocument,
    collectPhpLaravelNamedRouteTargets,
    currentWorkspaceRootRef,
    findPhpLaravelConfigTarget,
    findPhpLaravelTranslationTarget,
    findPhpLaravelViewTarget,
    frameworkRuntime,
    openDirectPhpMethodTarget,
    openDirectPhpPropertyTarget,
    openNavigationTarget,
    openPhpLaravelModelAttributeTarget,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolveBladeViewVariableTypeForView,
    workspaceRoot,
  } = dependencies;
  const requestedRoot = workspaceRoot;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (!requestedRoot) {
    return false;
  }

  if (isInsideBladeComment(source, offset)) {
    return false;
  }

  if (frameworkRuntime.supports("stringLiterals")) {
    const openedLaravelHelper = await openLaravelHelperDefinition(source, offset, {
      activeDocument,
      collectPhpLaravelNamedRouteTargets,
      findPhpLaravelConfigTarget,
      findPhpLaravelTranslationTarget,
      findPhpLaravelViewTarget,
      isRequestedRootActive,
      openNavigationTarget,
    });

    if (openedLaravelHelper) {
      return true;
    }
  }

  if (frameworkRuntime.supports("viewData")) {
    const openedMember = await openBladeViewDataMemberDefinition(source, offset, {
      activeDocument,
      isRequestedRootActive,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openPhpLaravelModelAttributeTarget,
      relativeWorkspacePath,
      requestedRoot,
      resolveBladeViewVariableTypeForView,
    });

    if (openedMember) {
      return true;
    }
  }

  return openBladeReferenceDefinition(source, offset, {
    isRequestedRootActive,
    openNavigationTarget,
    readNavigationFileContent,
    requestedRoot,
  });
}

interface RequestedRootState {
  isRequestedRootActive: () => boolean;
}

interface LaravelHelperDefinitionDependencies extends RequestedRootState {
  activeDocument: BladeIntelligenceDependencies["activeDocument"];
  collectPhpLaravelNamedRouteTargets: BladeIntelligenceDependencies["collectPhpLaravelNamedRouteTargets"];
  findPhpLaravelConfigTarget: BladeIntelligenceDependencies["findPhpLaravelConfigTarget"];
  findPhpLaravelTranslationTarget: BladeIntelligenceDependencies["findPhpLaravelTranslationTarget"];
  findPhpLaravelViewTarget: BladeIntelligenceDependencies["findPhpLaravelViewTarget"];
  openNavigationTarget: BladeIntelligenceDependencies["openNavigationTarget"];
}

async function openLaravelHelperDefinition(
  source: string,
  offset: number,
  dependencies: LaravelHelperDefinitionDependencies,
): Promise<boolean> {
  const helper = bladeLaravelStringLiteralHelperAt(source, offset);

  if (!helper) {
    return false;
  }

  if (helper.helper === "view") {
    if (!resolveLaravelViewTarget(helper.literal)) {
      return false;
    }

    const target = await dependencies.findPhpLaravelViewTarget(helper.literal);

    if (!dependencies.isRequestedRootActive()) {
      return false;
    }

    return target
      ? dependencies.openNavigationTarget(target.path, target.position, target.name)
      : false;
  }

  if (helper.helper === "route") {
    if (!dependencies.activeDocument) {
      return false;
    }

    const routes = await dependencies.collectPhpLaravelNamedRouteTargets(
      dependencies.activeDocument.content,
      dependencies.activeDocument.path,
    );

    if (!dependencies.isRequestedRootActive()) {
      return false;
    }

    const target = routes.find(
      (route) => route.name.toLowerCase() === helper.literal.toLowerCase(),
    );

    return target
      ? dependencies.openNavigationTarget(target.path, target.position, target.name)
      : false;
  }

  if (helper.helper === "config") {
    if (!resolveLaravelConfigTarget(helper.literal)) {
      return false;
    }

    const target = await dependencies.findPhpLaravelConfigTarget(helper.literal);

    if (!dependencies.isRequestedRootActive()) {
      return false;
    }

    return target
      ? dependencies.openNavigationTarget(target.path, target.position, target.key)
      : false;
  }

  if (helper.helper === "trans") {
    if (!resolveLaravelTransTarget(helper.literal)) {
      return false;
    }

    const target = await dependencies.findPhpLaravelTranslationTarget(helper.literal);

    if (!dependencies.isRequestedRootActive()) {
      return false;
    }

    return target
      ? dependencies.openNavigationTarget(target.path, target.position, target.key)
      : false;
  }

  return false;
}

interface BladeViewDataMemberDefinitionDependencies extends RequestedRootState {
  activeDocument: BladeIntelligenceDependencies["activeDocument"];
  openDirectPhpMethodTarget: BladeIntelligenceDependencies["openDirectPhpMethodTarget"];
  openDirectPhpPropertyTarget: BladeIntelligenceDependencies["openDirectPhpPropertyTarget"];
  openPhpLaravelModelAttributeTarget: BladeIntelligenceDependencies["openPhpLaravelModelAttributeTarget"];
  relativeWorkspacePath: BladeIntelligenceDependencies["relativeWorkspacePath"];
  requestedRoot: string;
  resolveBladeViewVariableTypeForView: BladeDefinitionProviderDependencies["resolveBladeViewVariableTypeForView"];
}

async function openBladeViewDataMemberDefinition(
  source: string,
  offset: number,
  dependencies: BladeViewDataMemberDefinitionDependencies,
): Promise<boolean> {
  const memberContext = phpIdentifierContextAt(
    source,
    editorPositionAtOffset(source, offset),
  );

  if (
    memberContext?.kind !== "methodCall" &&
    memberContext?.kind !== "memberPropertyAccess"
  ) {
    return false;
  }

  const activePath = dependencies.activeDocument?.path ?? "";
  const relativePath = activePath
    ? dependencies.relativeWorkspacePath(dependencies.requestedRoot, activePath)
    : "";
  const viewName = phpLaravelViewNameFromRelativePath(relativePath);
  const variableName = memberContext.variableName
    ? `$${memberContext.variableName}`
    : "";
  const memberName =
    memberContext.kind === "methodCall"
      ? memberContext.methodName
      : memberContext.propertyName;

  if (!viewName || !variableName || !memberName) {
    return false;
  }

  const className = await dependencies.resolveBladeViewVariableTypeForView(
    viewName,
    variableName,
  );

  if (!dependencies.isRequestedRootActive()) {
    return false;
  }

  if (!className) {
    return false;
  }

  const openedMethod = await dependencies.openDirectPhpMethodTarget(
    className,
    memberName,
  );

  if (!dependencies.isRequestedRootActive()) {
    return false;
  }

  if (openedMethod) {
    return true;
  }

  if (memberContext.kind !== "memberPropertyAccess") {
    return false;
  }

  const openedAttribute = await dependencies.openPhpLaravelModelAttributeTarget(
    className,
    memberName,
  );

  if (!dependencies.isRequestedRootActive()) {
    return false;
  }

  if (openedAttribute) {
    return true;
  }

  return dependencies.openDirectPhpPropertyTarget(className, memberName);
}

interface BladeReferenceDefinitionDependencies extends RequestedRootState {
  openNavigationTarget: BladeIntelligenceDependencies["openNavigationTarget"];
  readNavigationFileContent: BladeIntelligenceDependencies["readNavigationFileContent"];
  requestedRoot: string;
}

async function openBladeReferenceDefinition(
  source: string,
  offset: number,
  dependencies: BladeReferenceDefinitionDependencies,
): Promise<boolean> {
  const reference = detectBladeReferenceAt(source, offset);

  if (!reference) {
    return false;
  }

  const candidateRelativePaths =
    reference.kind === "component"
      ? bladeComponentNavigationCandidateRelativePaths(reference.name)
      : reference.kind === "view"
        ? bladeViewCandidateRelativePaths(reference.name)
        : [];

  if (candidateRelativePaths.length === 0) {
    return false;
  }

  for (const relativePath of candidateRelativePaths) {
    if (!dependencies.isRequestedRootActive()) {
      return false;
    }

    const path = joinWorkspacePath(dependencies.requestedRoot, relativePath);

    try {
      await dependencies.readNavigationFileContent(path);
    } catch {
      if (!dependencies.isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!dependencies.isRequestedRootActive()) {
      return false;
    }

    return dependencies.openNavigationTarget(
      path,
      { column: 1, lineNumber: 1 },
      reference.name,
    );
  }

  return false;
}
