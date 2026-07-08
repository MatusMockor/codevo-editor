import {
  neonGeneratedServiceNamesFromServices,
  neonParametersFromSource,
  neonServicesFromSource,
} from "../domain/netteDiContainer";
import {
  neonResolvableServiceType,
  neonServiceAliasMapFromSource,
  normalizeNeonServiceType,
  resolveNeonServiceTypeFromMaps,
} from "./neonProjectConfigDiscovery";

/** The offset of the first `parameters:` leaf named `name` in `source`, or `null`. */
export function neonParameterOffsetInSource(
  source: string,
  name: string,
): number | null {
  for (const parameter of neonParametersFromSource(source)) {
    if (parameter.name === name) {
      return parameter.offset;
    }
  }

  return null;
}

export function neonParameterNamesFromSource(source: string): string[] {
  return neonParametersFromSource(source).map((parameter) => parameter.name);
}

/** The offset of the first named service `name` in `source`, or `null`. */
export function neonServiceOffsetInSource(
  source: string,
  name: string,
): number | null {
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

export function neonServiceNamesFromSource(source: string): string[] {
  const names = new Set<string>();
  const services = neonServicesFromSource(source);

  for (const service of services) {
    if (service.serviceName) {
      names.add(service.serviceName);
    }

    const serviceType = neonResolvableServiceType(service);

    if (serviceType) {
      names.add(serviceType);
    }
  }

  for (const generated of neonGeneratedServiceNamesFromServices(services)) {
    names.add(generated.name);
  }

  return Array.from(names);
}

export function neonServiceTypeInSource(
  source: string,
  name: string,
): string | null {
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
