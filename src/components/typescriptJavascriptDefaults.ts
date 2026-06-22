import type * as Monaco from "monaco-editor";

export interface TypescriptJavascriptDefaultsOptions {
  managedLanguageServerActive?: boolean;
  validationEnabled?: boolean;
}

export function configureTypescriptJavascriptDefaults(
  monaco: typeof Monaco,
  options: TypescriptJavascriptDefaultsOptions = {},
): void {
  const typescript = monaco.languages.typescript;

  if (!typescript) {
    return;
  }

  const managedLanguageServerActive =
    options.managedLanguageServerActive ?? false;
  const builtInProvidersEnabled = !managedLanguageServerActive;
  // The managed language server always owns JS/TS diagnostics for parity with
  // the desktop IDE. Monaco's built-in TypeScript worker runs in the browser
  // without node_modules, so leaving its diagnostics on produces false
  // "Cannot find module" (TS2307) markers on JSX before the managed server
  // reports anything. Keep the built-in diagnostics off unconditionally so the
  // worker never publishes those phantom markers, regardless of LSP timing or
  // the user's validation preference (which is forwarded to the managed
  // server, not to Monaco's built-in worker).
  const builtInDiagnosticsEnabled = false;

  const sharedCompilerOptions: Monaco.languages.typescript.CompilerOptions = {
    allowSyntheticDefaultImports: true,
    allowNonTsExtensions: true,
    jsx: typescript.JsxEmit.ReactJSX,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    resolveJsonModule: true,
    target: typescript.ScriptTarget.ESNext,
  };

  typescript.typescriptDefaults.setCompilerOptions(sharedCompilerOptions);
  typescript.javascriptDefaults.setCompilerOptions({
    ...sharedCompilerOptions,
    allowJs: true,
    checkJs: false,
  });
  typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !builtInDiagnosticsEnabled,
    noSuggestionDiagnostics: !builtInDiagnosticsEnabled,
    noSyntaxValidation: !builtInDiagnosticsEnabled,
  });
  typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !builtInDiagnosticsEnabled,
    noSuggestionDiagnostics: !builtInDiagnosticsEnabled,
    noSyntaxValidation: !builtInDiagnosticsEnabled,
  });
  const modeConfiguration: Monaco.languages.typescript.ModeConfiguration = {
    codeActions: builtInProvidersEnabled,
    completionItems: builtInProvidersEnabled,
    definitions: builtInProvidersEnabled,
    diagnostics: builtInDiagnosticsEnabled,
    documentHighlights: builtInProvidersEnabled,
    documentRangeFormattingEdits: builtInProvidersEnabled,
    documentSymbols: builtInProvidersEnabled,
    hovers: builtInProvidersEnabled,
    inlayHints: builtInProvidersEnabled,
    onTypeFormattingEdits: builtInProvidersEnabled,
    references: builtInProvidersEnabled,
    rename: builtInProvidersEnabled,
    signatureHelp: builtInProvidersEnabled,
  };

  typescript.typescriptDefaults.setModeConfiguration(modeConfiguration);
  typescript.javascriptDefaults.setModeConfiguration(modeConfiguration);
  typescript.typescriptDefaults.setEagerModelSync(true);
  typescript.javascriptDefaults.setEagerModelSync(true);
}
