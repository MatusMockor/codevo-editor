import type {
  JavaScriptTypeScriptLanguageServerPlanOptions,
} from "../domain/languageServer";
import type {
  LanguageServerConfigurationSettings,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStartOptions } from "../domain/languageServerRuntime";
import type { WorkspaceSettings } from "../domain/settings";
import { formattingOptionsFromContent } from "../domain/formattingOptionsFromContent";
import {
  editorConfigFormattingOptions,
  type ResolvedEditorConfig,
} from "../domain/editorConfig";
import type { EditorDocument } from "../domain/workspace";

export type JavaScriptTypeScriptSettingsChangeKind =
  | "none"
  | "configuration"
  | "restart";

export function javaScriptTypeScriptSettingsChangeKind(
  previousSettings: WorkspaceSettings,
  nextSettings: WorkspaceSettings,
): JavaScriptTypeScriptSettingsChangeKind {
  if (
    previousSettings.javaScriptTypeScriptVersion !==
      nextSettings.javaScriptTypeScriptVersion ||
    previousSettings.javaScriptTypeScriptAutomaticTypeAcquisition !==
      nextSettings.javaScriptTypeScriptAutomaticTypeAcquisition
  ) {
    return "restart";
  }

  if (
    previousSettings.javaScriptTypeScriptAutoImports !==
      nextSettings.javaScriptTypeScriptAutoImports ||
    previousSettings.javaScriptTypeScriptCodeLens !==
      nextSettings.javaScriptTypeScriptCodeLens ||
    previousSettings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions !==
      nextSettings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions ||
    previousSettings.javaScriptTypeScriptCompleteFunctionCalls !==
      nextSettings.javaScriptTypeScriptCompleteFunctionCalls ||
    previousSettings.javaScriptTypeScriptImportModuleSpecifierEnding !==
      nextSettings.javaScriptTypeScriptImportModuleSpecifierEnding ||
    previousSettings.javaScriptTypeScriptImportModuleSpecifierPreference !==
      nextSettings.javaScriptTypeScriptImportModuleSpecifierPreference ||
    previousSettings.javaScriptTypeScriptInlayHints !==
      nextSettings.javaScriptTypeScriptInlayHints ||
    previousSettings.javaScriptTypeScriptPreferTypeOnlyAutoImports !==
      nextSettings.javaScriptTypeScriptPreferTypeOnlyAutoImports ||
    previousSettings.javaScriptTypeScriptQuotePreference !==
      nextSettings.javaScriptTypeScriptQuotePreference ||
    previousSettings.javaScriptTypeScriptValidation !==
      nextSettings.javaScriptTypeScriptValidation
  ) {
    return "configuration";
  }

  return "none";
}

export function javaScriptTypeScriptLanguageServerOptions(
  settings: WorkspaceSettings,
): JavaScriptTypeScriptLanguageServerPlanOptions &
  LanguageServerRuntimeStartOptions {
  return {
    autoImportsEnabled: settings.javaScriptTypeScriptAutoImports,
    automaticTypeAcquisitionEnabled:
      settings.javaScriptTypeScriptAutomaticTypeAcquisition,
    codeLensEnabled: settings.javaScriptTypeScriptCodeLens,
    completeFunctionCalls: settings.javaScriptTypeScriptCompleteFunctionCalls,
    inlayHintsEnabled: settings.javaScriptTypeScriptInlayHints,
    typeScriptVersionPreference: settings.javaScriptTypeScriptVersion,
    validationEnabled: settings.javaScriptTypeScriptValidation,
    ...javaScriptTypeScriptImportPreferenceOptions(settings),
  };
}

export function javaScriptTypeScriptLanguageServerConfiguration(
  settings: WorkspaceSettings,
  activeEditorConfig: ResolvedEditorConfig = {},
  activeDocument: EditorDocument | null = null,
): LanguageServerConfigurationSettings {
  const autoImportsEnabled = settings.javaScriptTypeScriptAutoImports;
  const codeLensEnabled = settings.javaScriptTypeScriptCodeLens;
  const showReferencesCodeLensOnAllFunctions =
    settings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions;
  const completeFunctionCalls = settings.javaScriptTypeScriptCompleteFunctionCalls;
  const inlayHintsEnabled = settings.javaScriptTypeScriptInlayHints;
  const validationEnabled = settings.javaScriptTypeScriptValidation;
  const formattingOptions = formattingOptionsForActiveJavaScriptTypeScriptDocument(
    settings,
    activeEditorConfig,
    activeDocument,
  );
  const parameterNameHints = inlayHintsEnabled ? "literals" : "none";
  const preferences = {
    includeAutomaticOptionalChainCompletions: true,
    includeCompletionsWithSnippetText: true,
    includeCompletionsForImportStatements: autoImportsEnabled,
    includeCompletionsForModuleExports: autoImportsEnabled,
    includePackageJsonAutoImports: autoImportsEnabled ? "auto" : "off",
    importModuleSpecifierEnding:
      settings.javaScriptTypeScriptImportModuleSpecifierEnding,
    importModuleSpecifierPreference:
      settings.javaScriptTypeScriptImportModuleSpecifierPreference,
    includeInlayEnumMemberValueHints: inlayHintsEnabled,
    includeInlayFunctionLikeReturnTypeHints: inlayHintsEnabled,
    includeInlayFunctionParameterTypeHints: inlayHintsEnabled,
    includeInlayParameterNameHints: parameterNameHints,
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: inlayHintsEnabled,
    includeInlayVariableTypeHints: inlayHintsEnabled,
    includeInlayVariableTypeHintsWhenTypeMatchesName: false,
    mockorCodeLensEnabled: codeLensEnabled,
    mockorValidationEnabled: validationEnabled,
    preferTypeOnlyAutoImports:
      settings.javaScriptTypeScriptPreferTypeOnlyAutoImports,
    quotePreference: settings.javaScriptTypeScriptQuotePreference,
  };

  return {
    formattingOptions,
    implicitProjectConfiguration: {
      checkJs: false,
      experimentalDecorators: false,
      module: 99,
      strict: true,
      strictFunctionTypes: true,
      strictNullChecks: true,
      target: 11,
    },
    implementationsCodeLens: { enabled: codeLensEnabled },
    inlayHints: {
      enumMemberValues: { enabled: inlayHintsEnabled },
      functionLikeReturnTypes: { enabled: inlayHintsEnabled },
      parameterNames: {
        enabled: parameterNameHints,
        suppressWhenArgumentMatchesName: false,
      },
      parameterTypes: { enabled: inlayHintsEnabled },
      propertyDeclarationTypes: { enabled: inlayHintsEnabled },
      variableTypes: {
        enabled: inlayHintsEnabled,
        suppressWhenTypeMatchesName: false,
      },
    },
    preferences,
    updateImportsOnFileMove: {
      enabled: autoImportsEnabled ? "always" : "never",
    },
    validate: {
      enable: validationEnabled,
    },
    referencesCodeLens: {
      enabled: codeLensEnabled,
      showOnAllFunctions: showReferencesCodeLensOnAllFunctions,
    },
    suggest: {
      autoImports: autoImportsEnabled,
      completeFunctionCalls,
      includeAutomaticOptionalChainCompletions: true,
      includeCompletionsForImportStatements: autoImportsEnabled,
      includeCompletionsForModuleExports: autoImportsEnabled,
    },
  };
}

export function formattingOptionsForActiveJavaScriptTypeScriptDocument(
  settings: WorkspaceSettings,
  activeEditorConfig: ResolvedEditorConfig,
  activeDocument: EditorDocument | null,
) {
  return (
    editorConfigFormattingOptions(activeEditorConfig) ??
    formattingOptionsFromContent(activeDocument?.content ?? "", {
      insertSpaces: settings.defaultInsertSpaces,
      tabSize: settings.defaultTabSize,
    })
  );
}

function javaScriptTypeScriptImportPreferenceOptions(settings: WorkspaceSettings) {
  return {
    ...(settings.javaScriptTypeScriptImportModuleSpecifierPreference !==
    "shortest"
      ? {
          importModuleSpecifierPreference:
            settings.javaScriptTypeScriptImportModuleSpecifierPreference,
        }
      : {}),
    ...(settings.javaScriptTypeScriptImportModuleSpecifierEnding !== "auto"
      ? {
          importModuleSpecifierEnding:
            settings.javaScriptTypeScriptImportModuleSpecifierEnding,
        }
      : {}),
    ...(settings.javaScriptTypeScriptPreferTypeOnlyAutoImports
      ? {
          preferTypeOnlyAutoImports:
            settings.javaScriptTypeScriptPreferTypeOnlyAutoImports,
        }
      : {}),
    ...(settings.javaScriptTypeScriptQuotePreference !== "auto"
      ? { quotePreference: settings.javaScriptTypeScriptQuotePreference }
      : {}),
  };
}
