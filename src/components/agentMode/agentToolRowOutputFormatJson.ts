export const MAX_PRETTY_JSON_DEPTH = 64;
export const MAX_PRETTY_JSON_CHARS = 1_048_576;

const INDENT = "  ";
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;
const ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y;

type Expect = "value" | "valueOrClose" | "keyOrClose" | "key" | "colon" | "commaOrClose" | "end";
type Container = "object" | "array";

class JsonReindenter {
  private readonly parts: string[] = [];
  private readonly stack: Container[] = [];
  private length = 0;
  private expect: Expect = "value";
  private pendingOpen = false;

  constructor(private readonly text: string) {}

  run(): string | null {
    let index = 0;
    while (index < this.text.length) {
      const char = this.text[index];
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        index += 1;
        continue;
      }
      const next = this.step(char, index);
      if (next === null) return null;
      index = next;
    }
    if (this.expect !== "end") return null;
    return this.parts.join("");
  }

  private step(char: string, index: number): number | null {
    switch (char) {
      case "{":
      case "[":
        return this.open(char === "{" ? "object" : "array", char) ? index + 1 : null;
      case "}":
      case "]":
        return this.close(char === "}" ? "object" : "array", char) ? index + 1 : null;
      case ",":
        return this.comma() ? index + 1 : null;
      case ":":
        if (this.expect !== "colon") return null;
        this.expect = "value";
        return this.emit(": ") ? index + 1 : null;
      case '"':
        return this.string(index);
      default:
        return this.scalar(index);
    }
  }

  private open(container: Container, token: string): boolean {
    if (!this.acceptsValue()) return false;
    if (this.stack.length >= MAX_PRETTY_JSON_DEPTH) return false;
    if (!this.beforeToken() || !this.emit(token)) return false;
    this.stack.push(container);
    this.pendingOpen = true;
    this.expect = container === "object" ? "keyOrClose" : "valueOrClose";
    return true;
  }

  private close(container: Container, token: string): boolean {
    if (this.stack[this.stack.length - 1] !== container) return false;
    const empty = container === "object" ? "keyOrClose" : "valueOrClose";
    if (this.expect !== empty && this.expect !== "commaOrClose") return false;
    this.stack.pop();
    const separator = this.pendingOpen ? "" : `\n${INDENT.repeat(this.stack.length)}`;
    this.pendingOpen = false;
    this.expect = this.afterValue();
    return this.emit(`${separator}${token}`);
  }

  private comma(): boolean {
    if (this.expect !== "commaOrClose") return false;
    this.expect = this.stack[this.stack.length - 1] === "object" ? "key" : "value";
    return this.emit(`,\n${INDENT.repeat(this.stack.length)}`);
  }

  private string(start: number): number | null {
    const end = stringEnd(this.text, start);
    if (end === null) return null;
    const isKey = this.expect === "key" || this.expect === "keyOrClose";
    if (!isKey && !this.acceptsValue()) return null;
    if (!this.beforeToken() || !this.emit(this.text.slice(start, end))) return null;
    this.expect = isKey ? "colon" : this.afterValue();
    return end;
  }

  private scalar(start: number): number | null {
    if (!this.acceptsValue()) return null;
    const end = matchEnd(NUMBER, this.text, start) ?? matchEnd(LITERAL, this.text, start);
    if (end === null) return null;
    if (!this.beforeToken() || !this.emit(this.text.slice(start, end))) return null;
    this.expect = this.afterValue();
    return end;
  }

  private acceptsValue(): boolean {
    return this.expect === "value" || this.expect === "valueOrClose";
  }

  private afterValue(): Expect {
    return this.stack.length === 0 ? "end" : "commaOrClose";
  }

  private beforeToken(): boolean {
    if (!this.pendingOpen) return true;
    this.pendingOpen = false;
    return this.emit(`\n${INDENT.repeat(this.stack.length)}`);
  }

  private emit(part: string): boolean {
    this.length += part.length;
    if (this.length > MAX_PRETTY_JSON_CHARS) return false;
    this.parts.push(part);
    return true;
  }
}

export function reindentJson(text: string): string | null {
  return new JsonReindenter(text).run();
}

function stringEnd(text: string, start: number): number | null {
  let index = start + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x22) return index + 1;
    if (code < 0x20) return null;
    if (code !== 0x5c) {
      index += 1;
      continue;
    }
    const end = matchEnd(ESCAPE, text, index);
    if (end === null) return null;
    index = end;
  }
  return null;
}

function matchEnd(pattern: RegExp, text: string, start: number): number | null {
  pattern.lastIndex = start;
  if (!pattern.test(text)) return null;
  return pattern.lastIndex;
}
