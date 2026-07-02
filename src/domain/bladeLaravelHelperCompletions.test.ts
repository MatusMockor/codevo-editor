import { describe, expect, it } from "vitest";
import {
  bladeLaravelHelperCompletionContextAt,
  bladeLaravelStringLiteralHelperAt,
} from "./bladeLaravelHelperCompletions";

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

describe("bladeLaravelHelperCompletionContextAt", () => {
  it("detects route() inside a Blade echo", () => {
    const source = `<div>\n    {{ route('users.ind') }}\n</div>\n`;

    expect(
      bladeLaravelHelperCompletionContextAt(source, positionAfter(source, "users.ind")),
    ).toMatchObject({ kind: "route", prefix: "users.ind" });
  });

  it("detects config() inside an @if directive", () => {
    const source = `@if(config('app.deb'))\n    on\n@endif\n`;

    expect(
      bladeLaravelHelperCompletionContextAt(source, positionAfter(source, "app.deb")),
    ).toMatchObject({ kind: "config", prefix: "app.deb" });
  });

  it("detects __() inside a Blade echo", () => {
    const source = `{{ __('messages.wel') }}`;

    expect(
      bladeLaravelHelperCompletionContextAt(
        source,
        positionAfter(source, "messages.wel"),
      ),
    ).toMatchObject({ kind: "trans", prefix: "messages.wel" });
  });

  it("detects trans() inside a Blade echo", () => {
    const source = `{{ trans('messages.wel') }}`;

    expect(
      bladeLaravelHelperCompletionContextAt(
        source,
        positionAfter(source, "messages.wel"),
      ),
    ).toMatchObject({ kind: "trans", prefix: "messages.wel" });
  });

  it("returns null for a dynamic route() argument (variable, not a literal)", () => {
    const source = `{{ route($name) }}`;
    const position = positionAfter(source, "$name");

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toBeNull();
  });

  it("still offers completion for the literal prefix even when concatenated", () => {
    // Completion cares about the literal currently being typed, matching the
    // PHP-file behaviour of `phpLaravelConfigReferenceContextAt` (the second
    // concatenated part is simply a separate, unrelated argument expression).
    const source = `{{ config('app.' . $suffix) }}`;
    const position = positionAfter(source, "app.");

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toMatchObject({
      kind: "config",
      prefix: "app.",
    });
  });

  it("returns null outside of any helper call", () => {
    const source = `<div class="foo">{{ $title }}</div>`;
    const position = positionAfter(source, "foo");

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toBeNull();
  });

  it("returns null for an unrelated function call", () => {
    const source = `{{ strtoupper('users.ind') }}`;
    const position = positionAfter(source, "users.ind");

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toBeNull();
  });

  // Regression: a Blade source STARTING with `{{ ... }}` (e.g. `{{ __('title')
  // }}` on the very first line, a common pattern) used to hang
  // `innermostBladeEchoSpanAt` forever once the cursor was outside that first
  // echo span. The backward scan re-called `source.lastIndexOf(open, openIndex
  // - 1)`; once `openIndex` reached 0, the next call became
  // `lastIndexOf(open, -1)`, which JS clamps to `lastIndexOf(open, 0)` instead
  // of stopping the scan, so it kept re-finding offset 0 forever. Every
  // keystroke in `provideBladeCompletions` and every Cmd+B lookup would hang.
  it("returns null promptly when the cursor sits in plain HTML text after a leading echo at offset 0", () => {
    const source = `{{ __('title') }}\n<div>\n    plain text here\n</div>\n`;
    const position = positionAfter(source, "plain text here");

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toBeNull();
  });

  it("returns null promptly for the gap between two echo spans when the first sits at offset 0", () => {
    const source = `{{ __('title') }} gap {{ __('other') }}`;
    const position = positionAfter(source, " gap ");

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toBeNull();
  });

  it("returns null promptly for the cursor before the first echo when that echo sits at offset 0", () => {
    const source = `{{ __('title') }}`;
    const position = { column: 1, lineNumber: 1 };

    expect(bladeLaravelHelperCompletionContextAt(source, position)).toBeNull();
  });

  // A `{{ route(...) }}` / `{{ config(...) }}` / `{{ __(...) }}` echo nested
  // inside a double-quoted HTML attribute (`href="{{ route(...) }}"`) is an
  // extremely common real-world Blade pattern. Because the PHP-file reference
  // scanners (`phpLaravelNamedRouteReferenceContextAt` and friends) track quote
  // balance over the WHOLE source with no notion of HTML vs. PHP, the outer
  // `href="..."` double-quote silently swallows everything up to the next `"`,
  // so the inner literal is never seen as a distinct string. Verified against
  // a real generated Blade file (vendor Scribe API docs) in
  // kontentino/api/resources/views/scribe/index.blade.php, which uses exactly
  // this pattern. This block scopes detection to the innermost `{{ }}` / `{!!
  // !!}` echo (or `@directive(...)` call) around the cursor first, so the
  // ambiguous outer HTML quote never reaches the scanner.
  it("detects route() nested inside a double-quoted HTML attribute (real Scribe pattern)", () => {
    const source = `<a href="{{ route('scribe.postman') }}">x</a>`;

    expect(
      bladeLaravelHelperCompletionContextAt(source, positionAfter(source, "scribe.postman")),
    ).toMatchObject({ kind: "route", prefix: "scribe.postman" });
  });

  it("detects route() with double-quoted PHP literal nested inside a double-quoted HTML attribute", () => {
    const source = `<a href="{{ route("scribe.openapi") }}">x</a>`;

    expect(
      bladeLaravelHelperCompletionContextAt(source, positionAfter(source, "scribe.openapi")),
    ).toMatchObject({ kind: "route", prefix: "scribe.openapi" });
  });

  it("detects config() nested inside a double-quoted HTML attribute", () => {
    const source = `<div data-x="{{ config('app.deb') }}"></div>`;

    expect(
      bladeLaravelHelperCompletionContextAt(source, positionAfter(source, "app.deb")),
    ).toMatchObject({ kind: "config", prefix: "app.deb" });
  });

  it("detects __() nested inside a double-quoted HTML attribute", () => {
    const source = `<div title="{{ __('messages.wel') }}"></div>`;

    expect(
      bladeLaravelHelperCompletionContextAt(source, positionAfter(source, "messages.wel")),
    ).toMatchObject({ kind: "trans", prefix: "messages.wel" });
  });
});

describe("bladeLaravelStringLiteralHelperAt", () => {
  function offsetAfter(source: string, needle: string) {
    const offset = source.indexOf(needle);

    if (offset < 0) {
      throw new Error(`Missing test needle: ${needle}`);
    }

    return offset + needle.length;
  }

  it("resolves a closed config() literal for Cmd+B", () => {
    const source = `{{ config('app.name') }}`;

    expect(
      bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "app.name")),
    ).toMatchObject({ helper: "config", literal: "app.name" });
  });

  it("resolves __() to the trans helper for Cmd+B", () => {
    const source = `{{ __('messages.welcome') }}`;

    expect(
      bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "messages.welcome")),
    ).toMatchObject({ helper: "trans", literal: "messages.welcome" });
  });

  // Same real-world Scribe pattern as bladeLaravelHelperCompletionContextAt:
  // `href="{{ route(...) }}"` — without echo scoping the outer HTML `"`
  // swallows the inner literal and this returns null (verified pre-existing
  // behaviour at HEAD, shared by the already-shipped route()/view() Cmd+B path).
  it("resolves route() nested inside a double-quoted HTML attribute", () => {
    const source = `<a href="{{ route('scribe.postman') }}">x</a>`;

    expect(
      bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "scribe.postman")),
    ).toMatchObject({ helper: "route", literal: "scribe.postman" });
  });

  it("resolves config() with a double-quoted PHP literal nested inside a double-quoted HTML attribute", () => {
    const source = `<a href="{{ route("scribe.openapi") }}">x</a>`;

    expect(
      bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "scribe.openapi")),
    ).toMatchObject({ helper: "route", literal: "scribe.openapi" });
  });

  it("resolves __() nested inside a double-quoted HTML attribute", () => {
    const source = `<div title="{{ __('messages.wel') }}"></div>`;

    expect(
      bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "messages.wel")),
    ).toMatchObject({ helper: "trans", literal: "messages.wel" });
  });

  it("returns literal offsets remapped into the outer document, not the inner echo", () => {
    const source = `<a href="{{ route('scribe.postman') }}">x</a>`;
    const literalStart = source.indexOf("scribe.postman");

    const result = bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "scribe.postman"));

    expect(result).toMatchObject({
      literalEnd: literalStart + "scribe.postman".length,
      literalStart,
    });
  });

  it("returns null for a dynamic route() argument", () => {
    const source = `{{ route($name) }}`;

    expect(bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "$name"))).toBeNull();
  });

  it("returns null outside of any helper call", () => {
    const source = `<div class="foo">{{ $title }}</div>`;

    expect(bladeLaravelStringLiteralHelperAt(source, offsetAfter(source, "foo"))).toBeNull();
  });
});
