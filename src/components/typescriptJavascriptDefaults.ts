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
  const validationEnabled = options.validationEnabled ?? true;
  const builtInProvidersEnabled = !managedLanguageServerActive;
  const builtInDiagnosticsEnabled =
    validationEnabled && builtInProvidersEnabled;

  const sharedCompilerOptions: Monaco.languages.typescript.CompilerOptions = {
    allowNonTsExtensions: true,
    jsx: typescript.JsxEmit.ReactJSX,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
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
    noSyntaxValidation: !builtInDiagnosticsEnabled,
  });
  typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !builtInDiagnosticsEnabled,
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
