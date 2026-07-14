import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { phpLaravelFrameworkTargetCollectorAdapters } from "./phpLaravelFrameworkTargetAdapter";
import { phpNetteFrameworkTargetCollectorAdapters } from "./phpNetteFrameworkTargetAdapter";
import type { PhpFrameworkTargetCollectorAdapter } from "./usePhpFrameworkTargets";

export const phpFrameworkTargetCollectorAdapters: readonly PhpFrameworkTargetCollectorAdapter[] =
  [
    ...phpLaravelFrameworkTargetCollectorAdapters,
    ...phpNetteFrameworkTargetCollectorAdapters,
  ];

export function activePhpFrameworkTargetCollectorAdapter<
  Adapter extends Pick<PhpFrameworkTargetCollectorAdapter, "providerId">,
>(
  adapters: readonly Adapter[],
  frameworkIntelligence: Pick<PhpFrameworkIntelligence, "hasProvider">,
): Adapter | null {
  return (
    adapters.find((adapter) =>
      frameworkIntelligence.hasProvider(adapter.providerId),
    ) ?? null
  );
}
