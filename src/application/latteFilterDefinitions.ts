import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  latteFilterReferenceAt,
  type LatteFilterReference,
} from "./latteExpressionDetection";
import type { LatteFilterRegistrationTarget } from "./latteFilterDiscovery";
import { latteCoreFilterMethodTarget } from "./latteCoreFilterTargets";
import type { NeonProjectConfig } from "./neonProjectConfigDiscovery";
import {
  resolveLatteFilterCallableClassName,
  resolveLatteFilterCallableMetadata,
  type LatteFilterCallableResolutionDependencies,
} from "./latteFilterCallableResolution";

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
  resolvePhpReceiverCompletions?:
    LatteFilterCallableResolutionDependencies["resolvePhpReceiverCompletions"];
  synthesizeTypedReceiverSource?:
    LatteFilterCallableResolutionDependencies["synthesizeTypedReceiverSource"];
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

  const callableOpened = await openLatteCallableMethodTarget(context, target);

  if (!context.isRequestedRootActive()) {
    return false;
  }

  if (callableOpened) {
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

  return false;
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
): Promise<boolean> {
  const methodName = target.methodName ?? target.callable?.methodName;

  if (!methodName) {
    return false;
  }

  if (target.callableKind === "static") {
    return openStaticLatteCallableMethodTarget(context, target);
  }

  const serviceType = await resolveLatteFilterCallableClassName(
    context,
    target,
  );

  if (!context.isRequestedRootActive() || !serviceType) {
    return false;
  }

  return context.deps.openPhpMethodTarget(serviceType, methodName);
}

async function openStaticLatteCallableMethodTarget(
  context: LatteFilterDefinitionContext,
  target: LatteFilterRegistrationTarget,
): Promise<boolean> {
  const resolvePhpReceiverCompletions =
    context.deps.resolvePhpReceiverCompletions;
  const synthesizeTypedReceiverSource =
    context.deps.synthesizeTypedReceiverSource;

  if (!resolvePhpReceiverCompletions || !synthesizeTypedReceiverSource) {
    return false;
  }

  const callable = await resolveLatteFilterCallableMetadata(
    {
      deps: {
        readFileContent: context.deps.readFileContent,
        resolvePhpReceiverCompletions,
        synthesizeTypedReceiverSource,
      },
      isRequestedRootActive: context.isRequestedRootActive,
      ...(context.loadProjectConfig
        ? { loadProjectConfig: context.loadProjectConfig }
        : {}),
    },
    target,
  );

  if (!context.isRequestedRootActive() || !callable) {
    return false;
  }

  return context.deps.openPhpMethodTarget(
    callable.declaringClassName,
    callable.methodName,
  );
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
