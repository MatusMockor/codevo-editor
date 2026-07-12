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
    templateLanguageProviders: resolvedTemplateLanguageProviders,
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

  const templateLanguageProvidersRef = useRef(
    resolvedTemplateLanguageProviders,
  );
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
    templateLanguageProvidersRef.current = resolvedTemplateLanguageProviders;
  }, [resolvedTemplateLanguageProviders]);

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
    templateLanguageProvidersRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
  };
}
