import { invoke } from "@tauri-apps/api/core";
import type {
  JavaScriptTypeScriptLanguageServerPlanOptions,
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";

export class TauriLanguageServerGateway implements LanguageServerGateway {
  planPhpLanguageServer(rootPath: string): Promise<LanguageServerPlan> {
    return invoke<LanguageServerPlan>("plan_php_language_server", {
      rootPath,
    });
  }

  planJavaScriptTypeScriptLanguageServer(
    rootPath: string,
    options: JavaScriptTypeScriptLanguageServerPlanOptions = {},
  ): Promise<LanguageServerPlan> {
    const args: Record<string, unknown> = { rootPath };

    if (options.typeScriptVersionPreference) {
      args.typeScriptVersionPreference = options.typeScriptVersionPreference;
    }

    if (options.inlayHintsEnabled !== undefined) {
      args.inlayHintsEnabled = options.inlayHintsEnabled;
    }

    return invoke<LanguageServerPlan>(
      "plan_javascript_typescript_language_server",
      args,
    );
  }
}
