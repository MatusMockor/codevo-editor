import { useEffect, useRef } from "react";
import {
  resolveEditorSurfaceFrameworkProviders,
  type EditorSurfaceFrameworkDefinitionProviders,
  type EditorSurfaceFrameworkIntelligenceProviders,
} from "./editorSurfaceFrameworkProviderResolution";

export type {
  EditorSurfaceFrameworkDefinitionProviders,
  EditorSurfaceFrameworkIntelligenceProviders,
} from "./editorSurfaceFrameworkProviderResolution";

export function useEditorSurfaceFrameworkProviderRefs({
  frameworkIntelligenceProviders,
  providePhpFrameworkDefinition,
}: {
  frameworkIntelligenceProviders?: EditorSurfaceFrameworkIntelligenceProviders;
} & EditorSurfaceFrameworkDefinitionProviders) {
  const {
    provideBladeCodeActions: resolvedProvideBladeCodeActions,
    provideBladeCompletions: resolvedProvideBladeCompletions,
    provideBladeDefinition: resolvedProvideBladeDefinition,
    provideLatteCompletions: resolvedProvideLatteCompletions,
    provideLatteDefinition: resolvedProvideLatteDefinition,
    provideNeonCompletions: resolvedProvideNeonCompletions,
    provideNeonDefinition: resolvedProvideNeonDefinition,
    providePhpPresenterLinkDefinition:
      resolvedProvidePhpPresenterLinkDefinition,
    providePhpPresenterLinkCompletions:
      resolvedProvidePhpPresenterLinkCompletions,
    isPhpPresenterLinkCompletionContext:
      resolvedIsPhpPresenterLinkCompletionContext,
    isPhpFrameworkStringCompletionContext:
      resolvedIsPhpFrameworkStringCompletionContext,
    providePhpFrameworkDefinition: resolvedProvidePhpFrameworkDefinition,
  } = resolveEditorSurfaceFrameworkProviders({
    frameworkIntelligenceProviders,
    providePhpFrameworkDefinition,
  });

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
