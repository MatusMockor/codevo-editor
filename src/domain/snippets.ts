/**
 * Live templates / snippets (PhpStorm Live Templates / VS Code snippets).
 *
 * A snippet maps a short `prefix` to a `body` written in Monaco snippet syntax
 * (`$1`, `${1:default}`, `$0`, …). When the body is fed to Monaco as a
 * completion item with `InsertAsSnippet`, Monaco expands the tab-stops and
 * placeholders natively.
 *
 * Snippets are GLOBAL built-ins (not workspace state), so there is no
 * per-project isolation concern in this module: the same registry is shared by
 * every open project tab. Isolation is preserved entirely by the completion
 * wiring that consumes this registry.
 */

export type SnippetLanguage = string;

export interface Snippet {
  /** Short trigger typed by the user, e.g. `nclass`. */
  readonly prefix: string;
  /** Body in Monaco snippet syntax (`$1`/`${1:default}`/`$0`). */
  readonly body: string;
  /** Human-readable summary shown in the completion detail. */
  readonly description: string;
  /** Languages this snippet is offered in (e.g. `php`, `blade`). */
  readonly languages: readonly SnippetLanguage[];
}

const PHP = ["php"] as const;
const JS_TS = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
] as const;
const BLADE = ["blade"] as const;

/**
 * Built-in PHP / Laravel snippets. Bodies use Monaco snippet syntax so Monaco
 * resolves the tab-stops/placeholders on expansion. Keep prefixes unique per
 * language so the prefix match stays deterministic.
 */
const BUILT_IN_SNIPPETS: readonly Snippet[] = [
  {
    prefix: "nclass",
    description: "New class skeleton",
    languages: PHP,
    body: "class ${1:ClassName}\n{\n\t$0\n}",
  },
  {
    prefix: "pubf",
    description: "public function",
    languages: PHP,
    body: "public function ${1:name}(${2:}): ${3:void}\n{\n\t$0\n}",
  },
  {
    prefix: "prif",
    description: "private function",
    languages: PHP,
    body: "private function ${1:name}(${2:}): ${3:void}\n{\n\t$0\n}",
  },
  {
    prefix: "construct",
    description: "Constructor with promoted property",
    languages: PHP,
    body: "public function __construct(${1:})\n{\n\t$0\n}",
  },
  {
    prefix: "foreachk",
    description: "foreach with key => value",
    languages: PHP,
    body: "foreach (${1:\\$items} as ${2:\\$key} => ${3:\\$value}) {\n\t$0\n}",
  },
  {
    prefix: "dd",
    description: "dd() and die",
    languages: PHP,
    body: "dd($0);",
  },
  {
    prefix: "ddd",
    description: "ddd() debug dump",
    languages: PHP,
    body: "ddd($0);",
  },
  {
    prefix: "route",
    description: "Laravel route definition",
    languages: PHP,
    body: "Route::${1:get}('${2:uri}', [${3:Controller}::class, '${4:method}'])->name('${5:name}');$0",
  },
  {
    prefix: "model",
    description: "Eloquent model skeleton",
    languages: PHP,
    body: "class ${1:ModelName} extends Model\n{\n\tprotected \\$fillable = [\n\t\t$0\n\t];\n}",
  },
  {
    prefix: "migration",
    description: "Migration up/down skeleton",
    languages: PHP,
    body:
      "public function up(): void\n{\n\tSchema::create('${1:table}', function (Blueprint \\$table) {\n\t\t\\$table->id();\n\t\t$0\n\t\t\\$table->timestamps();\n\t});\n}\n\npublic function down(): void\n{\n\tSchema::dropIfExists('${1:table}');\n}",
  },
  {
    prefix: "test",
    description: "PHPUnit test method",
    languages: PHP,
    body:
      "public function test_${1:it_does_something}(): void\n{\n\t$0\n\n\t\\$this->assertTrue(true);\n}",
  },
  {
    prefix: "dispatch",
    description: "Dispatch a job",
    languages: PHP,
    body: "${1:Job}::dispatch($0);",
  },
  // JavaScript / TypeScript (light mode, VS Code parity).
  {
    prefix: "clg",
    description: "console.log",
    languages: JS_TS,
    body: "console.log($0);",
  },
  {
    prefix: "fn",
    description: "function declaration",
    languages: JS_TS,
    body: "function ${1:name}(${2:}) {\n\t$0\n}",
  },
  {
    prefix: "afn",
    description: "arrow function",
    languages: JS_TS,
    body: "const ${1:name} = (${2:}) => {\n\t$0\n};",
  },
  {
    prefix: "imp",
    description: "import statement",
    languages: JS_TS,
    body: "import { ${1:} } from \"${2:module}\";$0",
  },
  {
    prefix: "exp",
    description: "export const",
    languages: JS_TS,
    body: "export const ${1:name} = $0;",
  },
  {
    prefix: "forof",
    description: "for…of loop",
    languages: JS_TS,
    body: "for (const ${1:item} of ${2:items}) {\n\t$0\n}",
  },
  {
    prefix: "cls",
    description: "class declaration",
    languages: JS_TS,
    body: "class ${1:Name} {\n\tconstructor(${2:}) {\n\t\t$0\n\t}\n}",
  },
  {
    prefix: "tryc",
    description: "try / catch",
    languages: JS_TS,
    body: "try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}",
  },
  {
    prefix: "prom",
    description: "new Promise",
    languages: JS_TS,
    body: "new Promise((${1:resolve}, ${2:reject}) => {\n\t$0\n});",
  },
  {
    prefix: "switch",
    description: "switch statement",
    languages: JS_TS,
    body:
      "switch (${1:value}) {\n\tcase ${2:case}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}",
  },
  // Blade (IDE mode, PhpStorm parity). Prefixes mirror the directive a developer
  // types, including the leading `@`, so the live template fires from the same
  // abbreviation the directive would.
  {
    prefix: "@if",
    description: "Blade @if / @endif",
    languages: BLADE,
    body: "@if (${1:condition})\n\t$0\n@endif",
  },
  {
    prefix: "@foreach",
    description: "Blade @foreach / @endforeach",
    languages: BLADE,
    body: "@foreach (\\$${1:items} as \\$${2:item})\n\t$0\n@endforeach",
  },
  {
    prefix: "@forelse",
    description: "Blade @forelse / @empty / @endforelse",
    languages: BLADE,
    body:
      "@forelse (\\$${1:items} as \\$${2:item})\n\t$0\n@empty\n\t${3:}\n@endforelse",
  },
  {
    prefix: "@section",
    description: "Blade @section / @endsection",
    languages: BLADE,
    body: "@section('${1:name}')\n\t$0\n@endsection",
  },
  {
    prefix: "@extends",
    description: "Blade @extends",
    languages: BLADE,
    body: "@extends('${1:layout}')$0",
  },
  {
    prefix: "@component",
    description: "Blade @component / @endcomponent",
    languages: BLADE,
    body: "@component('${1:name}')\n\t$0\n@endcomponent",
  },
  {
    prefix: "@php",
    description: "Blade @php / @endphp",
    languages: BLADE,
    body: "@php\n\t$0\n@endphp",
  },
  {
    prefix: "bvar",
    description: "Blade echoed variable",
    languages: BLADE,
    body: "{{ \\$${1:variable} }}$0",
  },
];

/**
 * Returns the built-in snippets offered for `language`. Language-scoped so PHP
 * snippets never appear in JS, etc.
 */
export function snippetsForLanguage(language: SnippetLanguage): Snippet[] {
  return BUILT_IN_SNIPPETS.filter((snippet) =>
    snippet.languages.includes(language),
  );
}

/**
 * Returns the language-scoped snippets whose prefix begins with `word`
 * (case-insensitive). An empty `word` returns every snippet for the language so
 * the editor can surface them all when completion is triggered without a typed
 * prefix.
 */
export function matchingSnippetsForLanguage(
  language: SnippetLanguage,
  word: string,
): Snippet[] {
  const normalized = word.toLowerCase();

  return snippetsForLanguage(language).filter((snippet) =>
    snippet.prefix.toLowerCase().startsWith(normalized),
  );
}

/**
 * Structural subset of the Monaco namespace the snippet completion helper needs.
 * Declared locally so this pure-domain module never imports the editor runtime,
 * yet the wiring layers can pass the real `typeof Monaco` straight through.
 */
export interface SnippetMonacoApi {
  languages: {
    CompletionItemInsertTextRule: { InsertAsSnippet: number };
    CompletionItemKind: { Snippet: number };
  };
}

/** A Monaco completion item carrying a live-template snippet body. */
export interface SnippetCompletionItem {
  detail: string;
  insertText: string;
  insertTextRules: number;
  kind: number;
  label: string;
  range: unknown;
  sortText: string;
}

/**
 * Builds language-scoped live-template completion items for the typed `word`,
 * shared by every editor wiring (PHP, JS/TS, Blade) so the InsertAsSnippet /
 * `Snippet` kind / `2_` sort-bucket behaviour stays identical across modes.
 *
 * The snippet registry is a GLOBAL built-in (no workspace state), so this helper
 * carries no per-project isolation risk; each caller keeps its own
 * root/session/token guards around it.
 *
 * Snippets are surfaced from a typed abbreviation (PhpStorm / VS Code live
 * template behaviour). With no typed prefix the whole catalogue would flood
 * every keystroke, so an empty `word` yields nothing.
 */
export function snippetCompletionSuggestions(
  monaco: SnippetMonacoApi,
  language: SnippetLanguage,
  word: string,
  range: unknown,
): SnippetCompletionItem[] {
  if (word.length === 0) {
    return [];
  }

  return matchingSnippetsForLanguage(language, word).map((snippet, index) => ({
    detail: snippet.description,
    insertText: snippet.body,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    kind: monaco.languages.CompletionItemKind.Snippet,
    label: snippet.prefix,
    range,
    sortText: `2_${String(index).padStart(4, "0")}`,
  }));
}
