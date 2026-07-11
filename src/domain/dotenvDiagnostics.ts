import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import { phpLaravelEnvEntriesFromSource } from "./phpLaravelEnv";

interface DotenvEntry {
  character: number;
  line: number;
  name: string;
}

export function dotenvDiagnosticsFromSource(
  source: string,
): LanguageServerDiagnostic[] {
  const entries = dotenvEntriesFromSource(source);
  const lastEntryIndexByName = new Map<string, number>();

  entries.forEach((entry, index) => {
    lastEntryIndexByName.set(entry.name, index);
  });

  return entries.flatMap((entry, index) => {
    if (lastEntryIndexByName.get(entry.name) === index) {
      return [];
    }

    return [
      {
        character: entry.character,
        endCharacter: entry.character + entry.name.length,
        endLine: entry.line,
        line: entry.line,
        message: `Duplicate key ${entry.name} — overridden by a later assignment`,
        severity: "warning" as const,
        source: "dotenv",
      },
    ];
  });
}

function dotenvEntriesFromSource(source: string): DotenvEntry[] {
  return source.split("\n").flatMap((sourceLine, line) => {
    const entry = phpLaravelEnvEntriesFromSource(sourceLine)[0];

    if (!entry) {
      return [];
    }

    return [
      {
        character: entry.position.column - 1,
        line,
        name: entry.name,
      },
    ];
  });
}
