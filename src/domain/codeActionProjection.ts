import type {
  LanguageServerCodeAction,
  LanguageServerCodeActionContext,
} from "./languageServerFeatures";

export const MAX_CODE_ACTION_RESULTS = 256;
export const MAX_CODE_ACTION_ITEM_UTF8_BYTES = 256 * 1024;
export const MAX_CODE_ACTION_RESPONSE_UTF8_BYTES = 2 * 1024 * 1024;
export const MAX_CODE_ACTION_CONTEXT_UTF8_BYTES = 512 * 1024;
export const MAX_CODE_ACTION_DIAGNOSTICS = 256;
export const MAX_CODE_ACTION_ONLY_KINDS = 32;
export const MAX_CODE_ACTION_JSON_DEPTH = 16;
export const MAX_CODE_ACTION_JSON_NODES = 4_096;
export const MAX_CODE_ACTION_JSON_CONTAINER_ITEMS = 256;
export const MAX_CODE_ACTION_JSON_UTF8_BYTES = 64 * 1024;
export const MAX_CODE_ACTION_COMMAND_ARGUMENTS = 64;
export const MAX_CODE_ACTION_TITLE_UTF8_BYTES = 4 * 1024;
export const MAX_CODE_ACTION_KIND_UTF8_BYTES = 1024;
export const MAX_CODE_ACTION_REASON_UTF8_BYTES = 8 * 1024;
export const MAX_CODE_ACTION_DIAGNOSTIC_MESSAGE_UTF8_BYTES = 16 * 1024;

export function codeActionRequestContextFitsProjection(
  context: LanguageServerCodeActionContext,
): boolean {
  if (
    context.diagnostics.length > MAX_CODE_ACTION_DIAGNOSTICS ||
    (context.only?.length ?? 0) > MAX_CODE_ACTION_ONLY_KINDS ||
    (context.triggerKind != null && context.triggerKind !== 1 && context.triggerKind !== 2)
  ) {
    return false;
  }
  for (const diagnostic of context.diagnostics) {
    if (
      !utf8Fits(diagnostic.message, MAX_CODE_ACTION_DIAGNOSTIC_MESSAGE_UTF8_BYTES) ||
      (diagnostic.source != null &&
        !utf8Fits(diagnostic.source, MAX_CODE_ACTION_KIND_UTF8_BYTES)) ||
      (typeof diagnostic.code === "string" &&
        !utf8Fits(diagnostic.code, MAX_CODE_ACTION_TITLE_UTF8_BYTES)) ||
      (typeof diagnostic.code === "number" &&
        (!Number.isInteger(diagnostic.code) ||
          diagnostic.code < -2_147_483_648 ||
          diagnostic.code > 2_147_483_647)) ||
      (diagnostic.severity != null &&
        diagnostic.severity !== 1 &&
        diagnostic.severity !== 2 &&
        diagnostic.severity !== 3 &&
        diagnostic.severity !== 4)
    ) {
      return false;
    }
  }
  if (context.only?.some((kind) => !utf8Fits(kind, MAX_CODE_ACTION_KIND_UTF8_BYTES))) {
    return false;
  }
  if (
    !opaqueJsonValuesFitProjection(
      context.diagnostics.flatMap((diagnostic) =>
        diagnostic.data == null ? [] : [diagnostic.data],
      ),
    )
  ) {
    return false;
  }
  return boundedSerializedJsonUtf8Bytes(context, MAX_CODE_ACTION_CONTEXT_UTF8_BYTES) !== null;
}

export function codeActionsFitProjection(actions: readonly LanguageServerCodeAction[]): boolean {
  if (actions.length > MAX_CODE_ACTION_RESULTS) {
    return false;
  }

  let responseBytes = 2;
  for (const action of actions) {
    if (!codeActionFieldsFitProjection(action)) {
      return false;
    }
    const itemBytes = boundedSerializedJsonUtf8Bytes(action, MAX_CODE_ACTION_ITEM_UTF8_BYTES);
    if (itemBytes === null) {
      return false;
    }
    responseBytes += itemBytes + 1;
    if (responseBytes > MAX_CODE_ACTION_RESPONSE_UTF8_BYTES) {
      return false;
    }
  }
  return true;
}

export function codeActionFitsProjection(action: LanguageServerCodeAction): boolean {
  return (
    codeActionFieldsFitProjection(action) &&
    boundedSerializedJsonUtf8Bytes(action, MAX_CODE_ACTION_ITEM_UTF8_BYTES) !== null
  );
}

function codeActionFieldsFitProjection(action: LanguageServerCodeAction): boolean {
  return (
    utf8Fits(action.title, MAX_CODE_ACTION_TITLE_UTF8_BYTES) &&
    (action.kind == null || utf8Fits(action.kind, MAX_CODE_ACTION_KIND_UTF8_BYTES)) &&
    (action.disabled == null ||
      utf8Fits(action.disabled.reason, MAX_CODE_ACTION_REASON_UTF8_BYTES)) &&
    (action.command == null ||
      (utf8Fits(action.command.title, MAX_CODE_ACTION_TITLE_UTF8_BYTES) &&
        utf8Fits(action.command.command, MAX_CODE_ACTION_TITLE_UTF8_BYTES) &&
        (action.command.arguments?.length ?? 0) <= MAX_CODE_ACTION_COMMAND_ARGUMENTS)) &&
    opaqueJsonValuesFitProjection([
      ...(action.command?.arguments ?? []),
      ...(action.data == null ? [] : [action.data]),
    ])
  );
}

function boundedSerializedJsonUtf8Bytes(value: unknown, maximumBytes: number): number | null {
  const stack: unknown[] = [value];
  let bytes = 0;

  while (stack.length > 0) {
    const candidate = stack.pop();
    if (candidate === null || typeof candidate === "boolean") {
      bytes += candidate === null ? 4 : candidate ? 4 : 5;
    } else if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) return null;
      bytes += String(candidate).length;
    } else if (typeof candidate === "string") {
      bytes += jsonStringUtf8BytesCapped(candidate, maximumBytes - bytes);
    } else if (Array.isArray(candidate)) {
      bytes += 2 + candidate.length;
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        stack.push(candidate[index]);
      }
    } else if (typeof candidate === "object") {
      const entries = Object.entries(candidate);
      bytes += 2 + entries.length;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, nested] = entries[index];
        bytes += jsonStringUtf8BytesCapped(key, maximumBytes - bytes) + 1;
        stack.push(nested);
      }
    } else {
      return null;
    }

    if (bytes > maximumBytes) {
      return null;
    }
  }
  return bytes;
}

function opaqueJsonValuesFitProjection(values: readonly unknown[]): boolean {
  const stack: Array<{ readonly depth: number; readonly value: unknown }> = [];
  let nodes = 0;
  let serializedBytes = 0;

  for (const value of values) {
    stack.push({ depth: 0, value });
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || current.depth > MAX_CODE_ACTION_JSON_DEPTH) return false;
      nodes += 1;
      if (nodes > MAX_CODE_ACTION_JSON_NODES) return false;
      const candidate = current.value;
      if (Array.isArray(candidate)) {
        if (candidate.length > MAX_CODE_ACTION_JSON_CONTAINER_ITEMS) return false;
        for (let index = candidate.length - 1; index >= 0; index -= 1) {
          stack.push({ depth: current.depth + 1, value: candidate[index] });
        }
      } else if (candidate !== null && typeof candidate === "object") {
        const entries = Object.entries(candidate);
        if (entries.length > MAX_CODE_ACTION_JSON_CONTAINER_ITEMS) return false;
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          stack.push({ depth: current.depth + 1, value: entries[index][1] });
        }
      } else if (
        typeof candidate !== "string" &&
        typeof candidate !== "number" &&
        typeof candidate !== "boolean" &&
        candidate !== null
      ) {
        return false;
      }
    }
    const bytes = boundedSerializedJsonUtf8Bytes(
      value,
      MAX_CODE_ACTION_JSON_UTF8_BYTES - serializedBytes - 1,
    );
    if (bytes === null) return false;
    serializedBytes += bytes + 1;
  }
  return true;
}

function jsonStringUtf8BytesCapped(value: string, maximumBytes: number): number {
  let bytes = 2;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || character === '"' || character === "\\") {
      bytes += codePoint <= 0x1f && !["\b", "\f", "\n", "\r", "\t"].includes(character) ? 6 : 2;
    } else {
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    if (bytes > maximumBytes) return maximumBytes + 1;
  }
  return bytes;
}

function utf8Fits(value: string, maximumBytes: number): boolean {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > maximumBytes) return false;
  }
  return true;
}
