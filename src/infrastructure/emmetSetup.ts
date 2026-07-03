import type * as Monaco from "monaco-editor";
import { emmetCSS, emmetHTML, emmetJSX } from "emmet-monaco-es";

// The project tokenizes with Shiki (TextMate grammars) instead of Monaco's
// built-in Monarch tokenizer. Emmet defaults to reading Monarch token state to
// decide where an abbreviation is valid, which never matches under Shiki and
// silently disables expansion. The `standard` tokenizer makes Emmet rely on
// Monaco's StandardTokenType API instead, which Shiki populates, so abbreviation
// expansion works regardless of the active grammar.
const EMMET_OPTIONS = { tokenizer: "standard" } as const;

// HTML-compatible languages. PHP, Blade and Latte are HTML-like host languages,
// so the HTML Emmet provider handles their markup context. (NEON is not markup,
// so it is intentionally excluded.)
const HTML_LANGUAGES = ["html", "php", "blade", "latte"];

// CSS-compatible languages.
const CSS_LANGUAGES = ["css", "scss"];

// JSX/TSX-compatible languages. The JSX provider handles the JSX context inside
// every JavaScript/TypeScript flavour.
const JSX_LANGUAGES = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
];

// The `monaco` object handed to `beforeMount` is a shared singleton from the
// loader, so `beforeMount` (which fires on every editor mount) would otherwise
// register the Emmet providers again and again, leaking providers and producing
// duplicate completion items. This registry remembers which Monaco instances
// already have Emmet wired up so registration stays idempotent regardless of how
// often the call site invokes `setupEmmet`. A WeakMap keyed by the Monaco
// instance never pins the singleton in memory, so it cannot leak.
const emmetRegistry = new WeakMap<typeof Monaco, Monaco.IDisposable>();

/**
 * Registers Emmet abbreviation expansion (e.g. `div.container` -> Tab ->
 * `<div className="container"></div>`) for web languages on the given Monaco
 * instance. Must run before `onMount`, synchronously, alongside the other
 * editor language setup.
 *
 * Idempotent per Monaco instance: calling it repeatedly for the same instance
 * reuses the existing registration instead of registering duplicate providers.
 *
 * @returns a disposable that unregisters every Emmet provider.
 */
export function setupEmmet(monaco: typeof Monaco): Monaco.IDisposable {
  const existing = emmetRegistry.get(monaco);

  if (existing) {
    return existing;
  }

  const disposers = [
    emmetHTML(monaco, HTML_LANGUAGES, EMMET_OPTIONS),
    emmetCSS(monaco, CSS_LANGUAGES, EMMET_OPTIONS),
    emmetJSX(monaco, JSX_LANGUAGES, EMMET_OPTIONS),
  ];

  const disposable: Monaco.IDisposable = {
    dispose() {
      emmetRegistry.delete(monaco);

      for (const disposeEmmet of disposers) {
        disposeEmmet();
      }
    },
  };

  emmetRegistry.set(monaco, disposable);

  return disposable;
}
