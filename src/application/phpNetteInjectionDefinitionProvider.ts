import { netteInjectionTypeReferenceAt } from "../domain/netteDiContainer";
import { getFileName } from "../domain/workspace";
import type { NeonIntelligenceDependencies } from "./neonIntelligenceContracts";
import type { NeonRequestContext } from "./neonIntelligenceRuntime";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import {
  loadNeonProjectConfig,
  neonServiceDefinitionLocations,
} from "./neonProjectConfigDiscovery";

export async function providePhpNetteInjectionDefinition(
  context: NeonRequestContext<NeonIntelligenceDependencies>,
  source: string,
  offset: number,
  request?: NavigationRequest,
): Promise<boolean> {
  const canCommit = () =>
    context.isRequestedRootActive() && canNavigate(request);

  if (!canCommit()) {
    return false;
  }

  const reference = netteInjectionTypeReferenceAt(source, offset);

  if (!reference) {
    return false;
  }

  const config = await loadNeonProjectConfig(context);

  if (!canCommit()) {
    return false;
  }

  const locations = neonServiceDefinitionLocations(config, reference.className);

  if (locations.length > 1) {
    const targets = locations.map((location) => ({
      detail: context.deps.toRelativePath(context.requestedRoot, location.path),
      id: `${location.path}:${location.position.lineNumber}:${location.position.column}`,
      label: `${getFileName(location.path)}:${location.position.lineNumber}`,
      path: location.path,
      position: location.position,
    }));
    const label = reference.type.split("\\").pop() ?? reference.type;

    if (!canCommit()) {
      return false;
    }

    context.deps.setImplementationChooser({
      targets,
      title: `Choose service registration of ${label}`,
    });
    return true;
  }

  const [location] = locations;

  if (!location) {
    return false;
  }

  const opened = await context.deps.openTarget(
    location.path,
    location.position,
    reference.type.split("\\").pop() ?? reference.type,
    { shouldCommit: canCommit },
  );

  if (!canCommit()) {
    return false;
  }

  return opened;
}
