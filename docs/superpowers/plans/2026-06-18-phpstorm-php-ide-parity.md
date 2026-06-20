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
- Laravel collection terminal calls now include `firstOrFail()`, and model fluent eager-loading calls like `load()`, `loadMissing()`, `loadCount()`, and `loadMorph()` keep the original model type through chained completions.
- Laravel relation methods are now also exposed as magic relation properties in member completion. Methods like `parent(): BelongsTo`, `attachments(): HasMany`, and PHPDoc-generic `commentable(): MorphTo<Post, self>` can show `parent`, `attachments`, and `commentable` as property-style completions with related model types.
- Laravel relation-name strings now participate in navigation. Cmd+B on strings in helpers such as `$model->load('children')`, `Model::with('parent')`, and `Model::query()->whereHas('children', ...)` opens the matching relation method on the inferred model.
- Laravel relation-name strings now also get model-aware completion. Helpers like `$model->load('chi')`, `Model::with('par')`, and `Model::query()->whereHas('att', ...)` suggest real relation method names from the owning model without mixing in normal attributes or second-argument column strings.
- Nested Laravel relation paths now resolve segment-by-segment. In strings such as `$model->load('children.parent')`, completion and Cmd+B first resolve `children` to its related model and then use that model for `parent`.
- Relation string completions now normalize short related class references through the model source context, so `Attachment::class` can surface as `App\Models\Attachment` and continue into nested relation paths like `attachments.owner`.
- Laravel polymorphic many-to-many relations now resolve `morphedByMany(Related::class, ...)` targets, so terminal relation chains like `$model->likers()->first()->...` expose the related model members.
- Laravel named route strings now participate in completion and navigation. Helpers such as `route('comments.show')`, `to_route('comments.show')`, `redirect()->route('comments.show')`, `URL::route('comments.show')`, and `Route::has('comments.show')` can suggest literal route names and Cmd+B opens the matching `->name('comments.show')` definition before LSP fallback.
- Laravel named route extraction now understands inline name groups such as `Route::name('admin.')->group(function () { Route::get(...)->name('dashboard'); });`, so completions and navigation use the full `admin.dashboard` route name while keeping the cursor target on the local `dashboard` literal.
- Laravel route-name completions insert only the missing suffix when completing dotted names, so completing inside `route('comments.sh')` inserts `show` instead of duplicating the prefix as `comments.comments.show`.
- PHPDoc `@var` generic types now keep spaced generic arguments intact, for example `Collection<int, Album> $items`, so receiver inference can use documented collection model types even when there is no query-builder assignment to fall back to.
- Laravel model completions now expose magic attributes declared through `$fillable` and `$casts`, with cast-aware return types for common scalar, array, collection, date, and stringable casts.
- Laravel model attributes declared through `$fillable`, `$attributes`, and `$casts` now also feed dynamic Eloquent where helpers. `content` becomes `whereContent($value)` and `is_pinned` becomes `whereIsPinned($value)` for static model calls and typed builders, with chain inference, contextual PHPactor diagnostic reconciliation, and Cmd+B navigation back to the source attribute.
- Laravel `$casts` class constants such as `CommentType::class` now resolve through imports and surface the enum/class type in model property completions instead of falling back to `mixed`.
- Modern Laravel `casts()` methods now feed the same model property completion path as the legacy `$casts` property, including scalar/date and class-constant cast types.
- Laravel model completions now also expose magic attributes declared through `$attributes`, with conservative literal-derived types for string, bool, int, float, array, null/mixed defaults.
- Laravel model metadata now resolves local string constants in `$fillable`, `$attributes`, `$casts`, and `$appends`, including conservative `self::`, `static::`, and same-class constant indirections.
- Laravel model completions now expose accessor-backed magic attributes from `$appends`, legacy `getFooAttribute()` accessors, and modern `Attribute<T, ...>` accessors, including nested generic value types like `Attribute<array<string, mixed>, never>`.
- Laravel model-builder factory calls now preserve their model context. `$model->newQuery()`, `$model->newModelQuery()`, `newQueryWithoutScopes()`, `on()`, and related factory calls behave as Eloquent builders while still feeding local scopes and terminal methods back to the original model type.
- PHPDoc `@mixin` declarations now participate in the same class hierarchy pipeline as traits and parents. Completion, signature help, return inference, property/relation inference, and method navigation can use members declared on mixin classes.
- Inherited fluent methods that declare `@return static` or `@return $this` now keep the original receiver class during return inference. A child model calling a parent/mixin fluent method can continue to complete child-only members after the chain.
- PHPDoc model properties with spaced generic collection types are now preserved, and relation collection chains like `@property-read Collection<int, User> $reviewers` followed by `$model->reviewers->first()->...` infer `User` completions.
- Custom collection classes with PHPDoc `@extends` / `@implements` generic collection types now feed terminal collection inference, so `AlbumCollection extends Collection<int, Album>` followed by `$albums->first()->...` keeps `Album` completions.
- Laravel relation factory calls now return typed relation objects and propagate related model types through relation chains and assignments. Explicit related-class factories such as `$this->hasMany(Post::class)->firstOrFail()`, `$this->belongsTo($related)->first()`, and `$this->morphMany(Post::class, 'commentable')->get()->first()` infer the related model, while self-referential factories keep the declaring model type.
- Laravel dynamic relation declarations through `Model::resolveRelationUsing(...)` now expose relation properties when the callback returns a Laravel relation factory, including named arguments, static arrow callbacks, and fully-qualified model receivers.
- Laravel relation query callbacks now infer the related model builder. In `Model::query()->whereHas('tracks', function ($query) { ... })` and `fn ($query) => ...` arrow callbacks, `$query` gets Eloquent builder methods, local scopes from the `Track` model, and terminal calls like `$query->first()` resolve back to `Track`.
- Class-body trait use parsing now supports adaptation blocks like `use SoftDeletes { restore as restoreModel; }`, improving shared hierarchy lookup for completions, navigation, and contextual trait diagnostics.
- PHPDoc generic trait usage now participates in return-type inference and completion display. `@use FindsModels<Comment>` maps trait templates like `@return TModel` back to `Comment`, while template declarations no longer misread `@template-use` as a new template name.
- PHPDoc generic mixin usage now participates in return-type inference and completion display. `@mixin RepositoryMixin<Comment>` maps mixin templates like `@return TModel` back to `Comment`, so magic OOP helper methods can keep concrete model completions.
- Laravel relation targets now understand self-referential class constants. Relations like `$this->hasMany(self::class)` or `$this->hasOne(static::class)` feed the current model type into relation-property and terminal-chain completions.
- Legacy Laravel relation targets using `__CLASS__` now resolve to the declaring model too, matching projects that still use `$this->belongsTo(__CLASS__, ...)` or `$this->hasMany(__CLASS__, ...)`.
- PHPactor unresolved member-method diagnostics on Eloquent builders now reuse the semantic builder model resolver before being shown. Calls such as `Album::query()->withRelations()` are suppressed only when the inferred model really defines `scopeWithRelations`, while unknown builder magic remains visible.
- PHPactor unresolved trait property diagnostics are now reconciled through host class context, reducing false positives for trait code while preserving app-level unknown-property errors.
- PHP variable completion now understands anonymous functions, `use ($x)` captures, arrow-function implicit captures, `foreach` variables, and `catch` variables while preventing closed closure locals from leaking into the parent scope.
- Cmd+B / Go to Definition now recognizes fluent PHP method chains split across lines, so multiline Laravel chains like `Model::query()->whereNull()->firstOrFail()` can navigate from terminal calls.
- PHP smart selection can use LSP selection ranges, and stale selection range responses from a previous project tab are dropped for PHP and JS/TS providers.
- Implementation fallback detection now handles multiline abstract method declarations, so implementation gutter/fallback behavior remains available for PhpStorm-style wrapped signatures.

## Next Tasks

- Improve PHPDoc inheritance and remaining trait host-context diagnostics beyond member/property false positives without hiding app bugs.
- Add relation return inference for remaining implicit targets, especially multi-target `morphTo()` inverse relations, through-relations with intermediate generics, and polymorphic edge cases not covered by explicit related-class factories.
- Add UI smoke tests for IDE Mode on a real Laravel workspace.

## Slice: Laravel Accessor-Backed Attribute Navigation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a4350cd Add JS TS source definition navigation`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Existing WIP entering the slice:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Goal

- Finish the in-progress Laravel accessor target work by wiring accessor-backed model properties into Cmd+B / Go to Definition.

### Implementation Choice

- Reuse the new `phpLaravelModelAccessorTargetFromSource` parser as a fallback after declared model attribute source lookup.
- Preserve existing navigation preference for `$fillable`, `$casts`, `$attributes`, and `$appends` entries.
- Add a workbench preview regression proving a model property such as `$comment->full_name` opens `getFullNameAttribute()`.

### Acceptance Criteria

- Domain accessor target tests pass.
- Workbench Go to Definition opens legacy accessor methods for accessor-backed model properties.
- `npm run check` is unblocked unless another unrelated issue appears.
- `git diff --check` passes.

### Completed

- Added `phpLaravelModelAccessorTargetFromSource` to resolve legacy `getFooAttribute()` and modern `Attribute` accessor methods back to their source method positions.
- Reused the accessor target as a fallback for Laravel model property navigation after direct model attribute source lookup.
- Added workbench coverage proving `$foundComment->full_name` opens `getFullNameAttribute()` through Go to Definition.
- Kept existing `$fillable`, `$casts`, `$attributes`, and `$appends` navigation behavior intact by preserving the existing target lookup priority.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "locates Laravel accessor source attributes"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "exposes Laravel dynamic where helpers from model attributes"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/application/useWorkbenchController.preview.test.tsx -t "Laravel accessor|exposes Laravel dynamic where helpers from model attributes|locates Laravel accessor source attributes|extracts Laravel accessor"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `bfd4bc1 Navigate Laravel accessor attributes`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Slice: Conservative Multi-Target MorphTo Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bfd4bc1 Navigate Laravel accessor attributes`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Avoid misleading PhpStorm-style Laravel completions when a documented `morphTo()` relation has multiple possible target models, such as `MorphTo<Post|Video, self>`.

### Implementation Choice

- Split generic argument union members before selecting declared generic candidates.
- Keep single-target placeholder patterns such as `MorphTo<Model, User>` working.
- Treat multi-target `morphTo()` context as ambiguous and return `mixed` for the relation property instead of choosing the first target.

### Acceptance Criteria

- Existing single-target `MorphTo<Model, User>` inference remains green.
- Multi-target `MorphTo<Post|Video, self>` does not expose only `Post` completions.
- Focused PHP domain tests pass.
- `npm run check` and `git diff --check` pass.

### Completed

- Generic argument parsing now splits union members inside generic arguments before extracting declared type candidates.
- Relation return type inference now returns a concrete model only when exactly one non-placeholder model candidate exists.
- `morphTo()` context inference now treats documented multi-target relations as ambiguous instead of falling back to a single model.
- Added regression coverage for `MorphTo<Post|Video, self>` so the generated relation property returns `mixed` rather than misleadingly exposing only `Post`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "extracts Laravel relation methods as magic properties"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "infers Laravel relation model completions from property and relation chains"`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Pending commit.
- Intended included files:
  - `src/domain/phpTypeAnalysis.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`
