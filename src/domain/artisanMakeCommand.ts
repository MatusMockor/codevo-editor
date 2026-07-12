export const artisanMakeGenerators = [
  { label: "Model", type: "model" },
  { label: "Controller", type: "controller" },
  { label: "Migration", type: "migration" },
  { label: "Request", type: "request" },
  { label: "Middleware", type: "middleware" },
  { label: "Seeder", type: "seeder" },
  { label: "Factory", type: "factory" },
  { label: "Policy", type: "policy" },
  { label: "Command", type: "command" },
  { label: "Event", type: "event" },
  { label: "Listener", type: "listener" },
  { label: "Job", type: "job" },
  { label: "Mail", type: "mail" },
  { label: "Notification", type: "notification" },
  { label: "Observer", type: "observer" },
  { label: "Provider", type: "provider" },
  { label: "Rule", type: "rule" },
  { label: "Test", type: "test" },
] as const;

export type ArtisanMakeGeneratorType =
  (typeof artisanMakeGenerators)[number]["type"];

const ARTISAN_MAKE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_/\\]*$/;

export function sanitizeArtisanMakeName(name: string): string | null {
  if (!ARTISAN_MAKE_NAME_PATTERN.test(name)) {
    return null;
  }

  return name;
}

export function artisanMakeCommand(
  type: ArtisanMakeGeneratorType,
  name: string,
): string | null {
  const safeName = sanitizeArtisanMakeName(name);

  if (!safeName) {
    return null;
  }

  const quotedName = `'${safeName.replace(/'/g, "'\\''")}'`;

  return `php artisan make:${type} ${quotedName} --no-interaction`;
}
