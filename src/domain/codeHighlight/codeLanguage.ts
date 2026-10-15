export type CodeLanguageId =
  | "plaintext"
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "jsonc"
  | "html"
  | "css"
  | "scss"
  | "less"
  | "php"
  | "blade"
  | "latte"
  | "neon"
  | "vue"
  | "markdown"
  | "yaml"
  | "toml"
  | "xml"
  | "sql"
  | "shellscript"
  | "python"
  | "rust"
  | "go"
  | "dotenv"
  | "dockerfile"
  | "ini"
  | "diff";

export const CODE_LANGUAGE_IDS: readonly CodeLanguageId[] = [
  "plaintext",
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "json",
  "jsonc",
  "html",
  "css",
  "scss",
  "less",
  "php",
  "blade",
  "latte",
  "neon",
  "vue",
  "markdown",
  "yaml",
  "toml",
  "xml",
  "sql",
  "shellscript",
  "python",
  "rust",
  "go",
  "dotenv",
  "dockerfile",
  "ini",
  "diff",
];

const KNOWN_LANGUAGES: ReadonlySet<string> = new Set(CODE_LANGUAGE_IDS);

export function isCodeLanguageId(value: string): value is CodeLanguageId {
  return KNOWN_LANGUAGES.has(value);
}

const EXTENSION_LANGUAGES: ReadonlyMap<string, CodeLanguageId> = new Map<string, CodeLanguageId>([
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "jsx"],
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "tsx"],
  ["json", "json"],
  ["jsonc", "jsonc"],
  ["json5", "jsonc"],
  ["html", "html"],
  ["htm", "html"],
  ["xhtml", "html"],
  ["css", "css"],
  ["scss", "scss"],
  ["less", "less"],
  ["php", "php"],
  ["phtml", "php"],
  ["latte", "latte"],
  ["neon", "neon"],
  ["vue", "vue"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["markdown", "markdown"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["toml", "toml"],
  ["xml", "xml"],
  ["svg", "xml"],
  ["xsd", "xml"],
  ["xsl", "xml"],
  ["plist", "xml"],
  ["sql", "sql"],
  ["sh", "shellscript"],
  ["bash", "shellscript"],
  ["zsh", "shellscript"],
  ["py", "python"],
  ["pyi", "python"],
  ["rs", "rust"],
  ["go", "go"],
  ["env", "dotenv"],
  ["dockerfile", "dockerfile"],
  ["ini", "ini"],
  ["conf", "ini"],
  ["cfg", "ini"],
  ["editorconfig", "ini"],
  ["diff", "diff"],
  ["patch", "diff"],
]);

const FILENAME_LANGUAGES: ReadonlyMap<string, CodeLanguageId> = new Map<string, CodeLanguageId>([
  ["dockerfile", "dockerfile"],
  ["containerfile", "dockerfile"],
  ["makefile", "plaintext"],
  ["gnumakefile", "plaintext"],
  [".bashrc", "shellscript"],
  [".bash_profile", "shellscript"],
  [".zshrc", "shellscript"],
  [".profile", "shellscript"],
  [".gitconfig", "ini"],
  [".npmrc", "ini"],
  [".editorconfig", "ini"],
  [".babelrc", "jsonc"],
  [".eslintrc", "jsonc"],
  [".prettierrc", "json"],
  ["jsconfig.json", "jsonc"],
]);

const FENCE_ALIASES: ReadonlyMap<string, CodeLanguageId> = new Map<string, CodeLanguageId>([
  ["text", "plaintext"],
  ["txt", "plaintext"],
  ["plain", "plaintext"],
  ["plaintext", "plaintext"],
  ["javascript", "javascript"],
  ["node", "javascript"],
  ["typescript", "typescript"],
  ["html", "html"],
  ["blade", "blade"],
  ["markdown", "markdown"],
  ["shell", "shellscript"],
  ["shellscript", "shellscript"],
  ["console", "shellscript"],
  ["shellsession", "shellscript"],
  ["python", "python"],
  ["python3", "python"],
  ["rust", "rust"],
  ["golang", "go"],
  ["dotenv", "dotenv"],
  ["docker", "dockerfile"],
  ["dockerfile", "dockerfile"],
  ["properties", "ini"],
]);

export function codeLanguageForPath(path: string): CodeLanguageId {
  const name = baseName(path).toLowerCase();
  if (name.length === 0) return "plaintext";
  const byName = FILENAME_LANGUAGES.get(name);
  if (byName !== undefined) return byName;
  if (name === ".env" || name.startsWith(".env.")) return "dotenv";
  if (name.endsWith(".blade.php")) return "blade";
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "dockerfile";
  if (/^tsconfig(\..+)?\.json$/.test(name)) return "jsonc";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  return EXTENSION_LANGUAGES.get(name.slice(dot + 1)) ?? "plaintext";
}

export function codeLanguageForFence(info: string | null): CodeLanguageId | null {
  if (info === null) return null;
  const word = info.trim().split(/[\s{,]/, 1)[0] ?? "";
  const requested = word.replace(/^\./, "").toLowerCase();
  if (requested.length === 0) return null;
  return FENCE_ALIASES.get(requested) ?? EXTENSION_LANGUAGES.get(requested) ?? null;
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(slash + 1);
}
