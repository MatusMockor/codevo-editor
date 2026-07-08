import { useEffect, useRef } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
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
  provideBladeDefinition?(source: string, offset: number): Promise<boolean>;
  provideLatteCompletions?(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletion[]>;
  provideLatteDefinition?(source: string, offset: number): Promise<boolean>;
  provideNeonCompletions?(
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletion[]>;
  provideNeonDefinition?(source: string, offset: number): Promise<boolean>;
  providePhpPresenterLinkDefinition?(
    source: string,
    offset: number,
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
  ): Promise<boolean>;
  providePhpLaravelDefinition?(source: string, offset: number): Promise<boolean>;
}

export function useEditorSurfaceFrameworkProviderRefs({
  frameworkIntelligenceProviders,
  providePhpFrameworkDefinition,
  providePhpLaravelDefinition,
}: {
  frameworkIntelligenceProviders?: EditorSurfaceFrameworkIntelligenceProviders;
} & EditorSurfaceFrameworkDefinitionProviders) {
  const resolvedProvidePhpFrameworkDefinition =
    providePhpFrameworkDefinition ??
    providePhpLaravelDefinition ??
    noopPhpFrameworkDefinition;
  const resolvedProvideBladeCodeActions =
    frameworkIntelligenceProviders?.provideBladeCodeActions ??
    noopPhpCodeActions;
  const resolvedProvideBladeCompletions =
    frameworkIntelligenceProviders?.provideBladeCompletions ??
    noopBladeCompletions;
  const resolvedProvideBladeDefinition =
    frameworkIntelligenceProviders?.provideBladeDefinition ??
    noopPhpFrameworkDefinition;
  const resolvedProvideLatteCompletions =
    frameworkIntelligenceProviders?.provideLatteCompletions ??
    noopLatteCompletions;
  const resolvedProvideLatteDefinition =
    frameworkIntelligenceProviders?.provideLatteDefinition ??
    noopPhpFrameworkDefinition;
  const resolvedProvideNeonCompletions =
    frameworkIntelligenceProviders?.provideNeonCompletions ??
    noopNeonCompletions;
  const resolvedProvideNeonDefinition =
    frameworkIntelligenceProviders?.provideNeonDefinition ??
    noopPhpFrameworkDefinition;
  const resolvedProvidePhpPresenterLinkDefinition =
    frameworkIntelligenceProviders?.providePhpPresenterLinkDefinition ??
    frameworkIntelligenceProviders?.provideNettePhpLinkDefinition ??
    noopPhpFrameworkDefinition;
  const resolvedProvidePhpPresenterLinkCompletions =
    frameworkIntelligenceProviders?.providePhpPresenterLinkCompletions ??
    frameworkIntelligenceProviders?.provideNettePhpLinkCompletions ??
    noopPhpPresenterLinkCompletions;
  const resolvedIsPhpPresenterLinkCompletionContext =
    frameworkIntelligenceProviders?.isPhpPresenterLinkCompletionContext ??
    noopPhpPresenterLinkCompletionContext;
  const resolvedIsPhpFrameworkStringCompletionContext =
    frameworkIntelligenceProviders?.isPhpFrameworkStringCompletionContext ??
    noopPhpFrameworkStringCompletionContext;

  const bladeCodeActionsRef = useRef(resolvedProvideBladeCodeActions);
  const bladeCompletionsRef = useRef(resolvedProvideBladeCompletions);
  const bladeDefinitionRef = useRef(resolvedProvideBladeDefinition);
  const latteCompletionsRef = useRef(resolvedProvideLatteCompletions);
  const latteDefinitionRef = useRef(resolvedProvideLatteDefinition);
  const neonCompletionsRef = useRef(resolvedProvideNeonCompletions);
  const neonDefinitionRef = useRef(resolvedProvideNeonDefinition);
  const phpPresenterLinkDefinitionRef = useRef(
    resolvedProvidePhpPresenterLinkDefinition,
  );
  const phpPresenterLinkCompletionsRef = useRef(
    resolvedProvidePhpPresenterLinkCompletions,
  );
  const phpPresenterLinkCompletionContextRef = useRef(
    resolvedIsPhpPresenterLinkCompletionContext,
  );
  const phpFrameworkStringCompletionContextRef = useRef(
    resolvedIsPhpFrameworkStringCompletionContext,
  );
  const phpFrameworkDefinitionRef = useRef(
    resolvedProvidePhpFrameworkDefinition,
  );

  useEffect(() => {
    bladeCodeActionsRef.current = resolvedProvideBladeCodeActions;
  }, [resolvedProvideBladeCodeActions]);

  useEffect(() => {
    bladeCompletionsRef.current = resolvedProvideBladeCompletions;
  }, [resolvedProvideBladeCompletions]);

  useEffect(() => {
    bladeDefinitionRef.current = resolvedProvideBladeDefinition;
  }, [resolvedProvideBladeDefinition]);

  useEffect(() => {
    latteCompletionsRef.current = resolvedProvideLatteCompletions;
  }, [resolvedProvideLatteCompletions]);

  useEffect(() => {
    latteDefinitionRef.current = resolvedProvideLatteDefinition;
  }, [resolvedProvideLatteDefinition]);

  useEffect(() => {
    neonCompletionsRef.current = resolvedProvideNeonCompletions;
  }, [resolvedProvideNeonCompletions]);

  useEffect(() => {
    neonDefinitionRef.current = resolvedProvideNeonDefinition;
  }, [resolvedProvideNeonDefinition]);

  useEffect(() => {
    phpPresenterLinkDefinitionRef.current =
      resolvedProvidePhpPresenterLinkDefinition;
  }, [resolvedProvidePhpPresenterLinkDefinition]);

  useEffect(() => {
    phpPresenterLinkCompletionsRef.current =
      resolvedProvidePhpPresenterLinkCompletions;
  }, [resolvedProvidePhpPresenterLinkCompletions]);

  useEffect(() => {
    phpPresenterLinkCompletionContextRef.current =
      resolvedIsPhpPresenterLinkCompletionContext;
  }, [resolvedIsPhpPresenterLinkCompletionContext]);

  useEffect(() => {
    phpFrameworkStringCompletionContextRef.current =
      resolvedIsPhpFrameworkStringCompletionContext;
  }, [resolvedIsPhpFrameworkStringCompletionContext]);

  useEffect(() => {
    phpFrameworkDefinitionRef.current = resolvedProvidePhpFrameworkDefinition;
  }, [resolvedProvidePhpFrameworkDefinition]);

  return {
    bladeCodeActionsRef,
    bladeCompletionsRef,
    bladeDefinitionRef,
    latteCompletionsRef,
    latteDefinitionRef,
    neonCompletionsRef,
    neonDefinitionRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    nettePhpLinkCompletionsRef: phpPresenterLinkCompletionsRef,
    nettePhpLinkDefinitionRef: phpPresenterLinkDefinitionRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
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
