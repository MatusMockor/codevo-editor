import type { EditorPosition } from "../domain/languageServerFeatures";
import type { NavigationRequest } from "../application/navigationRequest";
import type { PhpCodeActionContext } from "../application/phpCodeActionTypes";
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
    context?: PhpCodeActionContext,
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
    context?: PhpCodeActionContext,
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
    templateLanguageProviders: resolveTemplateLanguageProviders(
      frameworkIntelligenceProviders,
    ),
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

type TemplateLanguageProviderResolvers = {
  [Language in keyof TemplateLanguageProviderRegistry]: (
    providers: EditorSurfaceFrameworkIntelligenceProviders | undefined,
  ) => TemplateLanguageProviderRegistry[Language];
};

const TEMPLATE_LANGUAGE_PROVIDER_RESOLVERS: TemplateLanguageProviderResolvers =
  {
    blade: (providers) => ({
      provideCodeActions:
        providers?.provideBladeCodeActions ?? noopPhpCodeActions,
      provideCompletions:
        providers?.provideBladeCompletions ?? noopBladeCompletions,
      provideDefinition:
        providers?.provideBladeDefinition ?? noopPhpFrameworkDefinition,
    }),
    latte: (providers) => ({
      provideCodeActions:
        providers?.provideLatteCodeActions ?? noopPhpCodeActions,
      provideCompletions:
        providers?.provideLatteCompletions ?? noopLatteCompletions,
      provideDefinition:
        providers?.provideLatteDefinition ?? noopPhpFrameworkDefinition,
    }),
    neon: (providers) => ({
      provideCompletions:
        providers?.provideNeonCompletions ?? noopNeonCompletions,
      provideDefinition:
        providers?.provideNeonDefinition ?? noopPhpFrameworkDefinition,
    }),
  };

const TEMPLATE_LANGUAGE_IDS = Object.keys(
  TEMPLATE_LANGUAGE_PROVIDER_RESOLVERS,
) as readonly (keyof TemplateLanguageProviderRegistry)[];

function resolveTemplateLanguageProviders(
  providers: EditorSurfaceFrameworkIntelligenceProviders | undefined,
): TemplateLanguageProviderRegistry {
  const registry = {} as TemplateLanguageProviderRegistry;
  for (const language of TEMPLATE_LANGUAGE_IDS) {
    assignTemplateLanguageProviders(registry, language, providers);
  }

  return registry;
}

function assignTemplateLanguageProviders<
  Language extends keyof TemplateLanguageProviderRegistry,
>(
  registry: TemplateLanguageProviderRegistry,
  language: Language,
  providers: EditorSurfaceFrameworkIntelligenceProviders | undefined,
): void {
  registry[language] = TEMPLATE_LANGUAGE_PROVIDER_RESOLVERS[language](
    providers,
  );
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
