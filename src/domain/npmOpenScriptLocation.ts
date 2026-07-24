import { isNodePackageScriptName, type NodePackageScript } from "./nodePackageScripts";
import { lineColumnAt } from "./sourceLineOffsets";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES = 1024 * 1024;
export const MAX_NPM_OPEN_SCRIPT_MANIFEST_LINES = 20_000;
export const MAX_NPM_OPEN_SCRIPT_JSON_DEPTH = 128;
export const MAX_NPM_OPEN_SCRIPT_JSON_NODES = 20_000;
const MAX_MANIFEST_RELATIVE_PATH_BYTES = 4_096;

export interface NpmOpenScriptLocationInput {
  readonly manifestContent: string;
  readonly manifestRelativePath: string;
  readonly scriptName: string;
}

export interface NpmRunSelectedScriptAtInput {
  readonly anchorOffset: number;
  readonly manifestContent: string;
  readonly manifestRelativePath: string;
}

export interface NpmOpenScriptKeyLocation {
  readonly end: Readonly<{ readonly column: number; readonly lineNumber: number }>;
  readonly endOffset: number;
  readonly manifestRelativePath: string;
  readonly scriptName: string;
  readonly start: Readonly<{ readonly column: number; readonly lineNumber: number }>;
  readonly startOffset: number;
}

export interface NpmRunSelectedScriptIdentity {
  readonly manifestRelativePath: string;
  readonly scriptName: string;
}

interface JsonStringToken {
  readonly end: number;
  readonly start: number;
  readonly value: string;
}

interface JsonProperty {
  readonly key: JsonStringToken;
  readonly value: JsonValue;
}

type JsonValue =
  | { readonly kind: "array" }
  | { readonly kind: "boolean" }
  | { readonly kind: "null" }
  | { readonly kind: "number" }
  | { readonly kind: "object"; readonly properties: readonly JsonProperty[] }
  | { readonly kind: "string"; readonly token: JsonStringToken };

/** Resolves the quoted key token for an exact top-level package.json scripts entry. */
export function npmOpenScriptLocation(
  input: NpmOpenScriptLocationInput,
): NpmOpenScriptKeyLocation | null {
  if (!validInput(input)) return null;
  const lineStarts = jsonLineStartOffsets(input.manifestContent);
  if (lineStarts.length > MAX_NPM_OPEN_SCRIPT_MANIFEST_LINES) return null;

  let root: JsonValue;
  try {
    root = new JsoncLocationParser(input.manifestContent).parse();
  } catch {
    return null;
  }
  if (root.kind !== "object") return null;
  const scripts = root.properties.find(({ key }) => key.value === "scripts")?.value;
  if (!scripts || scripts.kind !== "object") return null;
  const property = scripts.properties.find(({ key }) => key.value === input.scriptName);
  if (!property || property.value.kind !== "string") return null;

  return Object.freeze({
    end: Object.freeze(lineColumnAt(lineStarts, property.key.end)),
    endOffset: property.key.end,
    manifestRelativePath: input.manifestRelativePath,
    scriptName: input.scriptName,
    start: Object.freeze(lineColumnAt(lineStarts, property.key.start)),
    startOffset: property.key.start,
  });
}

/** Resolves the script containing the current selection anchor in a local package.json. */
export function npmRunSelectedScriptAt(
  input: NpmRunSelectedScriptAtInput,
): NpmRunSelectedScriptIdentity | null {
  if (
    !validManifest(input.manifestContent, input.manifestRelativePath) ||
    !Number.isSafeInteger(input.anchorOffset) ||
    input.anchorOffset < 0 ||
    input.anchorOffset > input.manifestContent.length
  ) {
    return null;
  }
  const lineStarts = jsonLineStartOffsets(input.manifestContent);
  if (lineStarts.length > MAX_NPM_OPEN_SCRIPT_MANIFEST_LINES) return null;
  let root: JsonValue;
  try {
    root = new JsoncLocationParser(input.manifestContent).parse();
  } catch {
    return null;
  }
  if (root.kind !== "object") return null;
  const scripts = root.properties.find(({ key }) => key.value === "scripts")?.value;
  if (!scripts || scripts.kind !== "object") return null;
  const property = scripts.properties.find(
    ({ key, value }) =>
      value.kind === "string" &&
      input.anchorOffset >= key.start &&
      input.anchorOffset <= value.token.end,
  );
  if (!property || !isNodePackageScriptName(property.key.value)) return null;
  return Object.freeze({
    manifestRelativePath: input.manifestRelativePath,
    scriptName: property.key.value,
  });
}

/** Convenience adapter for an already validated package-tree script node. */
export function nodePackageScriptLocation(
  manifestContent: string,
  script: Pick<NodePackageScript, "manifestRelativePath" | "scriptName">,
): NpmOpenScriptKeyLocation | null {
  return npmOpenScriptLocation({
    manifestContent,
    manifestRelativePath: script.manifestRelativePath,
    scriptName: script.scriptName,
  });
}

function validInput(input: NpmOpenScriptLocationInput): boolean {
  return (
    validManifest(input.manifestContent, input.manifestRelativePath) &&
    isWellFormedUnicode(input.scriptName) &&
    isNodePackageScriptName(input.scriptName)
  );
}

function validManifest(content: string, manifestRelativePath: string): boolean {
  return (
    isWellFormedUnicode(content) &&
    new TextEncoder().encode(content).byteLength <= MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES &&
    validManifestRelativePath(manifestRelativePath)
  );
}

function validManifestRelativePath(path: string): boolean {
  if (
    !isWellFormedUnicode(path) ||
    path.length === 0 ||
    new TextEncoder().encode(path).byteLength > MAX_MANIFEST_RELATIVE_PATH_BYTES ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    return false;
  }
  const parts = path.split("/");
  return (
    parts[parts.length - 1] === "package.json" &&
    parts.every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function jsonLineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      if (source[index + 1] === "\n") index += 1;
      starts.push(index + 1);
    } else if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

class JsoncLocationParser {
  private index = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    this.skipTrivia();
    const value = this.value(0);
    this.skipTrivia();
    if (this.index !== this.source.length) this.fail();
    return value;
  }

  private value(depth: number): JsonValue {
    if (depth > MAX_NPM_OPEN_SCRIPT_JSON_DEPTH) this.fail();
    this.nodes += 1;
    if (this.nodes > MAX_NPM_OPEN_SCRIPT_JSON_NODES) this.fail();
    this.skipTrivia();
    const character = this.source[this.index];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === '"') return { kind: "string", token: this.string() };
    if (character === "t") return this.literal("true", { kind: "boolean" });
    if (character === "f") return this.literal("false", { kind: "boolean" });
    if (character === "n") return this.literal("null", { kind: "null" });
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      return this.number();
    }
    return this.fail();
  }

  private object(depth: number): JsonValue {
    this.expect("{");
    this.skipTrivia();
    const properties: JsonProperty[] = [];
    const keys = new Set<string>();
    if (this.consume("}")) return { kind: "object", properties };

    while (true) {
      this.skipTrivia();
      if (this.source[this.index] !== '"') this.fail();
      const key = this.string();
      if (keys.has(key.value)) this.fail();
      keys.add(key.value);
      this.skipTrivia();
      this.expect(":");
      const value = this.value(depth);
      properties.push({ key, value });
      this.skipTrivia();
      if (this.consume("}")) break;
      this.expect(",");
      this.skipTrivia();
      if (this.consume("}")) break;
    }
    return { kind: "object", properties };
  }

  private array(depth: number): JsonValue {
    this.expect("[");
    this.skipTrivia();
    if (this.consume("]")) return { kind: "array" };
    while (true) {
      this.value(depth);
      this.skipTrivia();
      if (this.consume("]")) break;
      this.expect(",");
      this.skipTrivia();
      if (this.consume("]")) break;
    }
    return { kind: "array" };
  }

  private string(): JsonStringToken {
    const start = this.index;
    this.expect('"');
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        const raw = this.source.slice(start, this.index);
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          return this.fail();
        }
        if (typeof value !== "string" || !isWellFormedUnicode(value)) this.fail();
        return { end: this.index, start, value };
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === "u") {
          if (!/^[0-9A-Fa-f]{4}$/u.test(this.source.slice(this.index + 1, this.index + 5))) {
            this.fail();
          }
          this.index += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) this.fail();
        this.index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) this.fail();
      this.index += 1;
    }
    return this.fail();
  }

  private number(): JsonValue {
    const rest = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rest);
    if (!match) return this.fail();
    this.index += match[0].length;
    return { kind: "number" };
  }

  private literal<T extends JsonValue>(text: string, value: T): T {
    if (!this.source.startsWith(text, this.index)) return this.fail();
    this.index += text.length;
    return value;
  }

  private skipTrivia(): void {
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (
        character === " " ||
        character === "\t" ||
        character === "\r" ||
        character === "\n" ||
        (character === "\ufeff" && this.index === 0)
      ) {
        this.index += 1;
        continue;
      }
      if (character !== "/") return;
      if (this.source[this.index + 1] === "/") {
        this.index += 2;
        while (
          this.index < this.source.length &&
          this.source[this.index] !== "\n" &&
          this.source[this.index] !== "\r"
        ) {
          this.index += 1;
        }
        continue;
      }
      if (this.source[this.index + 1] === "*") {
        const close = this.source.indexOf("*/", this.index + 2);
        if (close < 0) this.fail();
        this.index = close + 2;
        continue;
      }
      return;
    }
  }

  private consume(character: string): boolean {
    if (this.source[this.index] !== character) return false;
    this.index += 1;
    return true;
  }

  private expect(character: string): void {
    if (!this.consume(character)) this.fail();
  }

  private fail(): never {
    throw new TypeError("Invalid bounded JSONC manifest.");
  }
}
