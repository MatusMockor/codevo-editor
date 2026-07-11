import { netteInjectionTypeReferenceAt } from "../domain/netteDiContainer";
import type { NeonDefinitionDependencies } from "./neonDefinitionProvider";
import type { NeonRequestContext } from "./neonIntelligenceRuntime";
import {
  loadNeonProjectConfig,
  neonServiceDefinitionLocations,
} from "./neonProjectConfigDiscovery";

export async function providePhpNetteInjectionDefinition(
  context: NeonRequestContext<NeonDefinitionDependencies>,
  source: string,
  offset: number,
): Promise<boolean> {
  const reference = netteInjectionTypeReferenceAt(source, offset);

  if (!reference) {
    return false;
  }

  const config = await loadNeonProjectConfig(context);

  if (!context.isRequestedRootActive()) {
    return false;
  }

  const [location] = neonServiceDefinitionLocations(config, reference.className);

  if (!location) {
    return false;
  }

  const opened = await context.deps.openTarget(
    location.path,
    location.position,
    reference.type.split("\\").pop() ?? reference.type,
  );

  if (!context.isRequestedRootActive()) {
    return false;
  }

  return opened;
}
