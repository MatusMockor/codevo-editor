import type { LanguageServerWorkspaceSymbol } from "./languageServerFeatures";

export const MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES = 4 * 1024;
export const WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS = 1_200;
export const MAX_WORKSPACE_SYMBOL_RESULTS = 2_000;
export const MAX_WORKSPACE_SYMBOL_RESPONSE_UTF8_BYTES = 2 * 1024 * 1024;
export const MAX_WORKSPACE_SYMBOL_ITEM_UTF8_BYTES = 32 * 1024;
export const MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES = 1_024;
export const MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES = 2 * 1024;
export const MAX_WORKSPACE_SYMBOL_URI_UTF8_BYTES = 16 * 1024;

export function workspaceSymbolQueryFitsProjection(query: string): boolean {
  return utf8Fits(query, MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES);
}

export function workspaceSymbolsFitProjection(
  symbols: unknown,
): symbols is LanguageServerWorkspaceSymbol[] {
  if (!Array.isArray(symbols)) return false;
  if (symbols.length > MAX_WORKSPACE_SYMBOL_RESULTS) return false;

  let responseBytes = 2;
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    if (!workspaceSymbolFieldsFitProjection(symbol)) return false;
    const serialized = JSON.stringify(symbol);
    if (serialized == null) return false;
    const itemBytes = cappedUtf8Bytes(serialized, MAX_WORKSPACE_SYMBOL_ITEM_UTF8_BYTES);
    if (itemBytes === null) return false;
    responseBytes += itemBytes + (index === 0 ? 0 : 1);
    if (responseBytes > MAX_WORKSPACE_SYMBOL_RESPONSE_UTF8_BYTES) return false;
  }
  return true;
}

function workspaceSymbolFieldsFitProjection(
  value: unknown,
): value is LanguageServerWorkspaceSymbol {
  if (!value || typeof value !== "object") return false;
  const symbol = value as Partial<LanguageServerWorkspaceSymbol>;
  if (
    !("containerName" in symbol) ||
    typeof symbol.name !== "string" ||
    !utf8Fits(symbol.name, MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES) ||
    typeof symbol.kind !== "number" ||
    !Number.isInteger(symbol.kind) ||
    symbol.kind < 1 ||
    symbol.kind > 26 ||
    (symbol.containerName !== null && typeof symbol.containerName !== "string") ||
    (typeof symbol.containerName === "string" &&
      !utf8Fits(symbol.containerName, MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES))
  ) {
    return false;
  }
  if (!("location" in symbol)) return false;
  if (symbol.location == null) return true;
  if (
    typeof symbol.location !== "object" ||
    typeof symbol.location.uri !== "string" ||
    !symbol.location.range
  ) {
    return false;
  }
  return (
    utf8Fits(symbol.location.uri, MAX_WORKSPACE_SYMBOL_URI_UTF8_BYTES) &&
    validPosition(symbol.location.range.start) &&
    validPosition(symbol.location.range.end) &&
    comparePositions(symbol.location.range.start, symbol.location.range.end) <= 0
  );
}

function validPosition(position: { readonly character: number; readonly line: number }): boolean {
  return (
    Number.isInteger(position.line) &&
    position.line >= 0 &&
    position.line <= 0xffff_ffff &&
    Number.isInteger(position.character) &&
    position.character >= 0 &&
    position.character <= 0xffff_ffff
  );
}

function comparePositions(
  left: { readonly character: number; readonly line: number },
  right: { readonly character: number; readonly line: number },
): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function utf8Fits(value: string, maximumBytes: number): boolean {
  return cappedUtf8Bytes(value, maximumBytes) !== null;
}

function cappedUtf8Bytes(value: string, maximumBytes: number): number | null {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > maximumBytes) return null;
  }
  return bytes;
}
