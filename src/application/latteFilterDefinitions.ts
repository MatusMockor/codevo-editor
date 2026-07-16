import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  latteFilterReferenceAt,
  type LatteFilterReference,
} from "./latteExpressionDetection";
import type { LatteFilterRegistrationTarget } from "./latteFilterDiscovery";
import { latteCoreFilterMethodTarget } from "./latteCoreFilterTargets";
import { neonServiceTypeInSource } from "./netteNeonConfigFacts";
import {
  resolveNeonServiceTypeFromMaps,
  type NeonProjectConfig,
} from "./neonProjectConfigDiscovery";

export interface LatteFilterDefinitionDependencies {
  openPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
}

export interface LatteFilterDefinitionContext {
  deps: LatteFilterDefinitionDependencies;
  isRequestedRootActive(): boolean;
  loadFilterRegistrations(): Promise<LatteFilterRegistrationTarget[]>;
  loadProjectConfig?(): Promise<
    Pick<NeonProjectConfig, "serviceAliases" | "serviceNameTypes">
  >;
}

export async function resolveLatteFilterDefinition(
  context: LatteFilterDefinitionContext,
  source: string,
  offset: number,
  reference: LatteFilterReference | null = latteFilterReferenceAt(source, offset),
): Promise<boolean> {
  if (!reference) {
    return false;
  }

  const registrations = await context.loadFilterRegistrations();

  if (!context.isRequestedRootActive()) {
    return false;
  }

  const target = registrations.find(
    (registration) => registration.name === reference.name,
  );

  if (!target) {
    return openLatteCoreFilterMethodTarget(context, reference.name);
  }

  const inlineCallableOpened = await openInlineObjectCallableMethodTarget(
    context,
    target,
  );

  if (!context.isRequestedRootActive()) {
    return false;
  }

  if (inlineCallableOpened) {
    return true;
  }

  let targetSource: string;

  try {
    targetSource = await context.deps.readFileContent(target.path);
  } catch {
    if (!context.isRequestedRootActive()) {
      return false;
    }

    return false;
  }

  if (!context.isRequestedRootActive()) {
    return false;
  }

  const targetOffset =
    target.serviceClassName || target.callable?.serviceClassName
      ? target.offset
      : (target.callableOffset ?? target.offset);

  const registrationTargetOpened = await context.deps.openTarget(
    target.path,
    editorPositionAtOffset(targetSource, targetOffset),
    target.name,
  );

  if (registrationTargetOpened) {
    return true;
  }

  if (!context.isRequestedRootActive()) {
    return false;
  }

  if (isInlineObjectCallable(target)) {
    return false;
  }

  return openLatteCallableMethodTarget(context, target, targetSource);
}

async function openInlineObjectCallableMethodTarget(
  context: LatteFilterDefinitionContext,
  target: LatteFilterRegistrationTarget,
): Promise<boolean> {
  if (!isInlineObjectCallable(target)) {
    return false;
  }

  return context.deps.openPhpMethodTarget(
    target.callable.serviceClassName,
    target.callable.methodName,
  );
}

function isInlineObjectCallable(
  target: LatteFilterRegistrationTarget,
): target is LatteFilterRegistrationTarget & {
  callable: {
    methodName: string;
    serviceClassName: string;
    serviceName?: undefined;
  };
} {
  if (!target.callable?.serviceClassName) {
    return false;
  }

  return target.callable.serviceName === undefined;
}

async function openLatteCoreFilterMethodTarget(
  context: LatteFilterDefinitionContext,
  filterName: string,
): Promise<boolean> {
  const target = latteCoreFilterMethodTarget(filterName);

  if (!target) {
    return false;
  }

  return context.deps.openPhpMethodTarget(target.className, target.methodName);
}

async function openLatteCallableMethodTarget(
  context: LatteFilterDefinitionContext,
  target: LatteFilterRegistrationTarget,
  targetSource: string,
): Promise<boolean> {
  const methodName = target.methodName ?? target.callable?.methodName;
  const serviceClassName =
    target.serviceClassName ?? target.callable?.serviceClassName;
  const serviceName = target.serviceName ?? target.callable?.serviceName;

  if (!methodName) {
    return false;
  }

  const serviceType = serviceClassName
    ? serviceClassName
    : serviceName
      ? await resolveLatteNeonCallableServiceType(
          context,
          targetSource,
          serviceName,
        )
      : null;

  if (!serviceType) {
    return false;
  }

  return context.deps.openPhpMethodTarget(serviceType, methodName);
}

async function resolveLatteNeonCallableServiceType(
  context: LatteFilterDefinitionContext,
  targetSource: string,
  serviceName: string,
): Promise<string | null> {
  const sameFileType = neonServiceTypeInSource(targetSource, serviceName);

  if (sameFileType) {
    return sameFileType;
  }

  if (!context.loadProjectConfig) {
    return null;
  }

  const config = await context.loadProjectConfig();

  if (!context.isRequestedRootActive()) {
    return null;
  }

  return resolveNeonServiceTypeFromMaps(
    serviceName,
    config.serviceNameTypes,
    config.serviceAliases,
  );
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
