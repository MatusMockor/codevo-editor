import type * as Monaco from "monaco-editor";

export function configureTypescriptJavascriptDefaults(
  monaco: typeof Monaco,
): void {
  const typescript = monaco.languages.typescript;

  if (!typescript) {
    return;
  }

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
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  typescript.typescriptDefaults.setEagerModelSync(true);
  typescript.javascriptDefaults.setEagerModelSync(true);
}
