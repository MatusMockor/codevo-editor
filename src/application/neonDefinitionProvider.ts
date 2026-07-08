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

export interface NeonDefinitionDependencies extends NeonRuntimeDependencies {
  openClassTarget(className: string): Promise<boolean>;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
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
): Promise<boolean> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const classReference = detectNeonClassReferenceAt(source, offset);

  if (classReference) {
    return deps.openClassTarget(classReference.className);
  }

  const parameterReference = detectNeonParameterReferenceAt(source, offset);

  if (parameterReference) {
    return resolveNeonParameterDefinition(
      context,
      source,
      parameterReference.name,
    );
  }

  const serviceReference = detectNeonServiceReferenceAt(source, offset);

  if (serviceReference) {
    return resolveNeonServiceDefinition(context, source, serviceReference.name);
  }

  const serviceMethod = detectNeonServiceMethodReferenceAt(source, offset);

  if (serviceMethod) {
    return resolveNeonServiceMethodDefinition(
      context,
      source,
      serviceMethod.serviceName,
      serviceMethod.methodName,
    );
  }

  const setupMethod = detectNeonServiceSetupMethodAt(source, offset);

  if (setupMethod) {
    return resolveNeonSetupMethodDefinition(context, setupMethod);
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
