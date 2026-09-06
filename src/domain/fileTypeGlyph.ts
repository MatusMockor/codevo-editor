export type FileTypeGlyphKind =
  | "ts"
  | "tsx"
  | "js"
  | "json"
  | "npm"
  | "md"
  | "css"
  | "sh"
  | "docker"
  | "git"
  | "env"
  | "lock"
  | "file";

export const FILE_TYPE_GLYPH_KINDS: readonly FileTypeGlyphKind[] = [
  "ts",
  "tsx",
  "js",
  "json",
  "npm",
  "md",
  "css",
  "sh",
  "docker",
  "git",
  "env",
  "lock",
  "file",
];

export const FILE_TYPE_GLYPH_MAX_NAME_LENGTH = 255;

const EXACT_NAME_KINDS = new Map<string, FileTypeGlyphKind>([
  ["package.json", "npm"],
  ["package-lock.json", "lock"],
  ["yarn.lock", "lock"],
  ["pnpm-lock.yaml", "lock"],
  ["bun.lockb", "lock"],
  ["dockerfile", "docker"],
  [".dockerignore", "docker"],
  [".gitignore", "git"],
  [".gitattributes", "git"],
  [".gitmodules", "git"],
  [".env", "env"],
]);

interface NamePatternRule {
  readonly kind: FileTypeGlyphKind;
  readonly matches: (basename: string) => boolean;
}

const NAME_PATTERN_RULES: readonly NamePatternRule[] = [
  {
    kind: "docker",
    matches: (basename) =>
      basename.startsWith("docker-compose") &&
      (basename.endsWith(".yml") || basename.endsWith(".yaml")),
  },
  { kind: "env", matches: (basename) => basename.startsWith(".env.") },
];

const EXTENSION_KINDS = new Map<string, FileTypeGlyphKind>([
  ["ts", "ts"],
  ["mts", "ts"],
  ["cts", "ts"],
  ["tsx", "tsx"],
  ["js", "js"],
  ["mjs", "js"],
  ["cjs", "js"],
  ["jsx", "js"],
  ["json", "json"],
  ["jsonc", "json"],
  ["json5", "json"],
  ["md", "md"],
  ["mdx", "md"],
  ["css", "css"],
  ["scss", "css"],
  ["less", "css"],
  ["sh", "sh"],
  ["bash", "sh"],
  ["zsh", "sh"],
]);

export function fileTypeGlyphKind(name: string): FileTypeGlyphKind {
  const basename = boundedBasename(name);

  if (!basename) {
    return "file";
  }

  const exact = EXACT_NAME_KINDS.get(basename);

  if (exact) {
    return exact;
  }

  const patterned = NAME_PATTERN_RULES.find((rule) => rule.matches(basename));

  if (patterned) {
    return patterned.kind;
  }

  return EXTENSION_KINDS.get(extensionOf(basename)) ?? "file";
}

function boundedBasename(name: string): string {
  const lastSlash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const basename = lastSlash < 0 ? name : name.slice(lastSlash + 1);

  if (basename.length > FILE_TYPE_GLYPH_MAX_NAME_LENGTH) {
    return "";
  }

  return basename.toLowerCase();
}

function extensionOf(basename: string): string {
  const lastDot = basename.lastIndexOf(".");

  if (lastDot <= 0) {
    return "";
  }

  return basename.slice(lastDot + 1);
}
