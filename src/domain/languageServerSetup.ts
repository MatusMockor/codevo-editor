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
      title: "PHPactor Blocked",
      message: plan.message,
      commands: [],
    };
  }

  return {
    title: "PHPactor Setup",
    message: plan.message,
    commands: [
      {
        id: "composer-require",
        label: "Install locally",
        command: "composer require --dev phpactor/phpactor",
      },
      {
        id: "composer-exec",
        label: "Verify language server",
        command: "composer exec phpactor -- language-server",
      },
    ],
  };
}
