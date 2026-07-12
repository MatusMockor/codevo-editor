import type { LanguageServerPlan } from "./languageServer";

export interface LanguageServerSetupGuide {
  title: string;
  message: string;
  commands: LanguageServerSetupCommand[];
}

export interface LanguageServerSetupCommand {
  id: string;
  label: string;
  command: string;
}

export function createPhpactorSetupGuide(
  plan: LanguageServerPlan | null,
): LanguageServerSetupGuide | null {
  if (!plan) {
    return null;
  }

  if (plan.provider !== "phpactor") {
    return null;
  }

  if (plan.status === "ready") {
    return null;
  }

  if (plan.status === "blocked") {
    return {
      title: "PHP IDE Engine Blocked",
      message: plan.message,
      commands: [],
    };
  }

  return {
    title: "PHP IDE Engine Setup",
    message: plan.message,
    commands: [
      {
        id: "managed-install",
        label: "Install managed engine",
        command:
          "mkdir -p \"$HOME/Library/Application Support/Codevo Editor/tools/phpactor\" && cd \"$HOME/Library/Application Support/Codevo Editor/tools/phpactor\" && ([ -f composer.json ] || composer init --name codevo/editor-php-engine --type project --no-interaction) && composer config minimum-stability dev && composer config prefer-stable true && composer require phpactor/phpactor:2026.05.30.2 -W --no-interaction",
      },
      {
        id: "managed-verify",
        label: "Verify managed engine",
        command:
          "\"$HOME/Library/Application Support/Codevo Editor/tools/phpactor/vendor/bin/phpactor\" language-server",
      },
    ],
  };
}
