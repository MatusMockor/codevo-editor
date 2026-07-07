import {
  detectNeonClassReferenceAt,
  detectNeonIncludeAt,
} from "../domain/neonConfig";
import {
  detectNeonParameterReferenceAt,
  detectNeonServiceMethodReferenceAt,
  detectNeonServiceReferenceAt,
  detectNeonServiceSetupMethodAt,
  neonGeneratedServiceNamesFromServices,
  neonParametersFromSource,
  neonServicesFromSource,
} from "../domain/netteDiContainer";
import {
  editorPositionAtOffset,
  loadNeonProjectConfig,
  NEON_EXTENSION,
  neonResolvableServiceType,
  neonServiceAliasMapFromSource,
  normalizeNeonServiceType,
  resolveNeonServiceTypeFromMaps,
} from "./neonProjectConfigDiscovery";
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
    return resolveNeonInclude(
      deps,
      requestedRoot,
      isRequestedRootActive,
      include.path,
    );
  }

  return false;
}

/**
 * Navigates a `%param%` reference to its definition: the CURRENT file's
 * `parameters:` leaf first (no I/O), then the merged cross-file project config.
 * Conservative: an unknown parameter resolves to `false`. The post-await
 * live-root re-check drops a switched project's result.
 */
async function resolveNeonParameterDefinition(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  source: string,
  name: string,
): Promise<boolean> {
  const { deps, isRequestedRootActive } = context;
  const currentPath = deps.getActiveDocument()?.path ?? null;
  const sameFileOffset = neonParameterOffsetInSource(source, name);

  if (sameFileOffset !== null && currentPath) {
    return deps.openTarget(
      currentPath,
      editorPositionAtOffset(source, sameFileOffset),
      `%${name}%`,
    );
  }

  const config = await loadNeonProjectConfig(context);

  if (!isRequestedRootActive()) {
    return false;
  }

  const location = config.parameters.get(name);

  if (!location) {
    return false;
  }

  return deps.openTarget(location.path, location.position, `%${name}%`);
}

/**
 * Navigates an `@service` reference to its definition: a class-typed reference
 * (`@\App\Class`, `@Foo\Bar`) resolves through the class index (autowiring by
 * type); a named `@service` resolves to the CURRENT file's `services:` entry
 * first (no I/O), then the merged cross-file project config. Conservative: an
 * unknown named service resolves to `false`.
 */
async function resolveNeonServiceDefinition(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  source: string,
  name: string,
): Promise<boolean> {
  const { deps, isRequestedRootActive } = context;
  const normalizedType = name.includes("\\")
    ? normalizeNeonServiceType(name)
    : null;
  const currentPath = deps.getActiveDocument()?.path ?? null;
  const sameFileOffset = neonServiceOffsetInSource(source, name);

  if (sameFileOffset !== null && currentPath) {
    return deps.openTarget(
      currentPath,
      editorPositionAtOffset(source, sameFileOffset),
      `@${name}`,
    );
  }

  if (normalizedType === null) {
    const config = await loadNeonProjectConfig(context);

    if (!isRequestedRootActive()) {
      return false;
    }

    const location = config.services.get(name);

    if (!location) {
      return false;
    }

    return deps.openTarget(location.path, location.position, `@${name}`);
  }

  const config = await loadNeonProjectConfig(context);

  if (!isRequestedRootActive()) {
    return false;
  }

  const namedTypeLocation =
    config.services.get(name) ?? config.services.get(normalizedType);

  if (namedTypeLocation) {
    return deps.openTarget(
      namedTypeLocation.path,
      namedTypeLocation.position,
      `@${name}`,
    );
  }

  const location = config.serviceTypes.get(normalizedType);

  if (location) {
    return deps.openTarget(location.path, location.position, `@${name}`);
  }

  return deps.openClassTarget(normalizedType);
}

/**
 * Navigates a `setup:` method call (`- setLogger(...)`) to the method on the
 * owning service class. The domain detector already rejects delegated calls such
 * as `@logger::setMailer()`, so this stays bound to the configured service.
 */
async function resolveNeonSetupMethodDefinition(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  setupMethod: {
    methodName: string;
    service: { className: string | null; factory: string | null };
  },
): Promise<boolean> {
  const serviceType = neonSetupServiceType(setupMethod.service);

  if (!serviceType) {
    return false;
  }

  return context.deps.openDirectPhpMethodTarget(
    serviceType,
    setupMethod.methodName,
  );
}

async function resolveNeonServiceMethodDefinition(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  source: string,
  serviceName: string,
  methodName: string,
): Promise<boolean> {
  const serviceType = await resolveNeonServiceType(context, source, serviceName);

  if (!serviceType) {
    return false;
  }

  return context.deps.openDirectPhpMethodTarget(serviceType, methodName);
}

async function resolveNeonServiceType(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  source: string,
  serviceName: string,
): Promise<string | null> {
  const normalizedType = serviceName.includes("\\")
    ? normalizeNeonServiceType(serviceName)
    : null;

  if (normalizedType) {
    return normalizedType;
  }

  const sameFileType = neonServiceTypeInSource(source, serviceName);

  if (sameFileType) {
    return sameFileType;
  }

  const config = await loadNeonProjectConfig(context);

  if (!context.isRequestedRootActive()) {
    return null;
  }

  return resolveNeonServiceTypeFromMaps(
    serviceName,
    config.serviceNameTypes,
    config.serviceAliases,
  );
}

/** The offset of the first `parameters:` leaf named `name` in `source`, or `null`. */
function neonParameterOffsetInSource(source: string, name: string): number | null {
  for (const parameter of neonParametersFromSource(source)) {
    if (parameter.name === name) {
      return parameter.offset;
    }
  }

  return null;
}

/** The offset of the first named service `name` in `source`, or `null`. */
function neonServiceOffsetInSource(source: string, name: string): number | null {
  const services = neonServicesFromSource(source);
  const normalizedType = name.includes("\\")
    ? normalizeNeonServiceType(name)
    : null;

  for (const service of services) {
    if (service.serviceName === name) {
      return service.offset;
    }

    if (
      normalizedType &&
      service.className &&
      normalizeNeonServiceType(service.className) === normalizedType
    ) {
      return service.offset;
    }
  }

  for (const generated of neonGeneratedServiceNamesFromServices(services)) {
    if (generated.name === name) {
      return generated.service.offset;
    }
  }

  return null;
}

function neonServiceTypeInSource(source: string, name: string): string | null {
  const services = neonServicesFromSource(source);
  const normalizedType = name.includes("\\")
    ? normalizeNeonServiceType(name)
    : null;
  const serviceNameTypes = new Map<string, string>();

  for (const service of services) {
    const serviceType = neonResolvableServiceType(service);

    if (service.serviceName === name && serviceType) {
      return serviceType;
    }

    if (
      service.serviceName &&
      serviceType &&
      !serviceNameTypes.has(service.serviceName)
    ) {
      serviceNameTypes.set(service.serviceName, serviceType);
    }

    if (normalizedType && serviceType === normalizedType) {
      return serviceType;
    }
  }

  for (const generated of neonGeneratedServiceNamesFromServices(services)) {
    const generatedType = neonResolvableServiceType(generated.service);

    if (generated.name === name) {
      return generatedType;
    }

    if (!generatedType || serviceNameTypes.has(generated.name)) {
      continue;
    }

    serviceNameTypes.set(generated.name, generatedType);
  }

  return resolveNeonServiceTypeFromMaps(
    name,
    serviceNameTypes,
    neonServiceAliasMapFromSource(source),
  );
}

function neonSetupServiceType(service: {
  className: string | null;
  factory: string | null;
}): string | null {
  return neonResolvableServiceType(service);
}

/**
 * Resolves an `includes:` entry to its `.neon` file (relative to the current
 * config's directory, how NEON resolves includes), verifies it exists via the
 * injected reader, and opens it. Conservative: a path that escapes the workspace
 * root, or a non-existent file, resolves to `false`. The live-root re-check
 * after the read drops a switched project's result.
 */
async function resolveNeonInclude(
  deps: NeonDefinitionDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  includePath: string,
): Promise<boolean> {
  const currentRelativePath = currentNeonRelativePath(deps, requestedRoot);
  const relativePath = resolveNeonRelativePath(includePath, currentRelativePath);

  if (!relativePath) {
    return false;
  }

  const path = deps.joinPath(requestedRoot, relativePath);

  try {
    await deps.readFileContent(path);
  } catch {
    return false;
  }

  if (!isRequestedRootActive()) {
    return false;
  }

  return deps.openTarget(path, { column: 1, lineNumber: 1 }, includePath);
}

function currentNeonRelativePath(
  deps: NeonDefinitionDependencies,
  requestedRoot: string,
): string {
  const document = deps.getActiveDocument();

  if (!document) {
    return "";
  }

  return deps.toRelativePath(requestedRoot, document.path);
}

/**
 * Resolves a NEON include reference to a workspace-relative path, against the
 * current config's directory (a leading `/` is workspace-root relative). `.`/
 * `..` segments are collapsed; a reference that escapes above the root, or is
 * blank, resolves to `null`. A `.neon` extension is appended when the reference
 * has none.
 */
function resolveNeonRelativePath(
  includePath: string,
  currentRelativePath: string,
): string | null {
  const reference = includePath.split("\\").join("/").trim();

  if (reference.length === 0) {
    return null;
  }

  const rootRelative = reference.startsWith("/");
  const base = rootRelative
    ? ""
    : dirnameOf(currentRelativePath.split("\\").join("/").trim());
  const body = rootRelative ? reference.replace(/^\/+/, "") : reference;
  const combined = base.length > 0 ? `${base}/${body}` : body;
  const segments = collapseRelative(combined);

  if (!segments) {
    return null;
  }

  const path = segments.join("/");
  const lastSegment = segments[segments.length - 1] ?? "";

  return lastSegment.includes(".") ? path : `${path}${NEON_EXTENSION}`;
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return path.slice(0, index);
}

/**
 * Collapses `.`/`..`/empty segments. Returns `null` when the path escapes above
 * the workspace root or collapses to nothing.
 */
function collapseRelative(path: string): string[] | null {
  const result: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (result.length === 0) {
        return null;
      }

      result.pop();
      continue;
    }

    result.push(segment);
  }

  return result.length > 0 ? result : null;
}
