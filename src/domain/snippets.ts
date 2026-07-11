/**
 * Live templates / snippets (PhpStorm Live Templates / VS Code snippets).
 *
 * A snippet maps a short `prefix` to a `body` written in Monaco snippet syntax
 * (`$1`, `${1:default}`, `$0`, …). When the body is fed to Monaco as a
 * completion item with `InsertAsSnippet`, Monaco expands the tab-stops and
 * placeholders natively.
 *
 * Both the built-in registry and the user-authored snippets merged into it are
 * GLOBAL (app-level, not workspace state), so there is no per-project isolation
 * concern in this module: the same set is shared by every open project tab.
 * Isolation is preserved entirely by the completion wiring that consumes it.
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

/**
 * User-authored live template (PhpStorm/VS Code user snippet). Stored GLOBALLY
 * in app settings (not per-workspace), so the same set is shared by every open
 * project tab. Fields are mutable plain data because the Settings UI edits them
 * in place; the completion layer treats them like read-only {@link Snippet}s.
 */
export interface UserSnippet {
  prefix: string;
  body: string;
  description: string;
  languages: string[];
}

/**
 * Sanitises persisted/user-entered snippets into a well-formed list: trims the
 * string fields, drops entries missing a prefix, body, or any language, and
 * dedupes language ids (ignoring non-string ones). Shared by the settings
 * normaliser so malformed storage never reaches the completion layer.
 */
export function normalizeUserSnippets(value: unknown): UserSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const normalized = normalizeUserSnippet(entry);

    return normalized ? [normalized] : [];
  });
}

function normalizeUserSnippet(value: unknown): UserSnippet | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const prefix = typeof record.prefix === "string" ? record.prefix.trim() : "";
  const body = typeof record.body === "string" ? record.body : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const languages = normalizeSnippetLanguages(record.languages);

  if (!prefix || !body || languages.length === 0) {
    return null;
  }

  return { prefix, body, description, languages };
}

function normalizeSnippetLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const languages = value
    .filter((language): language is string => typeof language === "string")
    .map((language) => language.trim())
    .filter(Boolean);

  return Array.from(new Set(languages));
}

const PHP = ["php"] as const;
const JS_TS = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
] as const;
const BLADE = ["blade"] as const;
const LATTE = ["latte"] as const;

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
  {
    prefix: "nact",
    description: "Nette presenter action and render methods",
    languages: PHP,
    body:
      "public function action${1:Default}(${2:}): void\n{\n\t${3:}\n}\n\npublic function render$1(${4:}): void\n{\n\t$0\n}",
  },
  {
    prefix: "nhandle",
    description: "Nette presenter signal handler",
    languages: PHP,
    body: "public function handle${1:Signal}(${2:}): void\n{\n\t$0\n}",
  },
  {
    prefix: "ncomponent",
    description: "Nette component factory method",
    languages: PHP,
    body:
      "protected function createComponent${1:Name}(): ${2:Control}\n{\n\treturn new ${2:Control}($0);\n}",
  },
  {
    prefix: "ninject",
    description: "Nette injected property",
    languages: PHP,
    body: "#[Inject]\npublic ${1:Service} \\$${2:service};$0",
  },
  {
    prefix: "nform",
    description: "Nette Form factory method",
    languages: PHP,
    body:
      "protected function createComponent${1:Form}(): Form\n{\n\t\\$form = new Form;\n\t\\$form->addText('${2:name}', '${3:Label}');\n\t\\$form->addSubmit('send', '${4:Submit}');\n\t\\$form->onSuccess[] = [\\$this, '${5:formSucceeded}'];\n\n\t$0\n\n\treturn \\$form;\n}",
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
  {
    prefix: "{if",
    description: "Latte {if} / {else}",
    languages: LATTE,
    body: "{if ${1:\\$condition}}\n\t${2:}\n{else}\n\t$0\n{/if}",
  },
  {
    prefix: "{foreach",
    description: "Latte {foreach} with iterator",
    languages: LATTE,
    body:
      "{foreach ${1:\\$items} as ${2:\\$item}}\n\t{${3:\\$iterator->counter}}. $0\n{/foreach}",
  },
  {
    prefix: "{ifset",
    description: "Latte {ifset}",
    languages: LATTE,
    body: "{ifset ${1:\\$variable}}\n\t$0\n{/ifset}",
  },
  {
    prefix: "{block",
    description: "Latte named block",
    languages: LATTE,
    body: "{block ${1:content}}\n\t$0\n{/block}",
  },
  {
    prefix: "{define",
    description: "Latte block definition",
    languages: LATTE,
    body: "{define ${1:name}}\n\t$0\n{/define}",
  },
  {
    prefix: "{include",
    description: "Latte template include",
    languages: LATTE,
    body: "{include '${1:partial.latte}'}$0",
  },
  {
    prefix: "{control",
    description: "Latte component control",
    languages: LATTE,
    body: "{control ${1:component}}$0",
  },
  {
    prefix: "{link",
    description: "Latte presenter link",
    languages: LATTE,
    body: "{link ${1:Presenter}:${2:action}}$0",
  },
  {
    prefix: "n:href",
    description: "Latte n:href presenter link",
    languages: LATTE,
    body: 'n:href="${1:Presenter}:${2:action}"$0',
  },
  {
    prefix: "{var",
    description: "Latte variable declaration",
    languages: LATTE,
    body: "{var ${1:\\$name} = ${2:null}}$0",
  },
  {
    prefix: "{default",
    description: "Latte default variable",
    languages: LATTE,
    body: "{default ${1:\\$name} = ${2:null}}$0",
  },
  {
    prefix: "{snippet",
    description: "Latte dynamic snippet",
    languages: LATTE,
    body: "{snippet ${1:name}}\n\t$0\n{/snippet}",
  },
  {
    prefix: "n:if",
    description: "Latte conditional attribute",
    languages: LATTE,
    body: 'n:if="${1:\\$condition}"$0',
  },
  {
    prefix: "n:foreach",
    description: "Latte foreach attribute",
    languages: LATTE,
    body: 'n:foreach="${1:\\$items} as ${2:\\$item}"$0',
  },
  {
    prefix: "{_",
    description: "Latte translated string",
    languages: LATTE,
    body: "{_'${1:translation.key}'}$0",
  },
];

/**
 * Returns the snippets offered for `language`, language-scoped so PHP snippets
 * never appear in JS, etc. When `userSnippets` are supplied they are merged with
 * the built-ins for the same language: a user snippet whose prefix matches a
 * built-in (case-insensitive, same language) OVERRIDES the built-in, so a user
 * can replace an existing live template without producing a duplicate. Built-ins
 * keep their original order; user overrides take the built-in's slot, and new
 * user snippets are appended after the built-ins.
 */
export function snippetsForLanguage(
  language: SnippetLanguage,
  userSnippets: readonly UserSnippet[] = [],
): Snippet[] {
  const builtInForLanguage = BUILT_IN_SNIPPETS.filter((snippet) =>
    snippet.languages.includes(language),
  );
  const userForLanguage = userSnippets.filter((snippet) =>
    snippet.languages.includes(language),
  );
  const overrideByPrefix = new Map(
    userForLanguage.map((snippet) => [snippet.prefix.toLowerCase(), snippet]),
  );
  const builtInPrefixes = new Set(
    builtInForLanguage.map((snippet) => snippet.prefix.toLowerCase()),
  );

  const merged = builtInForLanguage.map(
    (snippet) => overrideByPrefix.get(snippet.prefix.toLowerCase()) ?? snippet,
  );
  // User snippets without a built-in counterpart are appended. A duplicate
  // user prefix collapses to the last entry (the override map already holds it)
  // so the same prefix never appears twice.
  const additionalUserSnippets = Array.from(overrideByPrefix.values()).filter(
    (snippet) => !builtInPrefixes.has(snippet.prefix.toLowerCase()),
  );

  return [...merged, ...additionalUserSnippets];
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
  userSnippets: readonly UserSnippet[] = [],
): Snippet[] {
  const normalized = word.toLowerCase();

  return snippetsForLanguage(language, userSnippets).filter((snippet) =>
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
  userSnippets: readonly UserSnippet[] = [],
): SnippetCompletionItem[] {
  if (word.length === 0) {
    return [];
  }

  return matchingSnippetsForLanguage(language, word, userSnippets).map((snippet, index) => ({
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
