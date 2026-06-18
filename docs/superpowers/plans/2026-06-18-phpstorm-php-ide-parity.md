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
- Laravel local scopes are also exposed as static model magic completions. `scopeWithRelations(Builder $query)` becomes `Model::withRelations()` in completion and signature help without leaking the internal `$query` parameter.
- Cmd+B / Go to Definition now recognizes static PHP method calls. Laravel model local scopes jump to their `scope*` method, while Eloquent builder magic calls such as `Model::whereNull()` can fall back to `Illuminate\Database\Eloquent\Builder`.
- PHPactor unresolved static-method diagnostics for Laravel local scopes are now reconciled through the semantic engine. Project scopes are suppressed only when the target model actually defines the matching `scope*` method; unknown magic calls remain visible.
- Laravel collection chains now preserve the related model type across fluent calls like `filter()`, `where()`, `values()`, and `unique()`, so `get()->filter()->first()->...` and relation-property chains keep model-aware completions.
- Laravel relation methods are now also exposed as magic relation properties in member completion. Methods like `parent(): BelongsTo`, `attachments(): HasMany`, and PHPDoc-generic `commentable(): MorphTo<Post, self>` can show `parent`, `attachments`, and `commentable` as property-style completions with related model types.
- Laravel polymorphic many-to-many relations now resolve `morphedByMany(Related::class, ...)` targets, so terminal relation chains like `$model->likers()->first()->...` expose the related model members.
- PHPDoc `@var` generic types now keep spaced generic arguments intact, for example `Collection<int, Album> $items`, so receiver inference can use documented collection model types even when there is no query-builder assignment to fall back to.
- Laravel model completions now expose magic attributes declared through `$fillable` and `$casts`, with cast-aware return types for common scalar, array, collection, date, and stringable casts.
- Laravel model completions now expose accessor-backed magic attributes from `$appends`, legacy `getFooAttribute()` accessors, and modern `Attribute<T, ...>` accessors, including nested generic value types like `Attribute<array<string, mixed>, never>`.
- Laravel model-builder factory calls now preserve their model context. `$model->newQuery()`, `$model->newModelQuery()`, `newQueryWithoutScopes()`, `on()`, and related factory calls behave as Eloquent builders while still feeding local scopes and terminal methods back to the original model type.
- PHPDoc `@mixin` declarations now participate in the same class hierarchy pipeline as traits and parents. Completion, signature help, return inference, property/relation inference, and method navigation can use members declared on mixin classes.
- Inherited fluent methods that declare `@return static` or `@return $this` now keep the original receiver class during return inference. A child model calling a parent/mixin fluent method can continue to complete child-only members after the chain.
- PHPDoc model properties with spaced generic collection types are now preserved, and relation collection chains like `@property-read Collection<int, User> $reviewers` followed by `$model->reviewers->first()->...` infer `User` completions.
- Custom collection classes with PHPDoc `@extends` / `@implements` generic collection types now feed terminal collection inference, so `AlbumCollection extends Collection<int, Album>` followed by `$albums->first()->...` keeps `Album` completions.
- Laravel relation query callbacks now infer the related model builder. In `Model::query()->whereHas('tracks', function ($query) { ... })`, `$query` gets Eloquent builder methods, local scopes from the `Track` model, and terminal calls like `$query->first()` resolve back to `Track`.

## Next Tasks

- Improve PHPDoc inheritance and trait host-context diagnostics to reduce false positives without hiding app bugs.
- Add more model relation return inference for `hasOne`, `hasMany`, `belongsTo`, and remaining `morph*` edge cases.
- Add UI smoke tests for IDE Mode on a real Laravel workspace.
