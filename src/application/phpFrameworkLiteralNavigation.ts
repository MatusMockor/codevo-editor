import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  resolvePhpFrameworkDirectLiteralDefinitionTarget,
  type PhpFrameworkLiteralNavigationDependencies,
  type PhpFrameworkLiteralNavigationDocument,
  type PhpFrameworkLiteralNavigationTarget,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";

export type {
  PhpFrameworkLiteralNavigationDependencies,
  PhpFrameworkLiteralNavigationDocument,
  PhpFrameworkLiteralNavigationTarget,
  PhpFrameworkLiteralRouteTarget,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";

export interface PhpFrameworkLiteralNavigationRequest {
  activeDocument: PhpFrameworkLiteralNavigationDocument | null;
  offset: number;
  position: EditorPosition;
  providers: readonly PhpFrameworkProvider[];
  source: string;
  supportsStringLiterals: boolean;
}

export async function resolvePhpFrameworkLiteralNavigationTarget(
  request: PhpFrameworkLiteralNavigationRequest,
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null> {
  if (!request.supportsStringLiterals) {
    return null;
  }

  return resolvePhpFrameworkDirectLiteralDefinitionTarget(
    request,
    dependencies,
  );
}
