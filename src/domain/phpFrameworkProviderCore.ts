import type { PhpProjectDescriptor } from "./workspace";

/** UI-facing metadata owned by a framework provider. */
export interface PhpFrameworkProviderPresentation {
  /** Compact framework name shown alongside active IDE runtime status. */
  readonly activityLabel?: string;
}

/**
 * Minimal framework-provider contract used by detection and composition.
 *
 * Feature capabilities intentionally do not belong here. Keeping this port
 * small lets application composition detect a provider without depending on
 * its completion, navigation, diagnostics, or semantic surface.
 */
export interface PhpFrameworkProviderCore {
  readonly id: string;
  readonly presentation?: PhpFrameworkProviderPresentation;
  readonly appliesTo?: (php: PhpProjectDescriptor) => boolean;
}

export function phpFrameworkProviderCoreSignature(
  providers: readonly PhpFrameworkProviderCore[],
): string {
  return providers.map((provider) => provider.id).join(",");
}

export function hasPhpFrameworkProvider(
  providers: readonly PhpFrameworkProviderCore[],
  providerId: string,
): boolean {
  return providers.some((provider) => provider.id === providerId);
}
