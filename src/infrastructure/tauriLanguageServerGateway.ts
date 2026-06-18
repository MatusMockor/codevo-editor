import { invoke } from "@tauri-apps/api/core";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";
import type { JavaScriptTypeScriptVersionPreference } from "../domain/settings";

export class TauriLanguageServerGateway implements LanguageServerGateway {
  planPhpLanguageServer(rootPath: string): Promise<LanguageServerPlan> {
    return invoke<LanguageServerPlan>("plan_php_language_server", {
      rootPath,
    });
  }

  planJavaScriptTypeScriptLanguageServer(
    rootPath: string,
    typeScriptVersionPreference?: JavaScriptTypeScriptVersionPreference,
  ): Promise<LanguageServerPlan> {
    const args: Record<string, unknown> = { rootPath };

    if (typeScriptVersionPreference) {
      args.typeScriptVersionPreference = typeScriptVersionPreference;
    }

    return invoke<LanguageServerPlan>(
      "plan_javascript_typescript_language_server",
      args,
    );
  }
}
