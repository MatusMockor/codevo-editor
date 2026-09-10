export interface AgentMarkdownTokenShape {
  readonly type: string;
  readonly raw: string;
}

const BLANK_TOKEN_TYPE = "space";
const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const PARTIAL_DELIMITER_ROW = /^\s*\|?[\s:|-]*$/;
const MIN_STABILIZED_COLUMNS = 2;
const MAX_STABILIZED_COLUMNS = 64;

export function committableBlockCount(tokens: ReadonlyArray<AgentMarkdownTokenShape>): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.type === BLANK_TOKEN_TYPE) continue;
    return index;
  }
  return 0;
}

export function stabilizeStreamingMarkdownTail(tail: string): string {
  const trailing = tail.length - tail.trimEnd().length;
  const body = tail.slice(0, tail.length - trailing);
  if (body === "") return tail;
  const lines = body.split("\n");
  const pipeStart = trailingPipeRunStart(lines);
  if (pipeStart === lines.length) return tail;

  const header = lines[pipeStart];
  if (header === undefined) return tail;
  const columns = headerColumnCount(header);
  if (columns < MIN_STABILIZED_COLUMNS) return tail;
  const second = lines[pipeStart + 1];
  if (second !== undefined && isCompleteDelimiter(second, columns)) return tail;

  const delimiter = `|${" --- |".repeat(columns)}`;
  const rest = lines.slice(pipeStart + 1);
  const rows = second !== undefined && PARTIAL_DELIMITER_ROW.test(second) ? rest.slice(1) : rest;
  const prose = lines.slice(0, pipeStart);
  return [...prose, header, delimiter, ...rows].join("\n") + tail.slice(body.length);
}

function trailingPipeRunStart(lines: ReadonlyArray<string>): number {
  let start = lines.length;
  while (start > 0) {
    const line = lines[start - 1];
    if (line === undefined || !line.trimStart().startsWith("|")) break;
    start -= 1;
  }
  return start;
}

function isCompleteDelimiter(line: string, columns: number): boolean {
  if (!TABLE_DELIMITER_ROW.test(line)) return false;
  return headerColumnCount(line) === columns;
}

function headerColumnCount(header: string): number {
  const trimmed = header.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  if (inner.trim() === "") return 0;
  const cells = inner.split("|").length;
  return Math.min(cells, MAX_STABILIZED_COLUMNS);
}
