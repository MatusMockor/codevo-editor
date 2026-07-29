import type * as Monaco from "monaco-editor";

export interface TypescriptJavascriptDefaultsOptions {
  managedLanguageServerActive?: boolean;
  validationEnabled?: boolean;
}

const configuredDefaultsByMonaco = new WeakMap<object, string>();

export function configureTypescriptJavascriptDefaultsOnce(
  monaco: typeof Monaco,
  options: TypescriptJavascriptDefaultsOptions = {},
): boolean {
  if (!monaco.languages.typescript) {
    return false;
  }

  const configurationKey = defaultsConfigurationKey(options);
  if (configuredDefaultsByMonaco.get(monaco) === configurationKey) {
    return false;
  }

  configureTypescriptJavascriptDefaults(monaco, options);
  configuredDefaultsByMonaco.set(monaco, configurationKey);
  return true;
}

type ModernCompilerOptions = Monaco.languages.typescript.CompilerOptions & {
  allowImportingTsExtensions?: boolean;
  resolvePackageJsonExports?: boolean;
  resolvePackageJsonImports?: boolean;
};

type ModuleResolutionKinds = typeof Monaco.languages.typescript.ModuleResolutionKind & {
  Bundler?: Monaco.languages.typescript.ModuleResolutionKind;
  NodeNext?: Monaco.languages.typescript.ModuleResolutionKind;
};

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
  const eagerModelSyncEnabled = builtInProvidersEnabled;
  const builtInOnTypeFormattingEnabled = true;
  const validationEnabled = options.validationEnabled ?? true;
  const builtInDiagnosticsEnabled =
    builtInProvidersEnabled && validationEnabled;

  const moduleResolutionKind = typescript.ModuleResolutionKind as ModuleResolutionKinds;
  const sharedCompilerOptions: ModernCompilerOptions = {
    allowSyntheticDefaultImports: true,
    allowNonTsExtensions: true,
    jsx: typescript.JsxEmit.ReactJSX,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: preferredModuleResolutionKind(moduleResolutionKind),
    resolveJsonModule: true,
    target: typescript.ScriptTarget.ESNext,
  };

  if (supportsModernInferredProjectOptions(moduleResolutionKind)) {
    sharedCompilerOptions.allowImportingTsExtensions = true;
    sharedCompilerOptions.resolvePackageJsonExports = true;
    sharedCompilerOptions.resolvePackageJsonImports = true;
  }

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
    onTypeFormattingEdits: builtInOnTypeFormattingEnabled,
    references: builtInProvidersEnabled,
    rename: builtInProvidersEnabled,
    signatureHelp: builtInProvidersEnabled,
  };

  typescript.typescriptDefaults.setModeConfiguration(modeConfiguration);
  typescript.javascriptDefaults.setModeConfiguration(modeConfiguration);
  // Monaco tokenization is independent of the TypeScript worker. When the
  // managed language server owns semantic features, keep worker model sync
  // demand-driven instead of mirroring every retained JS/TS model eagerly.
  typescript.typescriptDefaults.setEagerModelSync(eagerModelSyncEnabled);
  typescript.javascriptDefaults.setEagerModelSync(eagerModelSyncEnabled);
}

function preferredModuleResolutionKind(
  moduleResolutionKind: ModuleResolutionKinds,
): Monaco.languages.typescript.ModuleResolutionKind {
  return (
    moduleResolutionKind.Bundler ??
    moduleResolutionKind.NodeNext ??
    moduleResolutionKind.NodeJs
  );
}

function supportsModernInferredProjectOptions(
  moduleResolutionKind: ModuleResolutionKinds,
): boolean {
  return (
    moduleResolutionKind.Bundler !== undefined ||
    moduleResolutionKind.NodeNext !== undefined
  );
}

function defaultsConfigurationKey(
  options: TypescriptJavascriptDefaultsOptions,
): string {
  return [
    options.managedLanguageServerActive ?? false,
    options.validationEnabled ?? true,
  ].join(":");
}
