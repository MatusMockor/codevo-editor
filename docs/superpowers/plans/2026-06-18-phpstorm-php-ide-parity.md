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

## Next Tasks

- Share one PHP receiver grammar between completion, signature help, and navigation instead of duplicating regex fragments.
- Add `class-string<T>` and generic container helper inference.
- Resolve Laravel container interface bindings where the project exposes enough information.
- Improve PHPDoc inheritance and trait host-context diagnostics to reduce false positives without hiding app bugs.
- Add more model relation return inference for `hasOne`, `hasMany`, `belongsTo`, `morph*`, and collection chains.
- Add UI smoke tests for IDE Mode on a real Laravel workspace.
