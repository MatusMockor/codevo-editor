import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { phpLaravelFrameworkTargetCollectorAdapter } from "./phpLaravelFrameworkTargetAdapter";
import { phpNetteFrameworkTargetCollectorAdapter } from "./phpNetteFrameworkTargetAdapter";
import type { PhpFrameworkTargetCollectorAdapter } from "./usePhpFrameworkTargets";

export const phpFrameworkTargetCollectorAdapters: readonly PhpFrameworkTargetCollectorAdapter[] =
  [
    phpLaravelFrameworkTargetCollectorAdapter,
    phpNetteFrameworkTargetCollectorAdapter,
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
