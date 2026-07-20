import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpFrameworkCodeActionContribution } from "./phpCodeActionWorkspaceCollector";

export interface ActivePhpFrameworkCodeActionContribution {
  readonly id: string;
  readonly priority?: number;
  readonly providePhpCodeAction: PhpFrameworkCodeActionContribution;
}

/**
 * Framework adapter for PHP code actions. The generic registry invokes these
 * registrations without knowing which framework owns the implementation.
 */
export interface PhpFrameworkCodeActionContributionAdapter {
  readonly id: string;
  readonly priority?: number;
  contributionsFor(
    provider: PhpFrameworkProvider,
  ): readonly ActivePhpFrameworkCodeActionContribution[];
}
