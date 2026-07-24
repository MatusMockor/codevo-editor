import { isWellFormedUnicode } from "./unicodeText";

export interface BoundedJsoncLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

/** Parses strict JSON values plus comments/trailing commas, rejecting duplicate keys. */
export function parseBoundedJsonc(source: string, limits: BoundedJsoncLimits): unknown {
  return new BoundedJsoncParser(source, limits).parse();
}

class BoundedJsoncParser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly source: string,
    private readonly limits: BoundedJsoncLimits,
  ) {}

  parse(): unknown {
    this.skipTrivia();
    const value = this.value(0);
    this.skipTrivia();
    if (this.index !== this.source.length) this.fail();
    return value;
  }

  private value(depth: number): unknown {
    if (depth > this.limits.maxDepth || ++this.nodes > this.limits.maxNodes) this.fail();
    this.skipTrivia();
    const character = this.source[this.index];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === '"') return this.string();
    if (character === "t") return this.literal("true", true);
    if (character === "f") return this.literal("false", false);
    if (character === "n") return this.literal("null", null);
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      return this.number();
    }
    return this.fail();
  }

  private object(depth: number): Record<string, unknown> {
    this.expect("{");
    this.skipTrivia();
    const value = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (this.consume("}")) return value;
    while (true) {
      this.skipTrivia();
      if (this.source[this.index] !== '"') this.fail();
      const key = this.string();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipTrivia();
      this.expect(":");
      value[key] = this.value(depth);
      this.skipTrivia();
      if (this.consume("}")) return value;
      this.expect(",");
      this.skipTrivia();
      if (this.consume("}")) return value;
    }
  }

  private array(depth: number): unknown[] {
    this.expect("[");
    this.skipTrivia();
    const value: unknown[] = [];
    if (this.consume("]")) return value;
    while (true) {
      value.push(this.value(depth));
      this.skipTrivia();
      if (this.consume("]")) return value;
      this.expect(",");
      this.skipTrivia();
      if (this.consume("]")) return value;
    }
  }

  private string(): string {
    const start = this.index;
    this.expect('"');
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        let value: unknown;
        try {
          value = JSON.parse(this.source.slice(start, this.index));
        } catch {
          return this.fail();
        }
        if (typeof value !== "string" || !isWellFormedUnicode(value)) this.fail();
        return value;
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

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.index),
    );
    if (!match) return this.fail();
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail();
    return value;
  }

  private literal<T>(text: string, value: T): T {
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
    throw new TypeError("Invalid bounded JSONC.");
  }
}
