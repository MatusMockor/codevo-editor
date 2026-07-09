import type { EditorPosition } from "../domain/languageServerFeatures";
import type { NavigationRequest } from "../application/navigationRequest";
import type {
  BladeCompletion,
  LatteCompletion,
  NeonCompletion,
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./languageServerMonacoProviders";

export interface EditorSurfaceFrameworkIntelligenceProviders {
  provideBladeCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideBladeCompletions?(
    source: string,
    position: EditorPosition,
  ): Promise<BladeCompletion[]>;
  provideBladeDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  provideLatteCompletions?(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletion[]>;
  provideLatteDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  provideNeonCompletions?(
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletion[]>;
  provideNeonDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions?(
    source: string,
    offset: number,
  ): Promise<LatteCompletion[] | null>;
  isPhpPresenterLinkCompletionContext?(source: string, offset: number): boolean;
  /**
   * @deprecated Use {@link providePhpPresenterLinkDefinition}. Kept as a
   * temporary compatibility alias while Nette-specific callers migrate.
   */
  provideNettePhpLinkDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkCompletions}. Kept as a
   * temporary compatibility alias while Nette-specific callers migrate.
   */
  provideNettePhpLinkCompletions?(
    source: string,
    offset: number,
  ): Promise<LatteCompletion[] | null>;
  isPhpFrameworkStringCompletionContext?(
    source: string,
    position: EditorPosition,
  ): boolean;
}

export interface EditorSurfaceFrameworkDefinitionProviders {
  providePhpFrameworkDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpLaravelDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export interface ResolvedEditorSurfaceFrameworkProviders {
  provideBladeCodeActions(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideBladeCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<BladeCompletion[]>;
  provideBladeDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletion[]>;
  provideLatteDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  provideNeonCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletion[]>;
  provideNeonDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletion[] | null>;
  isPhpPresenterLinkCompletionContext(source: string, offset: number): boolean;
  isPhpFrameworkStringCompletionContext(
    source: string,
    position: EditorPosition,
  ): boolean;
  providePhpFrameworkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function resolveEditorSurfaceFrameworkProviders({
  frameworkIntelligenceProviders,
  providePhpFrameworkDefinition,
  providePhpLaravelDefinition,
}: {
  frameworkIntelligenceProviders?: EditorSurfaceFrameworkIntelligenceProviders;
} & EditorSurfaceFrameworkDefinitionProviders): ResolvedEditorSurfaceFrameworkProviders {
  return {
    providePhpFrameworkDefinition:
      providePhpFrameworkDefinition ??
      providePhpLaravelDefinition ??
      noopPhpFrameworkDefinition,
    provideBladeCodeActions:
      frameworkIntelligenceProviders?.provideBladeCodeActions ??
      noopPhpCodeActions,
    provideBladeCompletions:
      frameworkIntelligenceProviders?.provideBladeCompletions ??
      noopBladeCompletions,
    provideBladeDefinition:
      frameworkIntelligenceProviders?.provideBladeDefinition ??
      noopPhpFrameworkDefinition,
    provideLatteCompletions:
      frameworkIntelligenceProviders?.provideLatteCompletions ??
      noopLatteCompletions,
    provideLatteDefinition:
      frameworkIntelligenceProviders?.provideLatteDefinition ??
      noopPhpFrameworkDefinition,
    provideNeonCompletions:
      frameworkIntelligenceProviders?.provideNeonCompletions ??
      noopNeonCompletions,
    provideNeonDefinition:
      frameworkIntelligenceProviders?.provideNeonDefinition ??
      noopPhpFrameworkDefinition,
    providePhpPresenterLinkDefinition:
      frameworkIntelligenceProviders?.providePhpPresenterLinkDefinition ??
      frameworkIntelligenceProviders?.provideNettePhpLinkDefinition ??
      noopPhpFrameworkDefinition,
    providePhpPresenterLinkCompletions:
      frameworkIntelligenceProviders?.providePhpPresenterLinkCompletions ??
      frameworkIntelligenceProviders?.provideNettePhpLinkCompletions ??
      noopPhpPresenterLinkCompletions,
    isPhpPresenterLinkCompletionContext:
      frameworkIntelligenceProviders?.isPhpPresenterLinkCompletionContext ??
      noopPhpPresenterLinkCompletionContext,
    isPhpFrameworkStringCompletionContext:
      frameworkIntelligenceProviders?.isPhpFrameworkStringCompletionContext ??
      noopPhpFrameworkStringCompletionContext,
  };
}

const noopPhpFrameworkDefinition = async () => false;
const noopPhpFrameworkStringCompletionContext = () => false;
const noopPhpPresenterLinkCompletionContext = () => false;
const noopPhpCodeActions = async (): Promise<PhpCodeActionDescriptor[]> => [];
const noopBladeCompletions = async (): Promise<BladeCompletion[]> => [];
const noopLatteCompletions = async (): Promise<LatteCompletion[]> => [];
const noopNeonCompletions = async (): Promise<NeonCompletion[]> => [];
const noopPhpPresenterLinkCompletions = async (): Promise<
  LatteCompletion[] | null
> => null;
