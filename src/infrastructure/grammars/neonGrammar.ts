import type { LanguageRegistration } from "shiki/core";

/**
 * Minimal, self-authored TextMate grammar for Nette **NEON** config files
 * (`.neon` - `config.neon`, `services.neon`). NEON is a YAML-like format with a
 * few Nette-specific constructs (entities `Class(arg)`, service references
 * `@name`, parameter interpolation `%param%`). No NEON grammar ships in Shiki's
 * bundle and the surveyed community grammars lacked a clearly reusable license,
 * so this is written from scratch for Codevo (no third-party code / attribution).
 *
 * Scope: highlighting only (all modes, no framework gating). Every rule is a
 * bounded single-line `match`, so nothing hangs or throws on malformed input.
 */
export const neonGrammar: LanguageRegistration = {
  displayName: "NEON",
  name: "neon",
  scopeName: "source.neon",
  fileTypes: ["neon"],
  patterns: [
    { include: "#comment" },
    { include: "#list-marker" },
    { include: "#key" },
    { include: "#reference" },
    { include: "#parameter" },
    { include: "#entity" },
    { include: "#string" },
    { include: "#constant" },
    { include: "#number" },
  ],
  repository: {
    comment: {
      match: "#.*$",
      name: "comment.line.number-sign.neon",
    },
    // `- item` sequence entries.
    "list-marker": {
      match: "^\\s*(-)(?=\\s|$)",
      captures: {
        "1": { name: "punctuation.definition.list.neon" },
      },
    },
    // `key:` / `services:` - a mapping key is followed by a colon that ends the
    // line or is followed by whitespace. Requiring `(?=\s|$)` after the colon
    // keeps `http://...` and `Class::method` values from being read as keys.
    key: {
      match: "(?:^|[\\s{,])([\\w.-]+)(\\s*)(:)(?=\\s|$)",
      captures: {
        "1": { name: "entity.name.tag.neon" },
        "3": { name: "punctuation.separator.key-value.neon" },
      },
    },
    // Nette service references: `@service`, `@Nette\Database\Connection`.
    reference: {
      match: "@[\\w\\\\.]+",
      name: "variable.language.reference.neon",
    },
    // Parameter interpolation: `%appDir%`, `%database.dsn%`.
    parameter: {
      match: "%[\\w.-]+%",
      name: "variable.parameter.neon",
    },
    // Entity: a class name immediately before `(` - the Nette `App\Model\Repo(%dsn%)`
    // entity() shorthand - or before `::` - a PHP-style static/scope-resolution
    // reference used as a NEON value, e.g. `factory: App\Router\RouterFactory::createRouter()`.
    // `(?<!::)` alone would only block a match from *starting* right after `::`;
    // the scanner would then just retry one character later and match a
    // truncated identifier (e.g. `reate` out of `createRouter`). The leading
    // `\b` pins the match to a real identifier start, so combined with the
    // lookbehind, `RouterFactory::createRouter()` tags only `RouterFactory` -
    // the method name `createRouter` is left as plain text entirely.
    entity: {
      match:
        "\\b(?<!::)([A-Za-z_][\\w]*(?:\\\\[A-Za-z_][\\w]*)+|[A-Za-z_][\\w]*)(?=\\s*(?:\\(|::))",
      name: "entity.name.class.neon",
    },
    string: {
      patterns: [
        {
          match: "'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'",
          name: "string.quoted.single.neon",
        },
        {
          match: "\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"",
          name: "string.quoted.double.neon",
        },
      ],
    },
    constant: {
      match: "\\b(true|false|yes|no|on|off|null)\\b",
      name: "constant.language.neon",
    },
    number: {
      match: "\\b\\d+(?:\\.\\d+)?\\b",
      name: "constant.numeric.neon",
    },
  },
};

export default [neonGrammar];
