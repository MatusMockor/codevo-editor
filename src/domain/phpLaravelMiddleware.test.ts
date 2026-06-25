import { describe, expect, it } from "vitest";
import {
  isUsableLaravelMiddlewareAlias,
  phpLaravelMiddlewareAliasCompletionInsertText,
  phpLaravelMiddlewareAliasDefinitions,
  phpLaravelMiddlewareAliasReferenceContextAt,
} from "./phpLaravelMiddleware";

function positionOf(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

describe("phpLaravelMiddleware", () => {
  it("detects a Route::middleware string alias reference", () => {
    const source = `<?php\n\nRoute::middleware('verified')->group(fn () => null);\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "verified"),
      ),
    ).toMatchObject({
      alias: "verified",
    });
  });

  it("detects a fluent ->middleware string alias reference", () => {
    const source = `<?php\n\nRoute::get('/admin')->middleware('verified');\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "verified"),
      ),
    ).toMatchObject({
      alias: "verified",
      aliasParameterStarted: false,
    });
  });

  it("marks the parameter portion of an alias reference after the colon", () => {
    const source = `<?php\n\nRoute::middleware('auth:web')->group(fn () => null);\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "auth:we"),
      ),
    ).toMatchObject({
      alias: "auth",
      aliasParameterStarted: true,
    });

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "'aut"),
      ),
    ).toMatchObject({
      alias: "auth",
      aliasParameterStarted: false,
    });
  });

  it("detects a controller $this->middleware string alias reference", () => {
    const source = `<?php\n\nclass Controller {\n    public function __construct() {\n        $this->middleware('verified');\n    }\n}\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "verified"),
      ),
    ).toMatchObject({
      alias: "verified",
    });
  });

  it("detects the array element alias under the cursor", () => {
    const source = `<?php\n\nRoute::get('/admin')->middleware(['auth', 'verified']);\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "verified"),
      ),
    ).toMatchObject({
      alias: "verified",
    });

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "'auth"),
      ),
    ).toMatchObject({
      alias: "auth",
    });
  });

  it("extracts the alias before parameters", () => {
    const throttleSource = `<?php\n\nRoute::middleware('throttle:60,1');\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        throttleSource,
        positionAfter(throttleSource, "throttle"),
      ),
    ).toMatchObject({
      alias: "throttle",
    });

    const canSource = `<?php\n\nRoute::middleware('can:update,post');\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        canSource,
        positionAfter(canSource, "can"),
      ),
    ).toMatchObject({
      alias: "can",
    });
  });

  it("ignores dynamic or non-literal middleware arguments", () => {
    const variableSource = `<?php\n\nRoute::middleware($mw);\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        variableSource,
        positionAfter(variableSource, "$mw"),
      ),
    ).toBeNull();

    const interpolatedSource = `<?php\n\nRoute::middleware("throttle:$rate");\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        interpolatedSource,
        positionAfter(interpolatedSource, "throttle"),
      ),
    ).toBeNull();
  });

  it("ignores unrelated method calls", () => {
    const source = `<?php\n\n$builder->where('verified');\n`;

    expect(
      phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        positionAfter(source, "verified"),
      ),
    ).toBeNull();
  });

  it("collects $middlewareAliases registrations in a Kernel", () => {
    const source = `<?php

namespace App\\Http;

use Illuminate\\Foundation\\Http\\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middlewareAliases = [
        'auth' => \\App\\Http\\Middleware\\Authenticate::class,
        'verified' => EnsureEmailIsVerified::class,
        'throttle' => ThrottleRequests::class,
    ];
}
`;

    expect(phpLaravelMiddlewareAliasDefinitions(source)).toEqual([
      {
        name: "auth",
        position: positionOf(source, "auth'"),
      },
      {
        name: "verified",
        position: positionOf(source, "verified'"),
      },
      {
        name: "throttle",
        position: positionOf(source, "throttle'"),
      },
    ]);
  });

  it("collects legacy $routeMiddleware registrations in a Kernel", () => {
    const source = `<?php

namespace App\\Http;

class Kernel extends HttpKernel
{
    protected $routeMiddleware = [
        'auth' => Authenticate::class,
        'can' => Authorize::class,
    ];
}
`;

    expect(phpLaravelMiddlewareAliasDefinitions(source)).toEqual([
      {
        name: "auth",
        position: positionOf(source, "auth'"),
      },
      {
        name: "can",
        position: positionOf(source, "can'"),
      },
    ]);
  });

  it("ignores dynamic middleware alias keys in the Kernel", () => {
    const source = `<?php

class Kernel
{
    protected $middlewareAliases = [
        $alias => Authenticate::class,
        "auth-{$suffix}" => Other::class,
    ];
}
`;

    expect(phpLaravelMiddlewareAliasDefinitions(source)).toEqual([]);
  });

  it("builds the completion insert text from the alias name", () => {
    expect(phpLaravelMiddlewareAliasCompletionInsertText("verified")).toBe(
      "verified",
    );
    expect(phpLaravelMiddlewareAliasCompletionInsertText("auth.basic")).toBe(
      "auth.basic",
    );
  });

  it("validates usable middleware alias names", () => {
    expect(isUsableLaravelMiddlewareAlias("verified")).toBe(true);
    expect(isUsableLaravelMiddlewareAlias("auth.basic")).toBe(true);
    expect(isUsableLaravelMiddlewareAlias("")).toBe(false);
    expect(isUsableLaravelMiddlewareAlias("throttle:60")).toBe(false);
    expect(isUsableLaravelMiddlewareAlias("with space")).toBe(false);
  });
});
