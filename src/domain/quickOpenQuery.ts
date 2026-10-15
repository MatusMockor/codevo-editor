export type QuickOpenQuery =
  | {
      readonly kind: "files";
      readonly query: string;
    }
  | {
      readonly kind: "fileLocation";
      readonly column: number | null;
      readonly line: number;
      readonly pathQuery: string;
    };

export interface QuickOpenLocation {
  readonly column: number | null;
  readonly line: number;
}

const MAX_LOCATION_VALUE = 2_147_483_647;

export function parseQuickOpenQuery(input: string): QuickOpenQuery {
  const location = parseLocation(input);
  if (!location || location.pathQuery === "") {
    return { kind: "files", query: input };
  }

  return {
    kind: "fileLocation",
    column: location.column,
    line: location.line,
    pathQuery: location.pathQuery,
  };
}

function parseLocation(input: string): {
  readonly column: number | null;
  readonly line: number;
  readonly pathQuery: string;
} | null {
  const lineAndColumnMatch = /^(.*):([1-9]\d*):([1-9]\d*)$/.exec(input);
  const match = lineAndColumnMatch ?? /^(.*):([1-9]\d*):?$/.exec(input);
  if (!match) {
    return null;
  }

  const pathQuery = match[1] ?? "";
  if (/^[A-Za-z]$/.test(pathQuery)) {
    return null;
  }

  const line = parseLocationValue(match[2]);
  const column = lineAndColumnMatch ? parseLocationValue(lineAndColumnMatch[3]) : null;
  if (line === null) {
    return null;
  }
  if (lineAndColumnMatch && column === null) {
    return null;
  }

  return { column, line, pathQuery };
}

function parseLocationValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_LOCATION_VALUE) {
    return null;
  }

  return parsed;
}
