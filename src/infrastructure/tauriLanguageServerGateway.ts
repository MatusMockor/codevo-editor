import { invoke } from "@tauri-apps/api/core";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";

export class TauriLanguageServerGateway implements LanguageServerGateway {
  planPhpLanguageServer(rootPath: string): Promise<LanguageServerPlan> {
    return invoke<LanguageServerPlan>("plan_php_language_server", {
      rootPath,
    });
  }
}
