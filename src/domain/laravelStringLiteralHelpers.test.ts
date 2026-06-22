import { describe, expect, it } from "vitest";
import {
  detectLaravelStringLiteralHelper,
  laravelHelperAtCall,
} from "./laravelStringLiteralHelpers";

describe("detectLaravelStringLiteralHelper", () => {
  it("detects config() literals", () => {
    const source = `<?php\n\nconfig('app.name');\n`;

    expect(detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name"))).toEqual({
      helper: "config",
      literal: "app.name",
      literalStart: source.indexOf("app.name"),
      literalEnd: source.indexOf("app.name") + "app.name".length,
    });
  });

  it("detects route() literals", () => {
    const source = `<?php\n\nroute('users.index');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "users.index")),
    ).toMatchObject({ helper: "route", literal: "users.index" });
  });

  it("detects view() literals", () => {
    const source = `<?php\n\nview('admin.dashboard');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "admin.dashboard")),
    ).toMatchObject({ helper: "view", literal: "admin.dashboard" });
  });

  it("maps __() to trans", () => {
    const source = `<?php\n\n__('messages.welcome');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "messages.welcome")),
    ).toMatchObject({ helper: "trans", literal: "messages.welcome" });
  });

  it("maps trans() to trans", () => {
    const source = `<?php\n\ntrans('messages.welcome');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "messages.welcome")),
    ).toMatchObject({ helper: "trans", literal: "messages.welcome" });
  });

  it("maps trans_choice() to trans", () => {
    const source = `<?php\n\ntrans_choice('messages.apples', 5);\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "messages.apples")),
    ).toMatchObject({ helper: "trans", literal: "messages.apples" });
  });

  it("detects env() literals", () => {
    const source = `<?php\n\nenv('APP_ENV');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "APP_ENV")),
    ).toMatchObject({ helper: "env", literal: "APP_ENV" });
  });

  it("supports double quotes", () => {
    const source = `<?php\n\nconfig("app.name");\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toMatchObject({ helper: "config", literal: "app.name" });
  });

  it("returns the literal range covering only the literal text", () => {
    const source = `<?php\n\nconfig('app.name');\n`;
    const result = detectLaravelStringLiteralHelper(
      source,
      offsetIn(source, "app.name"),
    );

    expect(result).not.toBeNull();
    expect(source.slice(result!.literalStart, result!.literalEnd)).toBe("app.name");
  });

  it("detects when the offset is at the very start of the literal text", () => {
    const source = `<?php\n\nconfig('app.name');\n`;
    const start = source.indexOf("app.name");

    expect(detectLaravelStringLiteralHelper(source, start)).toMatchObject({
      helper: "config",
      literal: "app.name",
    });
  });

  it("returns null when the offset is outside any literal", () => {
    const source = `<?php\n\nconfig('app.name');\n`;
    const outside = source.indexOf("config");

    expect(detectLaravelStringLiteralHelper(source, outside)).toBeNull();
  });

  it("returns null for a non-helper function call", () => {
    const source = `<?php\n\nsomething('app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("returns null for method calls like $x->config(...)", () => {
    const source = `<?php\n\n$x->config('app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("returns null for static calls like Config::get(...)", () => {
    const source = `<?php\n\nConfig::get('app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("allows a leading namespace separator (\\config())", () => {
    const source = `<?php\n\n\\config('app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toMatchObject({ helper: "config", literal: "app.name" });
  });

  it("ignores literals that are not the first argument", () => {
    const source = `<?php\n\nconfig('app.name', 'default');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "default")),
    ).toBeNull();
  });

  it("returns null for named first arguments", () => {
    const source = `<?php\n\nconfig(key: 'app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("returns null for a function declaration named like a helper", () => {
    const source = `<?php\n\nfunction config('app.name') {}\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("returns null for namespaced multi-segment names", () => {
    const namespaced = `<?php\n\nApp\\config('app.name');\n`;
    const qualified = `<?php\n\n\\App\\config('app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(namespaced, offsetIn(namespaced, "app.name")),
    ).toBeNull();
    expect(
      detectLaravelStringLiteralHelper(qualified, offsetIn(qualified, "app.name")),
    ).toBeNull();
  });

  it("returns null for names that merely end with a helper name", () => {
    const source = `<?php\n\nmyconfig('app.name');\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("returns null inside block and hash comments", () => {
    const block = `<?php\n\n/* config('app.name') */\n`;
    const hash = `<?php\n\n# config('app.name')\n`;

    expect(
      detectLaravelStringLiteralHelper(block, offsetIn(block, "app.name")),
    ).toBeNull();
    expect(
      detectLaravelStringLiteralHelper(hash, offsetIn(hash, "app.name")),
    ).toBeNull();
  });

  it("returns null at the opening quote and null past the closing quote", () => {
    const source = `<?php\n\nconfig('app.name');\n`;
    const openingQuote = source.indexOf("'");
    const closingQuote = source.indexOf("'", openingQuote + 1);

    expect(detectLaravelStringLiteralHelper(source, openingQuote)).toBeNull();
    expect(
      detectLaravelStringLiteralHelper(source, closingQuote + 1),
    ).toBeNull();
  });

  it("matches at the closing quote offset", () => {
    const source = `<?php\n\nconfig('app.name');\n`;
    const closingQuote = source.indexOf(
      "'",
      source.indexOf("app.name"),
    );

    expect(detectLaravelStringLiteralHelper(source, closingQuote)).toMatchObject(
      { helper: "config", literal: "app.name" },
    );
  });

  it("picks the inner helper for nested calls when the offset is in the inner literal", () => {
    const source = `<?php\n\nconfig(route('users.index'));\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "users.index")),
    ).toMatchObject({ helper: "route", literal: "users.index" });
  });

  it("returns null inside comments", () => {
    const source = `<?php\n\n// config('app.name')\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.name")),
    ).toBeNull();
  });

  it("returns null for interpolated double-quoted literals", () => {
    const source = `<?php\n\nconfig("app.$name");\n`;

    expect(
      detectLaravelStringLiteralHelper(source, offsetIn(source, "app.")),
    ).toBeNull();
  });

  it("returns null for the empty source", () => {
    expect(detectLaravelStringLiteralHelper("", 0)).toBeNull();
  });
});

describe("laravelHelperAtCall", () => {
  it("returns the normalized helper name for a global helper call", () => {
    const source = `<?php\n\nconfig('app.name');\n`;

    expect(laravelHelperAtCall(source, source.indexOf("("))).toBe("config");
  });

  it("normalizes __ to trans", () => {
    const source = `<?php\n\n__('messages.welcome');\n`;

    expect(laravelHelperAtCall(source, source.indexOf("("))).toBe("trans");
  });

  it("returns null for a method call", () => {
    const source = `<?php\n\n$x->config('app.name');\n`;

    expect(laravelHelperAtCall(source, source.indexOf("("))).toBeNull();
  });
});

function offsetIn(source: string, token: string): number {
  const index = source.indexOf(token);

  if (index < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  return index + 1;
}
