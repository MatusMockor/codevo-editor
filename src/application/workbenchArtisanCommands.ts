import type { Command } from "./commandRegistry";

interface WorkbenchArtisanCommandsOptions {
  hasArtisan: boolean;
  runInActiveTerminal(command: string): void;
}

const artisanCommandNames = [
  "about",
  "route:list",
  "migrate:status",
  "config:show",
  "db:show",
  "queue:failed",
  "optimize:clear",
  "cache:clear",
] as const;

export function workbenchArtisanCommands({
  hasArtisan,
  runInActiveTerminal,
}: WorkbenchArtisanCommandsOptions): Command[] {
  if (!hasArtisan) {
    return [];
  }

  return [
    ...artisanCommandNames.map<Command>((name) => ({
      id: `artisan.${name}`,
      title: `artisan: ${name}`,
      category: "Artisan",
      isEnabled: (context) => context.hasWorkspace,
      run: () =>
        runInActiveTerminal(`php artisan ${name} --no-interaction`),
    })),
    {
      id: "artisan.tinker",
      title: "artisan: tinker",
      category: "Artisan",
      isEnabled: (context) => context.hasWorkspace,
      run: () => runInActiveTerminal("php artisan tinker"),
    },
  ];
}
