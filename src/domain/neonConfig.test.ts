import { describe, expect, it } from "vitest";
import {
  detectNeonClassReferenceAt,
  detectNeonIncludeAt,
  neonClassReferences,
  neonServiceClassCompletionContextAt,
} from "./neonConfig";

/**
 * Returns the offset of the FIRST occurrence of `needle` in `source`, advanced
 * by `withinOffset` characters so a test can target a precise cursor position
 * inside a construct.
 */
function offsetOf(source: string, needle: string, withinOffset = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index + withinOffset;
}

function spanOf(source: string, needle: string) {
  const start = source.indexOf(needle);

  if (start < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return { start, end: start + needle.length };
}

describe("detectNeonClassReferenceAt", () => {
  it("detects an anonymous `- Class` FQN in services", () => {
    const source = "services:\n    - App\\Model\\ProductRepository\n";
    const offset = offsetOf(source, "App\\Model\\ProductRepository", 4);

    expect(detectNeonClassReferenceAt(source, offset)).toEqual({
      className: "App\\Model\\ProductRepository",
      span: spanOf(source, "App\\Model\\ProductRepository"),
    });
  });

  it("detects a named service class value", () => {
    const source = "services:\n    router: App\\Router\\RouterFactory\n";
    const offset = offsetOf(source, "App\\Router\\RouterFactory", 2);

    expect(detectNeonClassReferenceAt(source, offset)).toEqual({
      className: "App\\Router\\RouterFactory",
      span: spanOf(source, "App\\Router\\RouterFactory"),
    });
  });

  it("detects the class part of a `factory: Class::method` static value", () => {
    const source =
      "services:\n    routing: App\\Router\\RouterFactory::createRouter\n";
    const onClass = offsetOf(source, "App\\Router\\RouterFactory", 3);

    expect(detectNeonClassReferenceAt(source, onClass)).toEqual({
      className: "App\\Router\\RouterFactory",
      span: spanOf(source, "App\\Router\\RouterFactory"),
    });
  });

  it("does not detect the method name after `::`", () => {
    const source =
      "services:\n    routing: App\\Router\\RouterFactory::createRouter\n";
    const onMethod = offsetOf(source, "createRouter", 2);

    expect(detectNeonClassReferenceAt(source, onMethod)).toBeNull();
  });

  it("detects the class of an entity `Class(args)`", () => {
    const source =
      "services:\n    db: App\\Database\\Connection(%database.dsn%)\n";
    const offset = offsetOf(source, "App\\Database\\Connection", 4);

    expect(detectNeonClassReferenceAt(source, offset)).toEqual({
      className: "App\\Database\\Connection",
      span: spanOf(source, "App\\Database\\Connection"),
    });
  });

  it("detects a single-segment class after `factory:` (uppercase)", () => {
    const source = "services:\n    r: RouterFactory\n";
    const source2 = "services:\n    thing:\n        factory: RouterFactory\n";
    const offset = offsetOf(source2, "RouterFactory", 3);

    // sanity: unrelated named value single-segment IS offered too (named service class)
    expect(detectNeonClassReferenceAt(source2, offset)).toEqual({
      className: "RouterFactory",
      span: spanOf(source2, "RouterFactory"),
    });
    void source;
  });

  it("returns null for a `%param%` value", () => {
    const source = "services:\n    x: %appDir%\n";
    const offset = offsetOf(source, "appDir", 1);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for an `@service` reference value", () => {
    const source = "services:\n    x: @anotherService\n";
    const offset = offsetOf(source, "anotherService", 3);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for an `@Type` reference (service by type)", () => {
    const source = "services:\n    x: @App\\Model\\Repo\n";
    const offset = offsetOf(source, "App\\Model\\Repo", 2);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("returns null inside a comment", () => {
    const source = "services:\n    # see App\\Model\\Foo for details\n";
    const offset = offsetOf(source, "App\\Model\\Foo", 3);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for an FQN inside an inline comment", () => {
    const source = "services:\n    - App\\Real   # App\\Commented\n";
    const offset = offsetOf(source, "App\\Commented", 2);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("detects an FQN anywhere, e.g. in the parameters section", () => {
    const source = "parameters:\n    repo: App\\Model\\Repo\n";
    const offset = offsetOf(source, "App\\Model\\Repo", 5);

    expect(detectNeonClassReferenceAt(source, offset)?.className).toBe(
      "App\\Model\\Repo",
    );
  });

  it("does not detect a bare lowercase scalar in parameters as a class", () => {
    const source = "parameters:\n    default: mysql\n";
    const offset = offsetOf(source, "mysql", 2);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("does not treat a lowercase setup method call as a class", () => {
    const source =
      "services:\n    m:\n        setup:\n            - setDebug(%debug%)\n";
    const offset = offsetOf(source, "setDebug", 2);

    expect(detectNeonClassReferenceAt(source, offset)).toBeNull();
  });

  it("matches when the cursor sits just after the last class character", () => {
    const source = "services:\n    - App\\Model\\Foo\n";
    const end = source.indexOf("App\\Model\\Foo") + "App\\Model\\Foo".length;

    expect(detectNeonClassReferenceAt(source, end)?.className).toBe(
      "App\\Model\\Foo",
    );
  });

  it("returns null for out-of-range offsets", () => {
    const source = "services:\n    - App\\Foo\n";

    expect(detectNeonClassReferenceAt(source, -1)).toBeNull();
    expect(detectNeonClassReferenceAt(source, source.length + 10)).toBeNull();
  });
});

describe("neonClassReferences", () => {
  it("collects every class reference in a realistic services.neon", () => {
    const source = [
      "# application services",
      "services:",
      "    - App\\Model\\ProductRepository",
      "    router: App\\Router\\RouterFactory",
      "    routing: App\\Router\\RouterFactory::createRouter",
      "    db: App\\Database\\Connection(%database.dsn%)",
      "    mailer:",
      "        factory: App\\Mail\\MailerFactory",
      "        implement: App\\Mail\\IMailerAccessor",
      "        setup:",
      "            - setDebug(%debug%)",
      "        tags: [inbox, outbox]",
      "        arguments: [@connection, %timeout%]",
      "",
      "parameters:",
      "    repo: App\\Model\\Repo",
    ].join("\n");

    const names = neonClassReferences(source).map((r) => r.className);

    expect(names).toEqual([
      "App\\Model\\ProductRepository",
      "App\\Router\\RouterFactory",
      "App\\Router\\RouterFactory",
      "App\\Database\\Connection",
      "App\\Mail\\MailerFactory",
      "App\\Mail\\IMailerAccessor",
      "App\\Model\\Repo",
    ]);
  });

  it("returns an empty array for an empty document", () => {
    expect(neonClassReferences("")).toEqual([]);
  });

  it("returns an empty array for a comment-only document", () => {
    expect(neonClassReferences("# just a comment\n# another\n")).toEqual([]);
  });

  it("gives each reference a span that slices back to the class name", () => {
    const source = "services:\n    - App\\Model\\Foo\n";
    const [ref] = neonClassReferences(source);

    expect(source.slice(ref.span.start, ref.span.end)).toBe("App\\Model\\Foo");
  });
});

describe("detectNeonIncludeAt", () => {
  it("detects an unquoted include path", () => {
    const source = "includes:\n    - parameters.neon\n    - services.neon\n";
    const offset = offsetOf(source, "services.neon", 2);

    expect(detectNeonIncludeAt(source, offset)).toEqual({
      path: "services.neon",
      span: spanOf(source, "services.neon"),
    });
  });

  it("detects a quoted include path (span excludes quotes)", () => {
    const source = "includes:\n    - 'config/database.neon'\n";
    const offset = offsetOf(source, "config/database.neon", 2);

    expect(detectNeonIncludeAt(source, offset)).toEqual({
      path: "config/database.neon",
      span: spanOf(source, "config/database.neon"),
    });
  });

  it("detects a relative parent include path", () => {
    const source = "includes:\n    - ../common.neon\n";
    const offset = offsetOf(source, "../common.neon", 3);

    expect(detectNeonIncludeAt(source, offset)?.path).toBe("../common.neon");
  });

  it("returns null for a list item outside the includes section", () => {
    const source = "services:\n    - App\\Foo\n";
    const offset = offsetOf(source, "App\\Foo", 2);

    expect(detectNeonIncludeAt(source, offset)).toBeNull();
  });

  it("returns null when the cursor is off any include path", () => {
    const source = "includes:\n    - parameters.neon\n";

    expect(detectNeonIncludeAt(source, 0)).toBeNull();
  });
});

describe("neonServiceClassCompletionContextAt", () => {
  it("offers completion for a partial FQN after `factory:`", () => {
    const source = "services:\n    x:\n        factory: App\\Ma";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toEqual({
      prefix: "App\\Ma",
      span: spanOf(source, "App\\Ma"),
    });
  });

  it("offers completion after a `- ` anonymous service marker", () => {
    const source = "services:\n    - App\\";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toEqual({
      prefix: "App\\",
      span: spanOf(source, "App\\"),
    });
  });

  it("offers an empty-prefix completion right after a named service colon", () => {
    const source = "services:\n    router: ";
    const offset = source.length;
    const result = neonServiceClassCompletionContextAt(source, offset);

    expect(result?.prefix).toBe("");
    expect(result?.span).toEqual({ start: offset, end: offset });
  });

  it("keeps the full identifier in the replace span when the cursor is mid-token", () => {
    const source = "services:\n    router: App\\Router\n";
    const offset = offsetOf(source, "App\\Router", 4);
    const result = neonServiceClassCompletionContextAt(source, offset);

    expect(result?.prefix).toBe("App\\");
    expect(result?.span).toEqual(spanOf(source, "App\\Router"));
  });

  it("does not offer completion in the parameters section", () => {
    const source = "parameters:\n    repo: App\\";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion while typing the key name", () => {
    const source = "services:\n    fact";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion after an `@` reference", () => {
    const source = "services:\n    x:\n        arguments: @conn";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion for a known non-class key like tags", () => {
    const source = "services:\n    x:\n        tags: adm";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion inside a comment", () => {
    const source = "services:\n    router: App # note App\\Foo";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion inside a multi-line setup: block list item", () => {
    const source = "services:\n    foo:\n        setup:\n            - setD";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion inside a multi-line arguments: block list item", () => {
    const source =
      "services:\n    foo:\n        arguments:\n            - App\\Fo";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("does not offer completion inside a multi-line tags: block list item", () => {
    const source = "services:\n    foo:\n        tags:\n            - adm";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toBeNull();
  });

  it("still offers completion for a class-value key sibling after a multi-line setup: block ends", () => {
    const source =
      "services:\n    foo:\n        setup:\n            - setDebug(1)\n        class: App\\Fo";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toEqual({
      prefix: "App\\Fo",
      span: spanOf(source, "App\\Fo"),
    });
  });

  it("still offers completion for a top-level anonymous services: list item", () => {
    const source = "services:\n    - App\\Fo";
    const offset = source.length;

    expect(neonServiceClassCompletionContextAt(source, offset)).toEqual({
      prefix: "App\\Fo",
      span: spanOf(source, "App\\Fo"),
    });
  });
});

describe("hang-safety and edge cases", () => {
  it("tolerates tab-indented services without throwing", () => {
    const source = "services:\n\t- App\\Model\\Foo\n";
    const offset = offsetOf(source, "App\\Model\\Foo", 2);

    expect(detectNeonClassReferenceAt(source, offset)?.className).toBe(
      "App\\Model\\Foo",
    );
  });

  it("tolerates malformed dangling colons", () => {
    const source = "services:\n    broken:\n    :\n    - App\\Ok\n";

    expect(() => neonClassReferences(source)).not.toThrow();
    expect(neonClassReferences(source).map((r) => r.className)).toContain(
      "App\\Ok",
    );
  });

  it("handles a very large document quickly and linearly", () => {
    const block =
      "services:\n    - App\\Model\\Repo\n    router: App\\Router\\Factory\n";
    const source = block.repeat(20000);

    const start = Date.now();
    const refs = neonClassReferences(source);
    const durationMs = Date.now() - start;

    expect(refs.length).toBe(40000);
    expect(durationMs).toBeLessThan(2000);
  });

  it("tolerates an unterminated string value without hanging", () => {
    const source = "services:\n    x: 'unterminated App\\Foo\n    - App\\Bar\n";

    expect(() => neonClassReferences(source)).not.toThrow();
  });
});
