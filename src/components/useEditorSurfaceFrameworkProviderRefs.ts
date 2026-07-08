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
  provideNettePhpLinkDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
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
  const resolvedProvideNettePhpLinkDefinition =
    frameworkIntelligenceProviders?.provideNettePhpLinkDefinition ??
    noopPhpFrameworkDefinition;
  const resolvedProvideNettePhpLinkCompletions =
    frameworkIntelligenceProviders?.provideNettePhpLinkCompletions ??
    noopNettePhpLinkCompletions;
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
  const nettePhpLinkDefinitionRef = useRef(
    resolvedProvideNettePhpLinkDefinition,
  );
  const nettePhpLinkCompletionsRef = useRef(
    resolvedProvideNettePhpLinkCompletions,
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
    nettePhpLinkDefinitionRef.current = resolvedProvideNettePhpLinkDefinition;
  }, [resolvedProvideNettePhpLinkDefinition]);

  useEffect(() => {
    nettePhpLinkCompletionsRef.current = resolvedProvideNettePhpLinkCompletions;
  }, [resolvedProvideNettePhpLinkCompletions]);

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
    nettePhpLinkCompletionsRef,
    nettePhpLinkDefinitionRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
  };
}

const noopPhpFrameworkDefinition = async () => false;
const noopPhpFrameworkStringCompletionContext = () => false;
const noopPhpCodeActions = async (): Promise<PhpCodeActionDescriptor[]> => [];
const noopBladeCompletions = async (): Promise<BladeCompletion[]> => [];
const noopLatteCompletions = async (): Promise<LatteCompletion[]> => [];
const noopNeonCompletions = async (): Promise<NeonCompletion[]> => [];
const noopNettePhpLinkCompletions = async (): Promise<
  LatteCompletion[] | null
> => null;
