import type { Command } from "./commandRegistry";

interface WorkbenchArtisanCommandsOptions {
  hasArtisan: boolean;
  openArtisanMakePalette(): void;
  openRoutesPanel(): void;
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
  openArtisanMakePalette,
  openRoutesPanel,
  runInActiveTerminal,
}: WorkbenchArtisanCommandsOptions): Command[] {
  if (!hasArtisan) {
    return [];
  }

  return [
    {
      id: "artisan.make",
      title: "artisan: make…",
      category: "Artisan",
      isEnabled: (context) => context.hasWorkspace,
      run: openArtisanMakePalette,
    },
    ...artisanCommandNames.map<Command>((name) => ({
      id: `artisan.${name}`,
      title: `artisan: ${name}`,
      category: "Artisan",
      isEnabled: (context) => context.hasWorkspace,
      run:
        name === "route:list"
          ? openRoutesPanel
          : () => runInActiveTerminal(`php artisan ${name} --no-interaction`),
    })),
    {
      id: "artisan.route:list.terminal",
      title: "artisan: route:list in Terminal",
      category: "Artisan",
      isEnabled: (context) => context.hasWorkspace,
      run: () =>
        runInActiveTerminal("php artisan route:list --no-interaction"),
    },
    {
      id: "artisan.tinker",
      title: "artisan: tinker",
      category: "Artisan",
      isEnabled: (context) => context.hasWorkspace,
      run: () => runInActiveTerminal("php artisan tinker"),
    },
  ];
}
