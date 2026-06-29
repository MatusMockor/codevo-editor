import { invoke } from "@tauri-apps/api/core";
import type {
  JavaScriptTypeScriptLanguageServerPlanOptions,
  LanguageServerGateway,
  LanguageServerPlan,
  PhpLanguageServerPlanOptions,
} from "../domain/languageServer";

type InvokeLanguageServerCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<LanguageServerPlan>;

const invokeLanguageServerCommand: InvokeLanguageServerCommand = (
  command,
  args,
) => invoke<LanguageServerPlan>(command, args);

export class TauriLanguageServerGateway implements LanguageServerGateway {
  constructor(
    private readonly invokeCommand: InvokeLanguageServerCommand =
      invokeLanguageServerCommand,
  ) {}

  planPhpLanguageServer(
    rootPath: string,
    options: PhpLanguageServerPlanOptions = {},
  ): Promise<LanguageServerPlan> {
    const args: Record<string, unknown> = { rootPath };

    if (options.phpBackend) {
      args.phpBackend = options.phpBackend;
    }

    if (options.phpactorPath) {
      args.phpactorPath = options.phpactorPath;
    }

    if (options.intelephensePath) {
      args.intelephensePath = options.intelephensePath;
    }

    return this.invokeCommand("plan_php_language_server", args);
  }

  planJavaScriptTypeScriptLanguageServer(
    rootPath: string,
    options: JavaScriptTypeScriptLanguageServerPlanOptions = {},
  ): Promise<LanguageServerPlan> {
    const args: Record<string, unknown> = { rootPath };

    if (options.autoImportsEnabled !== undefined) {
      args.autoImportsEnabled = options.autoImportsEnabled;
    }

    if (options.automaticTypeAcquisitionEnabled !== undefined) {
      args.automaticTypeAcquisitionEnabled =
        options.automaticTypeAcquisitionEnabled;
    }

    if (options.codeLensEnabled !== undefined) {
      args.codeLensEnabled = options.codeLensEnabled;
    }

    if (options.importModuleSpecifierPreference) {
      args.importModuleSpecifierPreference =
        options.importModuleSpecifierPreference;
    }

    if (options.typeScriptVersionPreference) {
      args.typeScriptVersionPreference = options.typeScriptVersionPreference;
    }

    if (options.inlayHintsEnabled !== undefined) {
      args.inlayHintsEnabled = options.inlayHintsEnabled;
    }

    if (options.preferTypeOnlyAutoImports !== undefined) {
      args.preferTypeOnlyAutoImports = options.preferTypeOnlyAutoImports;
    }

    if (options.quotePreference) {
      args.quotePreference = options.quotePreference;
    }

    if (options.validationEnabled !== undefined) {
      args.validationEnabled = options.validationEnabled;
    }

    return this.invokeCommand("plan_javascript_typescript_language_server", args);
  }
}
