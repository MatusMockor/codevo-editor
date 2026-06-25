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
