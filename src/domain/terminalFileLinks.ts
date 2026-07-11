export interface TerminalFileLink {
  column?: number;
  length: number;
  line?: number;
  path: string;
  startIndex: number;
}

const sourceExtensions = [
  "bash",
  "c",
  "cjs",
  "cpp",
  "cs",
  "css",
  "fish",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
].join("|");
const pathPattern = String.raw`(?:\.{0,2}/|/)?(?:[A-Za-z0-9_@+~.-]+/)+[A-Za-z0-9_@+~.-]+\.(?:${sourceExtensions})`;
const fileLinkPattern = new RegExp(
  String.raw`(?<![A-Za-z0-9_@+~./-])(?<path>${pathPattern})(?:(?::(?<colonLine>\d+)(?::(?<column>\d+))?)|(?:\s+(?:on\s+)?line\s+(?<namedLine>\d+)))?`,
  "gi",
);
const urlPattern = /https?:\/\/\S+/gi;

export function terminalFileLinks(text: string): TerminalFileLink[] {
  const urlRanges = [...text.matchAll(urlPattern)].map((match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
  }));
  const links: TerminalFileLink[] = [];

  for (const match of text.matchAll(fileLinkPattern)) {
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + match[0].length;

    if (
      urlRanges.some(
        (range) => startIndex < range.end && endIndex > range.start,
      )
    ) {
      continue;
    }

    const path = match.groups?.path;

    if (!path) {
      continue;
    }

    const lineText = match.groups?.colonLine ?? match.groups?.namedLine;
    const columnText = match.groups?.column;

    links.push({
      column: columnText ? Number(columnText) : undefined,
      length: match[0].length,
      line: lineText ? Number(lineText) : undefined,
      path,
      startIndex,
    });
  }

  return links;
}
