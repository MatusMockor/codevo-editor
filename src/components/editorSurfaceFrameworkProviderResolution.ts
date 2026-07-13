import type { EditorPosition } from "../domain/languageServerFeatures";
import type { NavigationRequest } from "../application/navigationRequest";
import type {
  BladeCompletion,
  LatteCompletion,
  NeonCompletion,
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./languageServerMonacoProviders";
import type {
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";

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
  provideLatteCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
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
}

export interface ResolvedEditorSurfaceFrameworkProviders {
  templateLanguageProviders: TemplateLanguageProviderRegistry;
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
}: {
  frameworkIntelligenceProviders?: EditorSurfaceFrameworkIntelligenceProviders;
} & EditorSurfaceFrameworkDefinitionProviders): ResolvedEditorSurfaceFrameworkProviders {
  return {
    providePhpFrameworkDefinition:
      providePhpFrameworkDefinition ?? noopPhpFrameworkDefinition,
    templateLanguageProviders: {
      blade: {
        provideCodeActions:
          frameworkIntelligenceProviders?.provideBladeCodeActions ??
          noopPhpCodeActions,
        provideCompletions:
          frameworkIntelligenceProviders?.provideBladeCompletions ??
          noopBladeCompletions,
        provideDefinition:
          frameworkIntelligenceProviders?.provideBladeDefinition ??
          noopPhpFrameworkDefinition,
      },
      latte: {
        provideCodeActions:
          frameworkIntelligenceProviders?.provideLatteCodeActions ??
          noopPhpCodeActions,
        provideCompletions:
          frameworkIntelligenceProviders?.provideLatteCompletions ??
          noopLatteCompletions,
        provideDefinition:
          frameworkIntelligenceProviders?.provideLatteDefinition ??
          noopPhpFrameworkDefinition,
      },
      neon: {
        provideCompletions:
          frameworkIntelligenceProviders?.provideNeonCompletions ??
          noopNeonCompletions,
        provideDefinition:
          frameworkIntelligenceProviders?.provideNeonDefinition ??
          noopPhpFrameworkDefinition,
      },
    },
    providePhpPresenterLinkDefinition:
      frameworkIntelligenceProviders?.providePhpPresenterLinkDefinition ??
      noopPhpFrameworkDefinition,
    providePhpPresenterLinkCompletions:
      frameworkIntelligenceProviders?.providePhpPresenterLinkCompletions ??
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
