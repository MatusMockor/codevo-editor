import type { LanguageRegistration } from "shiki/core";

/**
 * Fixed allowlist of Latte tag names (https://latte.nette.org/en/tags),
 * mirroring how Shiki's bundled Blade grammar fixes its `@directive`
 * alternation to a known keyword list (`@(?:auth|break|can|...)`) instead of
 * matching any bare identifier. An open `[a-zA-Z_]\w*` identifier branch here
 * would treat *any* `{word ...}` as a Latte tag - including a stray
 * `{enabled: true}` object literal inside an embedded `<script>` block - so
 * `latte-tag` below only opens `meta.tag.latte` for a name on this list.
 */
const LATTE_TAG_NAMES = [
  "if",
  "elseif",
  "else",
  "ifset",
  "elseifset",
  "ifchanged",
  "switch",
  "case",
  "default",
  "foreach",
  "for",
  "while",
  "first",
  "last",
  "sep",
  "iterateWhile",
  "var",
  "varType",
  "varPrint",
  "parameters",
  "templateType",
  "templatePrint",
  "capture",
  "include",
  "includeblock",
  "sandbox",
  "extends",
  "layout",
  "import",
  "embed",
  "block",
  "define",
  "contentType",
  "spaceless",
  "syntax",
  "dump",
  "debugbreak",
  "l",
  "r",
  "link",
  "plink",
  "control",
  "snippet",
  "snippetArea",
  "cache",
  "form",
  "formContainer",
  "formContext",
  "formPrint",
  "label",
  "input",
  "inputError",
  "translate",
  "_",
  "php",
  "do",
];

/**
 * Minimal, self-authored TextMate grammar for the Nette **Latte** template
 * engine (`.latte`). No MIT-licensed Latte grammar ships in the Shiki bundle
 * (`@shikijs/langs` only carries `blade`), and the community Latte grammars
 * we surveyed did not carry a clearly reusable license, so this grammar is
 * written from scratch for Codevo (no third-party code, no attribution needed).
 *
 * Design (mirrors how Shiki's bundled `blade` grammar layers on top of HTML):
 * the document is HTML at its root (`{ include: "text.html.basic" }`), and the
 * Latte constructs are layered in through an **injection** keyed on this
 * grammar's own root scope (`text.html.latte`). Injecting rather than nesting
 * lets `{$var}` echoes and `n:` attributes highlight even inside HTML tags and
 * attribute values, exactly like Blade injects `{{ }}` into `text.html.php.blade`.
 *
 * Scope: highlighting only (all modes, no framework gating). Fidelity is
 * deliberately minimal - every rule is a bounded `match` or a single-line
 * `begin/end`, so a malformed template (unclosed tag, stray brace, `{` inside a
 * `<script>` block) degrades to plain text instead of hanging or throwing.
 */
export const latteGrammar: LanguageRegistration = {
  displayName: "Latte",
  name: "latte",
  scopeName: "text.html.latte",
  fileTypes: ["latte"],
  // Inert with `createHighlighterCore` (no auto-loader), but documents that the
  // HTML base grammar (`text.html.basic`) must be present in the highlighter for
  // the `text.html.basic` include below to resolve. It always is: `html` is a
  // first-class `SHIKI_LANGS` entry loaded alongside this grammar.
  embeddedLangs: ["html"],
  // The root of a `.latte` file is HTML; Latte macros are injected on top.
  patterns: [{ include: "text.html.basic" }],
  injections: {
    // `L:` (left / higher priority) so Latte macros win over the HTML base at a
    // given offset. The bare `text.html.latte` scope sits at the bottom of every
    // scope stack in the document, so this injection applies everywhere -
    // including inside `<tag ...>` where `n:` attributes live. `- comment.block.latte`
    // (mirrors Blade's own injection exclusions) stops the injection from being
    // tried again once we're already inside a `{* ... *}` comment, so a stray
    // `{if ...}` written inside a comment for documentation purposes stays plain
    // comment text instead of lighting up as a real tag.
    "L:text.html.latte - comment.block.latte": {
      patterns: [
        { include: "#latte-comment" },
        { include: "#latte-n-attribute" },
        { include: "#latte-tag" },
      ],
    },
  },
  repository: {
    "latte-comment": {
      name: "comment.block.latte",
      begin: "\\{\\*",
      end: "\\*\\}",
    },
    // `n:if`, `n:foreach`, `n:inner-foreach`, `n:class`, `n:href`, `n:name`, ...
    // `\bn:` only fires at a word boundary, so `min:height` / `span:...` are safe.
    "latte-n-attribute": {
      match: "\\bn:[a-zA-Z][\\w:-]*",
      name: "entity.other.attribute-name.latte",
    },
    // A Latte macro: `{if $x}`, `{foreach ...}`, `{/foreach}`, `{$var}`,
    // `{= expr}`, `{include 'file'}`. The optional leading `/` marks a closing
    // tag; the tag name is only captured when it is on the `LATTE_TAG_NAMES`
    // allowlist above, so no `\G` anchor is needed (the JS regex engine emulates
    // `\G` inconsistently) and an arbitrary `{word ...}` never opens a tag. The
    // lookahead branch covers the three tag-less forms: `{$var}` (variable
    // echo), `{=expr}` (expression echo) and a bare `{/}` closing tag (where
    // `(/?)` backtracks to empty so the lookahead sees the `/` itself). A brace
    // followed by whitespace, a digit, an unknown identifier, or a quote
    // (`body { ... }` in embedded CSS, `{enabled: true}` in embedded JS) never
    // matches, so plain markup/script braces stay untouched.
    "latte-tag": {
      name: "meta.tag.latte",
      begin: `(\\{)(/?)(?:(${LATTE_TAG_NAMES.join("|")})\\b|(?=[$=/]))`,
      beginCaptures: {
        "1": { name: "punctuation.definition.tag.begin.latte" },
        "2": { name: "punctuation.definition.tag.latte" },
        "3": { name: "keyword.control.latte" },
      },
      // Line-bound: falls back to end-of-line (`$`) when the closing `}` is
      // missing, so a tag left open mid-typing (`{foreach $items as $item`)
      // degrades to "only this line is colored" instead of leaking
      // `meta.tag.latte` into every following line until a stray `}` closes it.
      // Latte tags are practically always single-line, so a genuine multi-line
      // tag simply loses highlighting past its first line - an acceptable
      // trade for never bleeding into unrelated markup.
      end: "(\\})|$",
      endCaptures: {
        "1": { name: "punctuation.definition.tag.end.latte" },
      },
      patterns: [
        { include: "#latte-filter" },
        { include: "#latte-expression" },
      ],
    },
    // Filter chains: `{$name|upper|truncate:30}`.
    "latte-filter": {
      match: "(\\|)([a-zA-Z_][\\w]*)",
      captures: {
        "1": { name: "punctuation.definition.filter.latte" },
        "2": { name: "support.function.filter.latte" },
      },
    },
    "latte-expression": {
      patterns: [
        { include: "#latte-string" },
        {
          match: "\\$[a-zA-Z_][\\w]*",
          name: "variable.other.latte",
        },
        {
          match: "\\b(as|in|and|or|xor|not|true|false|null|new|clone|instanceof)\\b",
          name: "keyword.operator.latte",
        },
        {
          match: "\\b\\d+(?:\\.\\d+)?\\b",
          name: "constant.numeric.latte",
        },
        {
          match: "[-+*/%!=<>&|.:?^~]+",
          name: "keyword.operator.latte",
        },
      ],
    },
    // Bounded single-line strings: an unterminated quote fails the match instead
    // of running an open `begin/end` context past the closing `}` of the tag.
    "latte-string": {
      patterns: [
        {
          match: "'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'",
          name: "string.quoted.single.latte",
        },
        {
          match: "\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"",
          name: "string.quoted.double.latte",
        },
      ],
    },
  },
};

export default [latteGrammar];
