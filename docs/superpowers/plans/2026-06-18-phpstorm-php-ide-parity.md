# PhpStorm PHP IDE Parity

## Goal

IDE Mode should make PHP and Laravel projects feel meaningfully smarter than Basic mode: receiver-aware completion, accurate method navigation, inherited and trait-aware members, Laravel helpers, and project-scoped indexing/runtime processes.

## Current Focus

- Keep Basic mode lightweight.
- Keep PHP IDE Mode project-scoped and optional.
- Prefer semantic receiver inference over one-off keyword hacks.
- Make completion, signature help, and navigation share the same expression/type resolver so features do not drift apart.

## Implemented

- Repository and Eloquent return inference now feeds model completions for typed assignments like `findOrFail(...)`.
- Laravel container expressions are inferred for assigned variables and direct receivers:
  - `app(Service::class)`
  - `resolve(Service::class)`
  - `make(Service::class)`
  - `app()->make(Service::class)`
  - `App::make(Service::class)`
  - `Container::getInstance()->make(Service::class)`
- Method completion and signature help now resolve those Laravel container receivers.
- Cmd+B / Go to Definition now recognizes methods called on Laravel container receivers and opens the concrete method target.
- Completion, signature help, navigation, and semantic type resolution now share one PHP receiver grammar.
- IDE Mode now understands PHPDoc generic class-string helpers when the target method/function declares `@template T`, `@param class-string<T>`, and `@return T`. This feeds completions for assigned variables and direct chains like `$locator->get(Service::class)->...`, `ServiceLocator::get(Service::class)->...`, and same-file helper functions.
- Laravel container interface bindings are inferred from service providers when projects expose explicit `bind`, `singleton`, `scoped`, or contextual `needs()->give()` mappings. Completion, return inference, and Cmd+B can now use the bound concrete implementation when an injected dependency is typed as an interface.
- Laravel local scopes on Eloquent models are exposed as builder completions. `scopePublished($query, bool $strict = true)` becomes `published(bool $strict = true)`, and scope chains keep the original model type through terminal methods like `first()`.

## Next Tasks

- Improve PHPDoc inheritance and trait host-context diagnostics to reduce false positives without hiding app bugs.
- Add more model relation return inference for `hasOne`, `hasMany`, `belongsTo`, `morph*`, and collection chains.
- Add UI smoke tests for IDE Mode on a real Laravel workspace.
