import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { LatteFilterRegistrationTarget } from "./latteFilterDiscovery";
import { neonServiceTypeInSource } from "./netteNeonConfigFacts";
import {
  resolveNeonServiceTypeFromMaps,
  type NeonProjectConfig,
} from "./neonProjectConfigDiscovery";

export interface LatteFilterCallableMetadata {
  className: string;
  declaringClassName: string;
  methodName: string;
  parameters: string;
  returnType: string | null;
}

export interface ResolvedLatteProjectFilter {
  callable?: LatteFilterCallableMetadata;
  name: string;
}

export interface LatteFilterCallableResolutionDependencies {
  readFileContent(path: string): Promise<string>;
  resolvePhpReceiverCompletions(
    source: string,
    position: { column: number; lineNumber: number },
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: { column: number; lineNumber: number }; source: string };
}

export interface LatteFilterCallableResolutionContext {
  deps: LatteFilterCallableResolutionDependencies;
  isRequestedRootActive(): boolean;
  loadProjectConfig?(): Promise<
    Pick<NeonProjectConfig, "serviceAliases" | "serviceNameTypes">
  >;
}

interface ResolutionState {
  members: Map<string, Promise<PhpMethodCompletion[]>>;
  projectConfig?: Promise<
    Pick<NeonProjectConfig, "serviceAliases" | "serviceNameTypes">
  >;
  sources: Map<string, Promise<string | null>>;
}

export async function resolveLatteProjectFilters(
  context: LatteFilterCallableResolutionContext,
  registrations: readonly LatteFilterRegistrationTarget[],
): Promise<ResolvedLatteProjectFilter[]> {
  const state: ResolutionState = {
    members: new Map(),
    sources: new Map(),
  };
  const filters = await Promise.all(
    registrations.map(async (registration) => {
      const callable = await resolveLatteFilterCallable(
        context,
        registration,
        state,
      );

      return callable
        ? { callable, name: registration.name }
        : { name: registration.name };
    }),
  );

  return context.isRequestedRootActive() ? filters : [];
}

export async function resolveLatteFilterCallableMetadata(
  context: LatteFilterCallableResolutionContext,
  registration: LatteFilterRegistrationTarget,
): Promise<LatteFilterCallableMetadata | null> {
  return resolveLatteFilterCallable(context, registration, {
    members: new Map(),
    sources: new Map(),
  });
}

export async function resolveLatteFilterCallableClassName(
  context: {
    deps: Pick<LatteFilterCallableResolutionDependencies, "readFileContent">;
    isRequestedRootActive(): boolean;
    loadProjectConfig?: LatteFilterCallableResolutionContext["loadProjectConfig"];
  },
  registration: LatteFilterRegistrationTarget,
  targetSource?: string,
): Promise<string | null> {
  const serviceClassName =
    registration.serviceClassName ?? registration.callable?.serviceClassName;

  if (serviceClassName) {
    return normalizePhpClassName(serviceClassName);
  }

  const serviceName =
    registration.serviceName ?? registration.callable?.serviceName;

  if (!serviceName) {
    return null;
  }

  const source = targetSource ?? (await readRegistrationSource(context, registration));

  if (!context.isRequestedRootActive() || source === null) {
    return null;
  }

  const sameFileType = neonServiceTypeInSource(source, serviceName);

  if (sameFileType) {
    return normalizePhpClassName(sameFileType);
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

async function resolveLatteFilterCallable(
  context: LatteFilterCallableResolutionContext,
  registration: LatteFilterRegistrationTarget,
  state: ResolutionState,
): Promise<LatteFilterCallableMetadata | null> {
  const methodName =
    registration.methodName ?? registration.callable?.methodName;

  if (!methodName) {
    return null;
  }

  const className = await resolveCallableClassName(
    context,
    registration,
    state,
  );

  if (!context.isRequestedRootActive() || !className) {
    return null;
  }

  const members = await callableMembers(context, className, state);

  if (!context.isRequestedRootActive()) {
    return null;
  }

  const normalizedMethodName = methodName.toLowerCase();
  const method = members.find(
    (member) =>
      member.kind !== "property" &&
      member.kind !== "relation" &&
      (registration.callableKind !== "static" || member.isStatic === true) &&
      member.name.toLowerCase() === normalizedMethodName,
  );

  if (!method) {
    return null;
  }

  return {
    className,
    declaringClassName: method.declaringClassName,
    methodName: method.name,
    parameters: method.parameters,
    returnType: method.returnType,
  };
}

function callableMembers(
  context: LatteFilterCallableResolutionContext,
  className: string,
  state: ResolutionState,
): Promise<PhpMethodCompletion[]> {
  const cacheKey = className.toLowerCase();
  const cached = state.members.get(cacheKey);

  if (cached) {
    return cached;
  }

  const synthetic = context.deps.synthesizeTypedReceiverSource(
    "filterCallable",
    className,
  );
  const members = context.deps.resolvePhpReceiverCompletions(
    synthetic.source,
    synthetic.position,
    "$filterCallable->",
  );
  state.members.set(cacheKey, members);
  return members;
}

async function resolveCallableClassName(
  context: LatteFilterCallableResolutionContext,
  registration: LatteFilterRegistrationTarget,
  state: ResolutionState,
): Promise<string | null> {
  const serviceClassName =
    registration.serviceClassName ?? registration.callable?.serviceClassName;

  if (serviceClassName) {
    return normalizePhpClassName(serviceClassName);
  }

  const serviceName =
    registration.serviceName ?? registration.callable?.serviceName;

  if (!serviceName) {
    return null;
  }

  const source = await cachedRegistrationSource(context, registration.path, state);

  if (!context.isRequestedRootActive() || source === null) {
    return null;
  }

  const sameFileType = neonServiceTypeInSource(source, serviceName);

  if (sameFileType) {
    return normalizePhpClassName(sameFileType);
  }

  if (!context.loadProjectConfig) {
    return null;
  }

  state.projectConfig ??= context.loadProjectConfig();
  const config = await state.projectConfig;

  if (!context.isRequestedRootActive()) {
    return null;
  }

  return resolveNeonServiceTypeFromMaps(
    serviceName,
    config.serviceNameTypes,
    config.serviceAliases,
  );
}

function cachedRegistrationSource(
  context: LatteFilterCallableResolutionContext,
  path: string,
  state: ResolutionState,
): Promise<string | null> {
  const cached = state.sources.get(path);

  if (cached) {
    return cached;
  }

  const source = readSource(context.deps, path);
  state.sources.set(path, source);
  return source;
}

async function readRegistrationSource(
  context: {
    deps: Pick<LatteFilterCallableResolutionDependencies, "readFileContent">;
  },
  registration: LatteFilterRegistrationTarget,
): Promise<string | null> {
  return readSource(context.deps, registration.path);
}

async function readSource(
  deps: Pick<LatteFilterCallableResolutionDependencies, "readFileContent">,
  path: string,
): Promise<string | null> {
  try {
    return await deps.readFileContent(path);
  } catch {
    return null;
  }
}

function normalizePhpClassName(className: string): string {
  return className.trim().replace(/^\\+/, "");
}
