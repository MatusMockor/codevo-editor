import {
  bladeComponentNavigationCandidateRelativePaths,
  bladeReferenceCandidateWorkspacePaths,
  bladeViewCandidateRelativePaths,
  detectBladeReferenceAt,
  isInsideBladeComment,
} from "../domain/bladeNavigation";
import { bladeFrameworkStringLiteralHelperAt } from "../domain/bladeFrameworkHelperCompletions";
import {
  phpFrameworkTemplateNameFromRelativePath,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { phpIdentifierContextAt } from "../domain/phpNavigation";
import { joinWorkspacePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { BladeIntelligenceDependencies } from "./bladeIntelligenceContracts";
import { editorPositionAtOffset } from "./bladePhpCompletionContext";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import { resolvePhpFrameworkLiteralNavigationTarget } from "./phpFrameworkLiteralNavigation";
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
  request?: NavigationRequest,
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
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
    canNavigate(request);

  if (!requestedRoot) {
    return false;
  }

  if (isInsideBladeComment(source, offset)) {
    return false;
  }

  if (frameworkRuntime.supports("stringLiterals")) {
    const openedFrameworkHelper = await openFrameworkHelperDefinition(
      source,
      offset,
      {
        activeDocument,
        collectPhpLaravelNamedRouteTargets,
        findPhpLaravelConfigTarget,
        findPhpLaravelTranslationTarget,
        findPhpLaravelViewTarget,
        frameworkProviders: frameworkRuntime.providers,
        isRequestedRootActive,
        openNavigationTarget: guardedOpenNavigationTarget(
          openNavigationTarget,
          isRequestedRootActive,
        ),
      },
    );

    if (openedFrameworkHelper) {
      return true;
    }
  }

  if (frameworkRuntime.supports("viewData")) {
    const openedMember = await openBladeViewDataMemberDefinition(source, offset, {
      activeDocument,
      isRequestedRootActive,
      openDirectPhpMethodTarget: guardedClassMemberNavigation(
        openDirectPhpMethodTarget,
        isRequestedRootActive,
        request,
      ),
      openDirectPhpPropertyTarget: guardedClassMemberNavigation(
        openDirectPhpPropertyTarget,
        isRequestedRootActive,
      ),
      openPhpLaravelModelAttributeTarget: guardedClassMemberNavigation(
        openPhpLaravelModelAttributeTarget,
        isRequestedRootActive,
      ),
      frameworkProviders: frameworkRuntime.providers,
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
    openNavigationTarget: guardedOpenNavigationTarget(
      openNavigationTarget,
      isRequestedRootActive,
    ),
    readNavigationFileContent,
    requestedRoot,
  });
}

function guardedOpenNavigationTarget(
  openNavigationTarget: BladeIntelligenceDependencies["openNavigationTarget"],
  canOpen: () => boolean,
): BladeIntelligenceDependencies["openNavigationTarget"] {
  return (path, position, label) => {
    if (!canOpen()) {
      return Promise.resolve(false);
    }

    return openNavigationTarget(path, position, label);
  };
}

function guardedClassMemberNavigation<
  T extends (className: string, memberName: string) => Promise<boolean>,
>(
  openTarget: T,
  canOpen: () => boolean,
  request?: NavigationRequest,
): T {
  return ((className: string, memberName: string) => {
    if (!canOpen()) {
      return Promise.resolve(false);
    }

    const openTargetWithRequest = openTarget as (
      className: string,
      memberName: string,
      request?: NavigationRequest,
    ) => Promise<boolean>;

    return request
      ? openTargetWithRequest(className, memberName, request)
      : openTarget(className, memberName);
  }) as T;
}

interface RequestedRootState {
  isRequestedRootActive: () => boolean;
}

interface FrameworkHelperDefinitionDependencies extends RequestedRootState {
  activeDocument: BladeIntelligenceDependencies["activeDocument"];
  collectPhpLaravelNamedRouteTargets: BladeIntelligenceDependencies["collectPhpLaravelNamedRouteTargets"];
  findPhpLaravelConfigTarget: BladeIntelligenceDependencies["findPhpLaravelConfigTarget"];
  findPhpLaravelTranslationTarget: BladeIntelligenceDependencies["findPhpLaravelTranslationTarget"];
  findPhpLaravelViewTarget: BladeIntelligenceDependencies["findPhpLaravelViewTarget"];
  frameworkProviders: readonly PhpFrameworkProvider[];
  openNavigationTarget: BladeIntelligenceDependencies["openNavigationTarget"];
}

async function openFrameworkHelperDefinition(
  source: string,
  offset: number,
  dependencies: FrameworkHelperDefinitionDependencies,
): Promise<boolean> {
  const helper = bladeFrameworkStringLiteralHelperAt(
    source,
    offset,
    dependencies.frameworkProviders,
  );

  if (!helper) {
    return false;
  }

  const target = await resolvePhpFrameworkLiteralNavigationTarget(
    {
      activeDocument: dependencies.activeDocument,
      directHelperMatch: helper,
      offset,
      position: editorPositionAtOffset(source, offset),
      providers: dependencies.frameworkProviders,
      source,
      supportsStringLiterals: true,
    },
    {
      collectNamedRouteTargets: dependencies.collectPhpLaravelNamedRouteTargets,
      findConfigTarget: dependencies.findPhpLaravelConfigTarget,
      findEnvTarget: async () => null,
      findTranslationTarget: dependencies.findPhpLaravelTranslationTarget,
      findViewTarget: dependencies.findPhpLaravelViewTarget,
    },
  );

  if (!dependencies.isRequestedRootActive()) {
    return false;
  }

  return target
    ? dependencies.openNavigationTarget(target.path, target.position, target.label)
    : false;
}

interface BladeViewDataMemberDefinitionDependencies extends RequestedRootState {
  activeDocument: BladeIntelligenceDependencies["activeDocument"];
  frameworkProviders: readonly PhpFrameworkProvider[];
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
  const viewName = phpFrameworkTemplateNameFromRelativePath(
    relativePath,
    dependencies.frameworkProviders,
  );
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
        : bladeReferenceCandidateWorkspacePaths(
            dependencies.requestedRoot,
            reference,
          ).map((target) => target.relativePath);

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
