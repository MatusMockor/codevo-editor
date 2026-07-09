import {
  detectNeonClassReferenceAt,
  detectNeonIncludeAt,
} from "../domain/neonConfig";
import {
  detectNeonParameterReferenceAt,
  detectNeonServiceMethodReferenceAt,
  detectNeonServiceReferenceAt,
  detectNeonServiceSetupMethodAt,
} from "../domain/netteDiContainer";
import {
  resolveNeonParameterDefinition,
  resolveNeonServiceDefinition,
  resolveNeonServiceMethodDefinition,
  resolveNeonSetupMethodDefinition,
} from "./netteNeonDefinitionResolvers";
import { resolveNeonIncludeDefinition } from "./neonIncludeDefinition";
import type {
  NeonRequestContext,
  NeonRuntimeDependencies,
} from "./neonIntelligenceRuntime";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

export interface NeonDefinitionDependencies extends NeonRuntimeDependencies {
  openClassTarget(className: string): Promise<boolean>;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openTarget(
    path: string,
    position: { column: number; lineNumber: number },
    label: string,
  ): Promise<boolean>;
  toRelativePath(rootPath: string, path: string): string;
}

export async function provideNeonDefinition(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  source: string,
  offset: number,
  request?: NavigationRequest,
): Promise<boolean> {
  const guardedContext = guardedNeonRequestContext(context, request);
  const { deps, isRequestedRootActive, requestedRoot } = guardedContext;
  const classReference = detectNeonClassReferenceAt(source, offset);

  if (classReference) {
    return deps.openClassTarget(classReference.className);
  }

  const parameterReference = detectNeonParameterReferenceAt(source, offset);

  if (parameterReference) {
    return resolveNeonParameterDefinition(
      guardedContext,
      source,
      parameterReference.name,
    );
  }

  const serviceReference = detectNeonServiceReferenceAt(source, offset);

  if (serviceReference) {
    return resolveNeonServiceDefinition(
      guardedContext,
      source,
      serviceReference.name,
    );
  }

  const serviceMethod = detectNeonServiceMethodReferenceAt(source, offset);

  if (serviceMethod) {
    return resolveNeonServiceMethodDefinition(
      guardedContext,
      source,
      serviceMethod.serviceName,
      serviceMethod.methodName,
    );
  }

  const setupMethod = detectNeonServiceSetupMethodAt(source, offset);

  if (setupMethod) {
    return resolveNeonSetupMethodDefinition(guardedContext, setupMethod);
  }

  const include = detectNeonIncludeAt(source, offset);

  if (include) {
    return resolveNeonIncludeDefinition(
      deps,
      requestedRoot,
      isRequestedRootActive,
      include.path,
    );
  }

  return false;
}

function guardedNeonRequestContext(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  request?: NavigationRequest,
): NeonRequestContext<NeonDefinitionDependencies> {
  const canOpen = () =>
    context.isRequestedRootActive() && canNavigate(request);

  return {
    ...context,
    deps: {
      ...context.deps,
      openClassTarget: (className) => {
        if (!canOpen()) {
          return Promise.resolve(false);
        }

        return context.deps.openClassTarget(className);
      },
      openDirectPhpMethodTarget: (className, methodName) => {
        if (!canOpen()) {
          return Promise.resolve(false);
        }

        return request
          ? context.deps.openDirectPhpMethodTarget(className, methodName, request)
          : context.deps.openDirectPhpMethodTarget(className, methodName);
      },
      openTarget: (path, position, label) => {
        if (!canOpen()) {
          return Promise.resolve(false);
        }

        return context.deps.openTarget(path, position, label);
      },
    },
    isRequestedRootActive: canOpen,
  };
}
