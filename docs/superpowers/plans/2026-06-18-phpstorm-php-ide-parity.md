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

- Committed and pushed as `4478be7 Avoid single-target morphTo inference for unions`.
- Included files:
  - `src/domain/phpTypeAnalysis.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: First-Generic Through Relation Return Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4478be7 Avoid single-target morphTo inference for unions`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer PhpStorm-style Laravel relation properties from documented through-relation return types with declaring or intermediate generics, such as `HasManyThrough<Post, User>`.

### Implementation Choice

- Keep the conservative multi-target behavior for `morphTo()` and union first generics.
- For non-`morphTo` Laravel relations, use the first generic argument as the related model when the full generic list contains additional declaring, through, or pivot model parameters.
- Reuse the existing generic argument parser instead of adding a second PHP type parser.

### Acceptance Criteria

- `HasManyThrough<Post, User>` exposes `Post` as the relation property target even when factory arguments cannot be resolved.
- `HasOneThrough<Post|Video, User>` remains `mixed` instead of selecting only `Post`.
- Focused PHP domain tests pass.
- `npm run check` and `git diff --check` pass.

### Completed

- Added relation-type normalization for reusable Laravel relation checks.
- Added first-generic target selection for non-`morphTo` Laravel relation return types with multiple generic model candidates.
- Added regression coverage for through relations where unresolved factory variables force inference to come from PHPDoc generics.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "extracts Laravel relation methods as magic properties"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `b60a690 Infer through relation generic targets`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Fluent Through Relation String Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b60a690 Infer through relation generic targets`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer Laravel `HasOneThrough` / `HasManyThrough` relation property targets from fluent relation string syntax such as `$this->through('cars')->has('owner')`.

### Implementation Choice

- Add a targeted relation-property lookup by name to avoid recursively computing every relation property while resolving `through(...)`.
- Support only literal string relation names for this slice; dynamic `throughCars()->hasOwner()` and non-literal arguments remain follow-ups.
- Resolve the intermediate relation first, then resolve the distant relation on that intermediate model using the existing relation target machinery.

### Acceptance Criteria

- `through('cars')->has('owner')` resolves through `cars` and exposes the distant `owner` model.
- Multiline `through("cars")->has("mechanics")` works.
- Non-literal `through($cars)->has('owner')` stays conservative and returns `mixed`.
- Focused PHP domain tests pass.
- `npm run check` and `git diff --check` pass.

### Completed

- Extracted Laravel relation method target resolution into a reusable helper.
- Added a guarded relation-property lookup by name for intermediate and distant relation path resolution.
- Added string-literal fluent-through parsing for `through(...)->has(...)`.
- Added regression coverage for one-to-through, many-through, multiline syntax, and a non-literal conservative fallback.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "extracts Laravel fluent through relation targets from relation strings"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `bbfb8c3 Infer fluent through relation targets`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Mixin Member-Method Diagnostic Reconciliation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bbfb8c3 Infer fluent through relation targets`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Suppress PHPactor unresolved member-method false positives when Codevo already resolves the receiver type and can prove the method through the PHP class hierarchy, including PHPDoc `@mixin` helpers.

### Implementation Choice

- Keep Laravel-specific local-scope and dynamic-where reconciliation in place.
- Add a general member-method reconciliation path mirroring the existing member-property path:
  - resolve the diagnostic receiver expression type at the diagnostic position;
  - call `phpClassHierarchyHasMethod` for the inferred class and method name;
  - add the existing `phpMemberMethodDiagnosticKey` only when the method is proven.
- Cover the `@mixin` case because completions already expose those members through the same hierarchy pipeline.

### Acceptance Criteria

- PHPactor diagnostics for a proven mixin method such as `$comment->helpful()` are suppressed.
- Unknown methods on the same receiver remain visible.
- Existing Laravel local-scope diagnostic suppression still passes.
- Full preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed

- Member-method diagnostic filtering now resolves the receiver type and checks `phpClassHierarchyHasMethod`.
- Added preview regression coverage using an inferred repository model receiver with `@mixin CommentIdeHelper`.
- Preserved unknown-method diagnostics on the same receiver.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "suppresses PHPDoc mixin member-method diagnostics on inferred receivers"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHPDoc mixin|suppresses static local-scope diagnostics only when the model defines the scope|suppresses builder local-scope diagnostics"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `ea51b39 Reconcile mixin member diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Dynamic Fluent Through Relation Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ea51b39 Reconcile mixin member diagnostics`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Extend fluent-through relation inference from literal string syntax to Laravel's dynamic syntax, such as `$this->throughCars()->hasOwner()`.

### Implementation Choice

- Reuse the existing fluent-through relation path resolver.
- Parse only documented dynamic method pairs with Studly suffixes:
  - `throughCars()` -> `cars`
  - `hasOwner()` -> `owner`
- Keep non-literal `through($cars)->has(...)` conservative.

### Acceptance Criteria

- `throughCars()->hasOwner()` resolves through `cars` and exposes the distant `owner` model.
- Multiline `throughCars()->hasMechanics()` resolves the distant collection relation target.
- Existing string-based fluent-through tests remain green.
- Focused PHP domain tests pass.
- `npm run check` and `git diff --check` pass.

### Completed

- Added dynamic fluent-through path parsing for `throughStudly()->hasStudly()`.
- Added conservative Studly-to-camel relation name normalization.
- Expanded the fluent-through regression to cover dynamic one-to-through and many-through syntax.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "extracts Laravel fluent through relation targets from relation strings and dynamic names"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `deadfd5 Infer dynamic fluent through relations`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Implemented Interface Member-Method Diagnostic Reconciliation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `deadfd5 Infer dynamic fluent through relations`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let member-method diagnostic reconciliation prove methods declared by implemented interfaces, matching the broader PHP hierarchy behavior used elsewhere in IDE Mode.

### Implementation Choice

- Reuse `phpSuperTypeReferences` inside `phpClassHierarchyHasMethod` instead of checking only `phpExtendsClassName`.
- Preserve existing trait, mixin, and parent behavior while adding `implements` and multiple interface references through the shared parser.
- Add a preview diagnostic regression where a concrete repository class implements an interface declaring the method.

### Acceptance Criteria

- A PHPactor diagnostic for a method declared only on an implemented interface is suppressed when the receiver resolves to the concrete class.
- An unknown method on the same receiver remains visible.
- Full preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed

- `phpClassHierarchyHasMethod` now walks all parsed supertypes, including implemented interfaces.
- Added preview coverage proving interface-declared methods suppress member-method false positives while unknown methods still surface.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "suppresses implemented interface member-method diagnostics on inferred receivers"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `b26c6dd Reconcile interface member diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Dynamic Fluent Through ResolveRelationUsing Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b26c6dd Reconcile interface member diagnostics`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer relation property targets from `Model::resolveRelationUsing(...)` callbacks that return Laravel fluent-through relations.

### Implementation Choice

- Reuse the fluent-through resolver added for normal relation methods.
- Treat fluent-through callbacks as valid relation callbacks alongside direct relation factory calls.
- Cover both literal `through('cars')->has('owner')` and dynamic `throughCars()->hasOwner()` callback forms.

### Acceptance Criteria

- `resolveRelationUsing('carOwner', fn (...) => $model->through('cars')->has('owner'))` exposes `carOwner` as the owner model.
- `resolveRelationUsing('carMechanics', fn (...) => $model->throughCars()->hasMechanics())` exposes the distant collection target.
- Existing dynamic relation callback tests remain green.
- Focused PHP domain tests pass.
- `npm run check` and `git diff --check` pass.

### Completed

- Dynamic relation callbacks now accept fluent-through expressions as relation factories.
- Dynamic callback target inference now calls the shared fluent-through target resolver.
- Added regression coverage for literal and dynamic fluent-through `resolveRelationUsing` callbacks.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "extracts Laravel fluent through targets from resolveRelationUsing callbacks"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `0f2a504 Infer dynamic fluent relation callbacks`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: MorphMap ResolveRelationUsing MorphTo Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0f2a504 Infer dynamic fluent relation callbacks`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let `Model::resolveRelationUsing(...)` callbacks that return `morphTo()` use the existing single-target morph map fallback.

### Implementation Choice

- Broaden the `morphTo()` guard from only `$this->morphTo()` to model-variable receivers such as `$comment->morphTo()`.
- Keep the existing conservative target selection:
  - documented multi-target `MorphTo<Post|Video, ...>` remains ambiguous;
  - morph map fallback only returns a target when the project has exactly one morph-map model.
- Add coverage through dynamic relation callbacks rather than changing relation factory inference broadly.

### Acceptance Criteria

- A `resolveRelationUsing` callback returning `$comment->morphTo()` exposes the single morph-map target.
- Existing dynamic relation callback tests remain green.
- Focused PHP domain tests pass.
- `npm run check` and `git diff --check` pass.

### Completed

- `phpLaravelMorphToTargetClassNameFromContext` now accepts variable receivers for `morphTo()` in addition to `$this`.
- Added regression coverage for `Relation::morphMap([... Post::class ...])` plus a `resolveRelationUsing` morphTo callback.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "extracts Laravel dynamic relation targets from resolveRelationUsing callbacks"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `daf7f56 Infer morph map dynamic morphTo callbacks`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Static Method Diagnostic Reconciliation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `7d3285d Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Suppress PHPactor unresolved static-method false positives when Codevo can prove the static method exists through the same member parser used for completions.

### Implementation Choice

- Add a separate static-only hierarchy proof instead of reusing the instance method helper, so `Class::instanceMethod()` diagnostics remain visible.
- Use cached `phpMethodCompletionsFromSource` members because they already expose declared static methods and PHPDoc `@method static` helpers.
- Walk traits, mixins, parents, and implemented interfaces through the existing hierarchy references.

### Acceptance Criteria

- Diagnostics for proven `public static function` and PHPDoc `@method static` calls are suppressed.
- Diagnostics for instance-only methods called statically remain visible.
- Unknown static methods remain visible.
- Full preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `phpClassHierarchyHasStaticMethod` for static-only diagnostic proof.
- Wired static diagnostics through the new helper alongside Laravel local-scope and dynamic-where reconciliation.
- Added preview coverage for declared static, PHPDoc static, instance-only, and unknown static calls.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "suppresses existing static-method diagnostics without hiding instance-only methods"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `def2ffc Reconcile static method diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Implemented Interface PHPDoc Property Diagnostic Reconciliation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `def2ffc Reconcile static method diagnostics`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Suppress PHPactor unresolved property false positives when a concrete receiver implements an interface that documents a magic property with PHPDoc.

### Implementation Choice

- Reuse `phpSuperTypeReferences` inside `phpClassHierarchyHasProperty`, matching the method hierarchy proof path.
- Keep the existing declared-property, trait, mixin, and parent behavior.
- Only suppress when the implemented interface hierarchy actually exposes the property through the cached member parser.

### Acceptance Criteria

- A PHPactor diagnostic for a property documented by an implemented interface is suppressed when the receiver resolves to the concrete class.
- Unknown properties on the same receiver remain visible.
- Full preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed

- `phpClassHierarchyHasProperty` now walks all parsed supertypes, including implemented interfaces.
- Added preview coverage for an interface-level `@property-read` and an unknown-property control on the same receiver.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "suppresses implemented interface PHPDoc property diagnostics on inferred receivers"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `15fb8ce Reconcile interface property diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Magic Method Navigation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `546fbe7 Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let Cmd+B / Go To Definition navigate to PHPDoc `@method` magic method declarations when no real PHP method body exists.

### Implementation Choice

- Keep real method navigation first, then fall back to a PHPDoc `@method` position resolver.
- Reuse the existing class hierarchy navigation path so traits, mixins, parents, interfaces, and framework-bound concretes inherit the fallback without another navigation pipeline.
- Return the cursor target at the magic method name itself, matching normal method declaration reveal behavior.

### Acceptance Criteria

- Static PHPDoc magic calls such as `CommentFactory::fromNamed()` open the declaring `@method static` line.
- Missing magic methods remain unresolved.
- Relevant parser and preview navigation tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `phpDocMethodPositionOrNull` to locate PHPDoc `@method` declarations.
- Wired direct PHP method navigation to fall back from real methods to PHPDoc magic methods while reusing the existing class hierarchy traversal.
- Added parser and workbench preview coverage for `@method static` Go To Definition.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts -t "locates PHPDoc magic method definitions"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "opens PHPDoc magic method definitions"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `fbe327b Navigate PHPDoc magic methods`.
- Included files:
  - `src/domain/phpNavigation.ts`
  - `src/domain/phpNavigation.test.ts`
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Nullsafe Member Diagnostic Reconciliation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ecee72e Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let PHPactor unresolved member-method and member-property diagnostics reconcile for nullsafe `?->` access when Codevo has already confirmed the receiver context.

### Implementation Choice

- Reuse the shared PHP member-access regex fragments so diagnostic context extraction matches the nullsafe grammar already used by completions, signature help, and semantic parsing.
- Keep suppression guarded by existing contextual method/property keys, so unknown nullsafe members remain visible.

### Acceptance Criteria

- `$query?->withRelations()` can be suppressed when semantic context confirms `withRelations`.
- `$comment?->content` can be suppressed when semantic context confirms `content`.
- Unknown nullsafe method/property diagnostics remain visible.
- Diagnostic filter tests, `npm run check`, and `git diff --check` pass.

### Completed

- Member-method diagnostic context extraction now accepts `?->` in both chain segments and the final method operator.
- Member-property diagnostic context extraction now accepts `?->` in both chain segments and the final property operator.
- Added filter coverage for confirmed nullsafe method/property diagnostics and unknown nullsafe controls.

### Verification

- PASS: `npm test -- src/domain/phpLanguageServerDiagnosticFilters.test.ts -t "nullsafe member"`
- PASS: `npm test -- src/domain/phpLanguageServerDiagnosticFilters.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `d887830 Reconcile nullsafe member diagnostics`.
- Included files:
  - `src/domain/phpLanguageServerDiagnosticFilters.ts`
  - `src/domain/phpLanguageServerDiagnosticFilters.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Nullsafe Member Navigation Contexts - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2033b7c Update JS TS isolation plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let PHP identifier context detection recognize nullsafe `?->` member methods and properties for Cmd+B / Go To Definition.

### Implementation Choice

- Reuse the same shared PHP member-access regex fragments that already power completion, signature, semantic, and diagnostic contexts.
- Keep property accesses distinct from method calls through the existing final `(` guard.

### Acceptance Criteria

- `$comment?->nullableParent` is detected as a member property access.
- `$comment?->nullableParentCall()` is detected as a method call.
- `$comment?->children?->first()` keeps the nullsafe property chain in the method receiver expression.
- Existing PHP navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed

- Method-call identifier context detection now accepts nullsafe `?->` chain segments and final operators.
- Member-property identifier context detection now accepts nullsafe `?->` chain segments and final operators.
- Added PHP navigation coverage for nullsafe property, method, and chained property-to-method contexts.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts -t "member property accesses"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `0dd9ea2 Recognize nullsafe PHP navigation contexts`.
- Included files:
  - `src/domain/phpNavigation.ts`
  - `src/domain/phpNavigation.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Magic Property Navigation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d03df7d Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let Cmd+B / Go To Definition navigate to PHPDoc `@property`, `@property-read`, and `@property-write` declarations when a receiver type proves the magic property exists.

### Implementation Choice

- Add PHP property position helpers alongside the existing PHPDoc `@method` locator.
- Prefer real declared property targets before PHPDoc property targets.
- Reuse the same property hierarchy traversal used by diagnostics and completions, including traits, mixins, parents, and implemented interfaces.
- Preserve existing Laravel relation-method and model-attribute navigation priority before falling back to PHPDoc/declaration property targets.

### Acceptance Criteria

- `$comment->externalId` on a class implementing an interface with `@property-read string $externalId` opens the interface docblock property.
- Missing properties do not navigate to the PHPDoc target.
- Real declared properties are preferred over duplicate PHPDoc property entries.
- Relevant PHP navigation and preview tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added PHPDoc and declared property position helpers in the PHP navigation domain.
- Wired member-property Go To Definition to fall back to direct property targets after relation-method and Laravel attribute targets.
- Added preview coverage for interface-level `@property-read` navigation and missing-property non-navigation.
- Added domain coverage for `@property`, `@property-read`, `@property-write`, and declared-property priority.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts -t "property definitions|declared property"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "opens PHPDoc magic property definitions"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `fa45001 Navigate PHPDoc magic properties`.
- Included files:
  - `src/domain/phpNavigation.ts`
  - `src/domain/phpNavigation.test.ts`
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Instance Method Diagnostic Reconciliation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2a77d90 Update JS TS isolation plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let phpactor unresolved instance-method diagnostics reconcile when the receiver type exposes a PHPDoc `@method` through its class, parent, interface, trait, or mixin hierarchy.

### Implementation Choice

- Reuse the cached PHP class-member reader used by completions and static-method reconciliation instead of adding a second PHPDoc parser path.
- Keep suppression case-insensitive and scoped to the already resolved receiver class hierarchy.

### Acceptance Criteria

- `$comment->publish()` is suppressed when an implemented interface declares `@method void publish()`.
- Unknown instance methods remain visible.
- Existing PHP mixin diagnostics still pass.
- Focused preview tests, `npm run check`, and `git diff --check` pass.

### Completed

- Instance method hierarchy checks now reuse cached PHP class members, so PHPDoc `@method` declarations participate in diagnostic reconciliation.
- Suppression remains scoped to non-static method members and excludes PHPDoc properties.
- Added preview coverage for implemented-interface PHPDoc instance methods while keeping unknown method diagnostics visible.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHPDoc method diagnostics|PHPDoc mixin member-method|existing static-method diagnostics"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `986a69b Reconcile PHPDoc instance method diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Interface Method Navigation - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e7dc06c Update JS TS isolation plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let Cmd+B / Go To Definition navigate from instance calls to PHPDoc `@method` declarations inherited through implemented interfaces.

### Implementation Choice

- Reuse `phpSuperTypeReferences` in direct method navigation, matching property navigation and diagnostic reconciliation.
- Keep real method targets preferred before PHPDoc targets and preserve trait/mixin traversal.

### Acceptance Criteria

- `$comment->publish()` on a class implementing an interface with `@method void publish()` opens the interface docblock method.
- Missing instance methods remain unresolved.
- Existing static PHPDoc magic method navigation still passes.
- Relevant preview tests, `npm run check`, and `git diff --check` pass.

### Completed

- Direct PHP method navigation now walks all parsed supertypes, so implemented interfaces participate alongside parents.
- Existing real-method and PHPDoc method target priority is preserved inside each visited type.
- Added preview coverage for interface-level PHPDoc `@method` navigation and missing-method non-navigation.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHPDoc magic method definitions|PHPDoc magic property definitions"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `69e13fb Navigate PHPDoc interface methods`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Interface Method Completions - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3385a41 Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Offer instance method completions from PHPDoc `@method` declarations inherited through implemented interfaces.

### Implementation Choice

- Reuse `phpSuperTypeReferences` in `collectPhpMethodsForClass`, matching direct method navigation, property navigation, and diagnostics.
- Keep trait/mixin traversal and template substitution behavior unchanged.

### Acceptance Criteria

- `$comment->pub` suggests `publish()` when `Comment implements PublishesComments` and the interface declares `@method void publish()`.
- Parent-class method completions still work through the same traversal.
- Existing PHPDoc mixin completions still pass.
- Relevant preview tests, `npm run check`, and `git diff --check` pass.

### Completed

- Method completion collection now walks parsed supertypes, so implemented interfaces can contribute PHPDoc `@method` members.
- Trait and mixin collection remains unchanged, and inherited template substitution continues through the same helper.
- Added preview coverage for interface-level PHPDoc method completions on inferred receivers.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "interface PHPDoc method completions|PHPDoc mixin members"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `616543b Complete PHPDoc interface methods`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Interface Method Return Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `23daf42 Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer chained return types from PHPDoc `@method` declarations inherited through implemented interfaces.

### Implementation Choice

- Reuse `phpSuperTypeReferences` in `resolvePhpMethodReturnType`, matching completions, diagnostics, and direct navigation.
- Preserve trait/mixin traversal, inherited template substitution, and late-static handling.

### Acceptance Criteria

- `$comment->publisher()->pub` suggests `publishNow()` when `publisher()` is declared as interface PHPDoc `@method CommentPublisher publisher()`.
- Existing generic repository interface, trait, and mixin return inference tests still pass.
- Relevant preview tests, `npm run check`, and `git diff --check` pass.

### Completed

- Method return inference now walks parsed supertypes, so implemented-interface PHPDoc `@method` returns can drive chained completions.
- Existing trait, mixin, generic inheritance, and late-static paths remain on the same resolver.
- Added preview coverage for chaining from an interface PHPDoc method return into the returned class.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "interface PHPDoc method returns|generic repository interface method returns|generic trait method returns|generic mixin method returns"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `792a004 Infer PHPDoc interface method returns`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: PHPDoc Interface Property Type Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `14e881f Update PHP parity plan status`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer chained property types from PHPDoc `@property` declarations inherited through implemented interfaces.

### Implementation Choice

- Reuse `phpSuperTypeReferences` in `resolvePhpClassPropertyOrRelationType`, matching property diagnostics, property navigation, and method return inference.
- Preserve relation-method, trait, mixin, and collection-property handling.

### Acceptance Criteria

- `$comment->publisher->pub` suggests `publishNow()` when `publisher` is declared as interface PHPDoc `@property-read CommentPublisher $publisher`.
- Existing interface PHPDoc property diagnostics/navigation behavior remains intact.
- Relevant preview tests, `npm run check`, and `git diff --check` pass.

### Completed

- Property/relation type inference now walks parsed supertypes, so implemented-interface PHPDoc properties can drive chained completions.
- Existing relation-method, trait, mixin, and collection-property handling remains intact.
- Added preview coverage for chaining from an interface PHPDoc property type into the returned class.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "interface PHPDoc property types|interface PHPDoc method returns|PHPDoc magic property definitions"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `3939269 Infer PHPDoc interface property types`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Laravel Relation withDefault Chain Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `175a8274 Guard JS TS navigation during tab switches`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Preserve related model inference through common Laravel relation defaults such as `belongsTo(Post::class)->withDefault()->first()`.

### Implementation Choice

- Treat `withDefault()` as a relation-preserving fluent method, matching Laravel's relation API rather than falling back to the generic builder method list.
- Add low-level return-type coverage and semantic assignment-chain coverage.

### Acceptance Criteria

- `withDefault()` on `BelongsTo<Post>` returns the same relation type.
- `belongsTo(Post::class)->withDefault()->first()` infers `Post` for chained member completions.
- Existing Laravel relation factory chain inference remains unchanged.
- Focused domain tests, semantic engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `withDefault()` to the Laravel relation-preserving fluent method set.
- Added return-type coverage proving `BelongsTo<Post>::withDefault()` keeps the same relation type.
- Added semantic-chain coverage proving `belongsTo(Post::class)->withDefault()->first()` infers `Post`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel relation factory and relation chain return types"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel relation factory chains to related model assignments"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `6a512c7a Infer Laravel relation defaults`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `src/domain/phpSemanticEngine.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Slice: Laravel Soft-Deleting Relation Fluent Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6a512c7a Infer Laravel relation defaults`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Preserve relation type through soft-delete relation fluents before additional relation-only calls, such as `belongsTo(Post::class)->withTrashed()->withDefault()->first()`.

### Implementation Choice

- Treat `withTrashed()`, `withoutTrashed()`, and `onlyTrashed()` as relation-preserving fluent calls when the receiver is an Eloquent relation.
- Keep the existing builder behavior unchanged for builder receivers.

### Acceptance Criteria

- `withTrashed()`, `withoutTrashed()`, and `onlyTrashed()` on `BelongsTo<Post>` keep the `BelongsTo<Post>` relation type.
- `belongsTo(Post::class)->withTrashed()->withDefault()->first()` infers `Post`.
- Existing Laravel relation factory chain inference remains unchanged.
- Focused domain tests, semantic engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added soft-delete relation fluent methods to the relation-preserving path.
- Added return-type coverage proving `withTrashed()`, `withoutTrashed()`, and `onlyTrashed()` keep `BelongsTo<Post>`.
- Added semantic-chain coverage proving `withTrashed()->withDefault()->first()` still infers `Post`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel relation factory and relation chain return types"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel relation factory chains to related model assignments"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `3361fe52 Preserve Laravel soft delete relation chains`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `src/domain/phpSemanticEngine.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Laravel Morph Query Builder Fluents - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3361fe52 Preserve Laravel soft delete relation chains`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel morph-query builder methods as first-class builder-preserving fluents so chains like `Album::query()->whereHasMorph(...)->first()` keep model-aware inference.

### Implementation Choice

- Add common morph-query methods to both static and instance Eloquent builder fluent sets.
- Cover explicit method classification, direct return-type inference, and a semantic assignment chain.

### Acceptance Criteria

- `whereHasMorph`, `orWhereHasMorph`, `whereMorphedTo`, `whereNotMorphedTo`, `whereMorphRelation`, and `doesntHaveMorph` preserve `Builder<Model>`.
- `Album::query()->whereHasMorph(...)->first()` infers `Album`.
- Existing Eloquent builder and Laravel relation-chain inference remains unchanged.
- Focused domain tests, semantic engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added common Laravel morph-query methods to Eloquent builder fluent recognition.
- Added explicit classification and return-type coverage for morph-query builder methods.
- Added semantic-chain coverage proving `whereHasMorph(...)->first()` keeps the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes as model-specific|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `a1c72e38 Recognize Laravel morph query fluents`.
- Included files:
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
  - `src/domain/phpSemanticEngine.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Laravel Singleton Route Name Extraction - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a1c72e38 Recognize Laravel morph query fluents`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include Laravel singleton resource route names in route-name completion/navigation, matching Laravel's generated `show`, `edit`, `update` names and API singleton `show`, `update` names.

### Implementation Choice

- Extend the existing literal resource route expansion table with `singleton` and `apiSingleton` defaults.
- Preserve existing group prefix and nested dot-name behavior.
- Leave `creatable()` / `destroyable()` singleton modifiers as a follow-up instead of over-parsing chain options in this slice.

### Acceptance Criteria

- `Route::singleton('profile', ...)` contributes `profile.show`, `profile.edit`, and `profile.update`.
- `Route::apiSingleton('api.profile', ...)` contributes `api.profile.show` and `api.profile.update`.
- Name-group-prefixed nested singleton resources keep their full dotted names.
- Focused route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added singleton and API singleton action expansion to Laravel named route extraction.
- Preserved route name-group prefixes and nested dotted resource names while expanding singleton defaults.
- Added route extractor coverage for standard singleton, API singleton, and nested/group-prefixed singleton routes.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "expands literal Laravel singleton route names"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `11d39a56 Expand Laravel singleton route names`.
- Included files:
  - `src/domain/phpLaravelRoutes.ts`
  - `src/domain/phpLaravelRoutes.test.ts`
  - `docs/superpowers/plans/2026-06-18-phpstorm-php-ide-parity.md`

## Slice: Laravel Singleton Route Modifier Names - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ea9c327d Record Laravel singleton route commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include Laravel singleton route names added by `creatable()` and `destroyable()` modifiers in route-name completion/navigation.

### Implementation Choice

- Inspect the route chain between the resource call and statement end only for singleton resource methods.
- Treat `creatable()` as adding create/store plus destroy for web singletons and store plus destroy for API singletons, matching Laravel documentation.
- Treat `destroyable()` as adding only destroy to the default singleton action set.

### Acceptance Criteria

- `Route::singleton(...)->creatable()` contributes `create`, `store`, default singleton actions, and `destroy`.
- `Route::singleton(...)->destroyable()` contributes default singleton actions plus `destroy`.
- `Route::apiSingleton(...)->creatable()` contributes `store`, `show`, `update`, and `destroy`.
- Comments containing modifier-looking text do not change the extracted route names.
- Focused route tests, full route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added singleton route chain modifier detection from the resource call through statement end.
- Expanded `creatable()` and `destroyable()` singleton actions for web and API singleton routes.
- Added route extraction coverage for creatable, destroyable, API singleton modifier, and comment false-positive cases.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "expands Laravel singleton route name modifiers"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `b1f7b415 Expand Laravel singleton route modifiers`.

## Slice: Laravel Resource Array Route Names - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ddfec9ee Record Laravel singleton modifier commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include Laravel route names declared through bulk resource registration methods such as `Route::resources([...])` and `Route::apiResources([...])`.

### Implementation Choice

- Add a conservative first-argument array parser that extracts top-level string keys before `=>`.
- Reuse the existing resource action lists for `resources`, `apiResources`, and `softDeletableResources`.
- Preserve group name prefixes and dotted resource names while ignoring nested controller-array strings.

### Acceptance Criteria

- `Route::resources(['photos' => ...])` contributes full resource route names.
- `Route::apiResources(['api.photos' => ...])` contributes API resource route names without `create` / `edit`.
- `Route::softDeletableResources([...])` contributes full resource route names.
- Name-group-prefixed resource arrays keep the full prefixed route names.
- Focused route tests, full route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added bulk Laravel resource route action expansion for `resources`, `apiResources`, and `softDeletableResources`.
- Added a top-level string-key parser for first-argument resource arrays.
- Preserved group prefixes and nested dotted names while ignoring nested controller-array string values.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "expands literal Laravel resource array route names"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `c3f51dae Expand Laravel resource array route names`.

## Slice: Laravel Partial Resource Route Names - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c15fc379 Record Laravel resource array route commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Avoid suggesting Laravel resource route names excluded by `only()` or `except()` partial resource definitions.

### Implementation Choice

- Parse literal action lists from `only([...])`, `except([...])`, and simple string-argument variants such as `only('index', 'store')`.
- Apply filters after the default resource action set is determined, preserving action order.
- Keep dynamic filter arguments ignored so extraction stays conservative.

### Acceptance Criteria

- `Route::resource(...)->only(['index', 'show'])` contributes only `index` and `show`.
- `Route::resource(...)->except(['create', 'edit', 'destroy'])` omits those route names.
- `Route::apiResource(...)->except(['destroy'])` omits API destroy while preserving API action defaults.
- Focused route tests, full route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added literal `only()` / `except()` route action filtering for single resource route extraction.
- Supported array action lists and simple string-argument variants while preserving default action order.
- Added route extractor coverage for web resource `only`, web resource `except`, API resource `except`, and string-argument `only`.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "filters literal Laravel resource route names with only and except"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `9aae14f5 Filter Laravel partial resource routes`.

## Slice: Laravel Resource Route Name Overrides - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6bf57531 Record Laravel partial resource route commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Use Laravel `->names([...])` resource route overrides in named route completion/navigation instead of always suggesting default `resource.action` names.

### Implementation Choice

- Parse literal string-to-string entries from resource `names([...])` chain calls.
- Preserve default route names for actions without an override.
- Keep override positions on the override value literal so Cmd+B opens the custom name source.

### Acceptance Criteria

- `Route::resource(...)->names(['create' => 'photos.build'])` contributes `photos.build` instead of `photos.create`.
- `names([...])` works after `only([...])`, ignoring overrides for filtered-out actions.
- Group-prefixed singleton resource name overrides keep the group prefix.
- Focused route tests, full route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added literal `names([...])` override parsing for resource route extraction.
- Used override route name literals and positions per action while preserving defaults for non-overridden actions.
- Added route extractor coverage for resource overrides, filtered API resource overrides, and group-prefixed singleton overrides.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "uses literal Laravel resource route name overrides"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `b9b27d43 Use Laravel resource route name overrides`.

## Slice: Laravel Chained Route Group Name Prefixes - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0e4f969d Record Laravel resource route override commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel route name group prefixes when `name(...)` / `as(...)` appears inside a fluent group chain such as `Route::middleware(...)->name('admin.')->group(...)`.

### Implementation Choice

- Scan full `Route::...(...)->...->group(...)` statements instead of only direct `Route::name(...)->group(...)` calls.
- Collect direct and chained `name(...)` / `as(...)` prefix literals before the group call.
- Reuse the existing group body tracking and nested-prefix join behavior.

### Acceptance Criteria

- `Route::middleware(...)->name('admin.')->group(...)` prefixes child route names.
- `Route::prefix(...)->as('reports.')->group(...)` prefixes child resource route names.
- Nested direct and chained group prefixes compose in declaration order.
- Focused route tests, full route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Reworked Laravel route group prefix extraction to scan full `Route::...->group(...)` chains.
- Added direct and chained `name(...)` / `as(...)` prefix literal collection before the group call.
- Added route extractor coverage for chained middleware/name groups, `as(...)` groups, and nested direct/chained prefixes.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "combines chained Laravel route name group prefixes"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `8165f3a8 Detect chained Laravel route name groups`.

## Slice: Laravel Array Route Group Name Prefixes - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `34660ae9 Record Laravel route group commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize legacy/common Laravel array route group name prefixes such as `Route::group(['as' => 'admin.'], function () { ... })`.

### Implementation Choice

- Add a direct `Route::group(...)` branch to the route group extractor.
- Reuse the existing literal string map parser to read first-argument `as` entries.
- Preserve nested group prefix composition with fluent group prefixes.

### Acceptance Criteria

- `Route::group(['as' => 'admin.'], ...)` prefixes child named routes.
- Nested array route groups compose their `as` prefixes.
- Resource route names inside array groups receive the composed prefix.
- Focused route tests, full route tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added direct `Route::group(...)` handling to Laravel route group prefix extraction.
- Reused literal string map parsing for first-argument `as` group attributes.
- Added route extractor coverage for simple and nested array group name prefixes with resource routes.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts -t "combines array Laravel route group name prefixes"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `f7d94887 Detect array Laravel route name groups`.

## Slice: Laravel WithWhereHas Builder Fluent - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3e840f88 Record Laravel array route group commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel `withWhereHas` as a builder-preserving Eloquent fluent so chains keep model-aware inference.

### Implementation Choice

- Add `withWhereHas` to both static model builder methods and instance Eloquent builder fluent methods.
- Reuse the existing callback-context support already present in the semantic engine.
- Add semantic chain coverage proving `withWhereHas(...)->first()` resolves back to the model type.

### Acceptance Criteria

- `withWhereHas` is classified as a Laravel Eloquent builder method.
- Direct method return inference preserves `Builder<Model>`.
- `Album::query()->withWhereHas(...)->first()` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `withWhereHas` to Laravel static and instance Eloquent builder fluent recognition.
- Added method classification and return-type coverage for `withWhereHas`.
- Added semantic-chain coverage proving `Album::query()->withWhereHas(...)->first()` resolves to `Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes as model-specific|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `307d6a8f Preserve Laravel withWhereHas builder chains`.

## Slice: Balanced PHP Method Chain Calls - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `978a624e Record Laravel withWhereHas commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let PHP assignment and receiver inference keep walking fluent method chains when an earlier call contains nested parentheses, such as Laravel callbacks inside `withWhereHas(...)`.

### Implementation Choice

- Replace the regex-only `phpMethodCallExpression` extraction with a small balanced scanner for top-level member method calls.
- Reuse the existing `matchingPairOffset` helper for parentheses, arrays, and blocks.
- Keep property access parsing unchanged for this slice.

### Acceptance Criteria

- `phpMethodCallExpression` identifies the final method call after a callback argument containing nested method calls.
- `Album::query()->withWhereHas(...callback...)->first()` infers `Album` instead of stopping at `Builder<Album>`.
- Existing method-call expression cases remain unchanged.
- Focused semantic tests, full semantic tests, `npm run check`, and `git diff --check` pass.

### Completed

- Replaced regex-only method call extraction with a balanced top-level method chain scanner.
- Preserved existing method-call expression behavior while supporting callback arguments with nested method calls.
- Restored real callback-chain coverage for `withWhereHas(... fn ($query) => $query->where(...))->first()` inference.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "detects method and static call expressions|resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "detects member access completion after multiline fluent calls|detects multiline fluent method signature contexts"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts src/domain/phpMethodCompletions.test.ts src/domain/phpNavigation.test.ts src/domain/phpLanguageServerDiagnosticFilters.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `d5b00a53 Parse balanced PHP method chains`.

## Slice: Laravel Aggregate Builder Fluents - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `68a90e33 Record balanced PHP method chain commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel aggregate eager-load helpers as builder-preserving Eloquent fluents so chains like `withSum(...)->first()` keep model-aware inference.

### Implementation Choice

- Add `withAggregate`, `withAvg`, `withMax`, `withMin`, and `withSum` to static and instance Eloquent builder method sets.
- Keep existing `withCount` and `withExists` behavior unchanged.
- Add semantic-chain coverage for an aggregate helper followed by a terminal model method.

### Acceptance Criteria

- Aggregate helpers are classified as Laravel Eloquent builder methods.
- Direct method return inference preserves `Builder<Model>`.
- `Album::query()->withSum(...)->first()` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added Laravel aggregate eager-load helpers to static and instance Eloquent builder fluent recognition.
- Added method classification and return-type coverage for aggregate builder helpers.
- Added semantic-chain coverage proving `withSum(...)->first()` resolves to the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes as model-specific|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `91bfb93a Preserve Laravel aggregate builder chains`.

## Slice: Laravel Lazy Aggregate Model Fluents - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d66744fb Record Laravel aggregate builder commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel lazy aggregate loaders such as `loadSum` and `loadMorphAvg` as model-preserving fluents.

### Implementation Choice

- Add model-side aggregate eager loading methods from Laravel 13 API docs to the existing Eloquent model fluent set.
- Keep builder aggregate helpers separate from model lazy loaders.
- Add semantic-chain coverage for `first()->loadSum(...)`.

### Acceptance Criteria

- `loadAggregate`, `loadAvg`, `loadExists`, `loadMax`, `loadMin`, and `loadSum` preserve the model type.
- `loadMorphAggregate`, `loadMorphAvg`, `loadMorphCount`, `loadMorphMax`, `loadMorphMin`, and `loadMorphSum` preserve the model type.
- `Album::query()->first()->loadSum(...)` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added Laravel model-side aggregate eager loading methods to model fluent recognition.
- Let model receiver calls return the model type before falling back to static builder-style inference.
- Added return-type coverage for lazy aggregate loaders and semantic-chain coverage for `first()->loadSum(...)`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `6007e6b2 Preserve Laravel lazy aggregate model chains`.

## Slice: Laravel Collection Lazy Aggregate Fluents - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `fda4b316 Record Laravel lazy aggregate commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel Eloquent Collection lazy loaders such as `loadSum` as collection-preserving fluents so terminal calls like `first()` keep model-aware inference.

### Implementation Choice

- Add Eloquent Collection `load*` methods documented in the Laravel 13 API to the collection fluent set.
- Keep model-only `loadMorph*` aggregate variants scoped to model fluent handling.
- Add semantic-chain coverage for `get()->loadSum(...)->first()`.

### Acceptance Criteria

- Eloquent Collection `load`, `loadAggregate`, `loadAvg`, `loadCount`, `loadExists`, `loadMax`, `loadMin`, `loadMissing`, `loadMorph`, `loadMorphCount`, and `loadSum` preserve `Collection<int, Model>`.
- `Album::query()->get()->loadSum(...)->first()` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added Laravel Eloquent Collection lazy loader methods to collection fluent recognition.
- Added return-type coverage proving collection `load*` calls preserve `Collection<int, Model>`.
- Added semantic-chain coverage proving `get()->loadSum(...)->first()` resolves to the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `8847fad1 Preserve Laravel collection lazy loaders`.

## Slice: Laravel FindOr Terminal Model Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `faba5c9a Record Laravel collection lazy loader commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel `findOr(...)` as a terminal model-returning Eloquent builder method, matching `firstOr(...)` behavior.

### Implementation Choice

- Add `findOr` to the Eloquent builder terminal model method set.
- Reuse existing static model and builder return inference paths.
- Add semantic assignment coverage for `Album::query()->findOr(...)`.

### Acceptance Criteria

- `findOr` is classified as a Laravel Eloquent terminal model method.
- `Album::findOr(...)` infers `Album`.
- `Album::query()->findOr(...)` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `findOr` to Eloquent builder terminal model method recognition.
- Added method classification and direct static model return-type coverage.
- Added semantic-chain coverage proving `Album::query()->findOr(...)` resolves to `Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "common Eloquent finder|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `cde57cad Infer Laravel findOr model results`.

## Slice: Laravel FindMany Collection Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `fedd7848 Record Laravel findOr commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel `findMany(...)` as an Eloquent collection-returning builder method.

### Implementation Choice

- Add `findMany` to the Eloquent builder collection method set.
- Reuse existing `Collection<int, Model>` return inference and collection terminal inference.
- Add semantic-chain coverage for `findMany(...)->first()`.

### Acceptance Criteria

- `Album::findMany([...])` infers `Collection<int, Album>`.
- `Album::query()->findMany([...])->first()` infers `Album`.
- Existing finder terminal model inference remains unchanged.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `findMany` to Eloquent builder collection method recognition.
- Added direct static model return-type coverage for `Album::findMany([...])`.
- Added semantic-chain coverage proving `Album::query()->findMany([...])->first()` resolves to `Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `f30cef71 Infer Laravel findMany collections`.

## Slice: Laravel FindOrNew Terminal Model Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ffbbbbd4 Record Laravel findMany commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel `findOrNew(...)` as a terminal model-returning Eloquent builder method.

### Implementation Choice

- Add `findOrNew` to the Eloquent builder terminal model method set.
- Reuse existing static model and builder return inference paths.
- Add semantic assignment coverage for `Album::query()->findOrNew(...)`.

### Acceptance Criteria

- `findOrNew` is classified as a Laravel Eloquent terminal model method.
- `Album::findOrNew(...)` infers `Album`.
- `Album::query()->findOrNew(...)` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `findOrNew` to Eloquent builder terminal model method recognition.
- Added method classification and direct static model return-type coverage.
- Added semantic-chain coverage proving `Album::query()->findOrNew(...)` resolves to `Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "common Eloquent finder|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `7f5c9899 Infer Laravel findOrNew model results`.

## Slice: Laravel Lazy Builder Collection Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `97729317 Record Laravel findOrNew commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel builder lazy retrieval methods as `LazyCollection<int, Model>` producers.

### Implementation Choice

- Add `lazy`, `lazyById`, `lazyByIdDesc`, and `orderedLazyById` to Eloquent builder collection-returning methods.
- Split lazy collection return-type formatting from regular Eloquent Collection return-type formatting.
- Add semantic-chain coverage for `lazyById()->first()`.

### Acceptance Criteria

- Builder lazy retrieval methods infer `Illuminate\Support\LazyCollection<int, Model>`.
- `Album::query()->lazyById()->first()` infers `Album`.
- Existing `cursor()` lazy collection behavior remains unchanged.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added Laravel builder lazy retrieval methods to collection-returning method recognition.
- Split lazy collection return formatting from regular Eloquent collection formatting.
- Added return-type coverage for lazy builder methods and semantic-chain coverage for `lazyById()->first()`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent collection chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `7cf950ba Infer Laravel lazy builder collections`.

## Slice: Laravel Hydrate FromQuery Collection Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1d9238a1 Record Laravel lazy builder commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel `hydrate(...)` and `fromQuery(...)` as Eloquent collection-returning methods.

### Implementation Choice

- Add `hydrate` and `fromQuery` to the Eloquent builder collection-returning method set.
- Reuse existing `Collection<int, Model>` return formatting and collection terminal inference.
- Add semantic-chain coverage for `hydrate(...)->first()`.

### Acceptance Criteria

- `Album::hydrate(...)` and `Album::fromQuery(...)` infer `Collection<int, Album>`.
- `Album::hydrate(...)->first()` infers `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `hydrate` and `fromQuery` to Eloquent builder collection method recognition.
- Added direct static model return-type coverage for `Album::hydrate(...)` and `Album::fromQuery(...)`.
- Added semantic-chain coverage proving `Album::hydrate(...)->first()` resolves to `Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent collection chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `b7fa1a89 Infer Laravel hydrate collection results`.

## Slice: Laravel Scalar Value Terminal Boundary - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2333639c Record Laravel hydrate collection commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Eloquent scalar retrieval helpers `value(...)`, `soleValue(...)`, and `valueOrFail(...)` as known builder methods without allowing them to preserve builder/model inference.

### Implementation Choice

- Add the scalar retrieval helpers to Laravel Eloquent static and fluent builder method sets so completions and known-method checks recognize them.
- Also add them to the non-model terminal set so scope/macro fallback stops after these calls.
- Add semantic coverage proving a chain after a scalar retrieval helper does not infer the model type.

### Acceptance Criteria

- `value`, `soleValue`, and `valueOrFail` are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers stays `null` rather than `Builder<Model>`.
- `Album::query()->value(...)->first()` and related scalar chains do not infer `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `value`, `soleValue`, and `valueOrFail` to known Eloquent static/fluent builder method recognition.
- Added the same helpers to the non-model terminal set so builder scope/macro fallback stops at scalar retrieval calls.
- Added direct return-type coverage and semantic negative coverage proving scalar retrieval chains do not infer the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `2f82fff0 Stop Laravel scalar value builder leaks`.

## Slice: Laravel Mutation Terminal Boundary - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c4404e0c Record Laravel scalar value commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Eloquent mutation helpers such as `update(...)`, `delete(...)`, and `increment(...)` as known builder methods without preserving builder/model inference after their non-model results.

### Implementation Choice

- Add mutation helpers to Laravel Eloquent static and fluent builder method recognition.
- Add the same helpers to the non-model terminal set so scope/macro fallback stops after mutation calls.
- Add semantic negative coverage proving common mutation chains do not infer the model type.

### Acceptance Criteria

- `delete`, `decrement`, `decrementEach`, `increment`, `incrementEach`, `touch`, `update`, and `upsert` are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers stays `null` rather than `Builder<Model>`.
- `Album::query()->update(...)->first()` and related mutation chains do not infer `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added mutation helpers to known Eloquent static/fluent builder method recognition.
- Added the same helpers to the non-model terminal set so builder scope/macro fallback stops at mutation calls.
- Added direct return-type coverage and semantic negative coverage proving mutation chains do not infer the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `a1fe0eeb Stop Laravel mutation builder leaks`.

## Slice: Laravel Chunk Pagination Terminal Boundary - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `42f6cb66 Record Laravel mutation terminal commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Eloquent chunking and cursor pagination helpers as known builder methods without preserving builder/model inference after their non-builder results.

### Implementation Choice

- Add chunking helpers and cursor pagination helpers to Laravel Eloquent static/fluent builder method recognition.
- Add the same helpers to the non-model terminal set so scope/macro fallback stops after these calls.
- Add semantic negative coverage proving representative chunk and cursor pagination chains do not infer the model type.

### Acceptance Criteria

- `chunkById`, `chunkByIdDesc`, `chunkMap`, `each`, `eachById`, `orderedChunkById`, `cursorPaginate`, and `paginateUsingCursor` are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers stays `null` rather than `Builder<Model>`.
- `Album::query()->chunkById(...)->first()` and `Album::query()->cursorPaginate(...)->first()` do not infer `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added chunking and cursor pagination helpers to known Eloquent static/fluent builder method recognition.
- Added the same helpers to the non-model terminal set so builder scope/macro fallback stops at chunking and pagination calls.
- Added direct return-type coverage and semantic negative coverage proving representative chunk and cursor pagination chains do not infer the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `621cae68 Stop Laravel chunk pagination builder leaks`.

## Slice: Laravel Builder Escape Terminal Boundary - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d20441b5 Record Laravel chunk pagination commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Eloquent builder escape helpers such as `getModels()`, `eagerLoadRelations()`, `getQuery()`, and `toBase()` as known methods without preserving Eloquent builder/model inference after their array or base-query results.

### Implementation Choice

- Add these helpers to Laravel Eloquent static/fluent builder method recognition.
- Add the same helpers to the non-model terminal set so scope/macro fallback stops after array/base-query escape calls.
- Add semantic negative coverage proving representative escape chains do not infer the model type.

### Acceptance Criteria

- `getModels`, `eagerLoadRelations`, `getQuery`, and `toBase` are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers stays `null` rather than `Builder<Model>`.
- `Album::query()->getModels()->first()` and `Album::query()->toBase()->first()` do not infer `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added array/base-query escape helpers to known Eloquent static/fluent builder method recognition.
- Added the same helpers to the non-model terminal set so builder scope/macro fallback stops at escape calls.
- Added direct return-type coverage and semantic negative coverage proving representative escape chains do not infer the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `b39c3ab8 Stop Laravel builder escape leaks`.

## Slice: Laravel Additional Model Terminal Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b606c6b4 Record Laravel builder escape commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer additional Eloquent methods that return the current model type, including creation helpers, `findSole(...)`, `incrementOrCreate(...)`, and builder model factory helpers.

### Implementation Choice

- Add the missing helpers to the Eloquent terminal-model method set.
- Reuse the existing `TModel` return formatting for static model and builder receivers.
- Add semantic assignment coverage for representative finder, create-or-first, increment-or-create, and model factory helpers.

### Acceptance Criteria

- `findSole`, `createOrFirst`, `createQuietly`, `forceCreate`, `forceCreateQuietly`, `incrementOrCreate`, `getModel`, `make`, and `newModelInstance` are recognized as terminal model methods.
- Direct return inference for these helpers resolves to the current model type.
- Representative assignment chains infer `App\Models\Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added the missing Eloquent model-returning helpers to terminal-model method recognition.
- Added direct return-type coverage proving the helpers resolve to the current model type from builder receivers.
- Added semantic assignment coverage proving representative finder, create-or-first, increment-or-create, and model factory helpers infer `App\Models\Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "common Eloquent finder|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `fba5d9f0 Infer additional Laravel model terminals`.

## Slice: Laravel Fluent Builder Helper Recognition - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `76278297 Record Laravel model terminal commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize additional Eloquent fluent builder helpers for scopes, eager-load configuration, query casts, cloning, and after-query hooks while preserving the current model-aware builder type.

### Implementation Choice

- Add the missing fluent helpers to Laravel Eloquent static/fluent builder method recognition.
- Reuse existing builder-preserving return inference for known fluent methods.
- Add semantic coverage proving representative eager and scope helper chains still infer the model after `first()`.

### Acceptance Criteria

- Helpers such as `applyScopes`, `scopes`, `withOnly`, `withAttributes`, `withCasts`, `withoutGlobalScopes`, `setQuery`, `setEagerLoads`, `clone`, and `onClone` are recognized as Laravel Eloquent builder methods.
- Direct return inference for these helpers resolves to `Builder<Model>`.
- Representative eager/scope helper chains infer `App\Models\Album` after `first()`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added scope, eager-load, cast, clone, query setter, and after-query helpers to known Eloquent static/fluent builder method recognition.
- Added direct return-type coverage proving the helpers preserve `Builder<App\Models\Album>`.
- Added semantic assignment coverage proving representative eager/scope helper chains infer `App\Models\Album` after `first()`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `c858c813 Recognize Laravel fluent builder helpers`.

## Slice: Laravel Introspection Terminal Boundary - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4d8f5fcd Record Laravel fluent helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Eloquent introspection/accessor helpers such as `hasMacro(...)`, `getEagerLoads()`, `qualifyColumn(...)`, and `getRelation(...)` without preserving Eloquent builder/model inference after their non-builder results.

### Implementation Choice

- Add macro, eager-load getter, relation getter, limit/offset getter, column qualification, named-scope check, and callback helpers to Laravel Eloquent method recognition.
- Add the same helpers to the non-model terminal set so scope/macro fallback stops after these calls.
- Add semantic negative coverage proving representative introspection chains do not infer the model type.

### Acceptance Criteria

- Non-model introspection/accessor helpers are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers stays `null` rather than `Builder<Model>`.
- `Album::query()->qualifyColumn(...)->first()` and `Album::query()->getRelation(...)->first()` do not infer `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added macro, eager-load getter, relation getter, limit/offset getter, column qualification, named-scope check, and callback helpers to known Eloquent method recognition.
- Added the same helpers to the non-model terminal set so builder scope/macro fallback stops at introspection/accessor calls.
- Added direct return-type coverage and semantic negative coverage proving representative introspection chains do not infer the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `78ef4671 Stop Laravel introspection builder leaks`.

## Slice: Laravel Fill Insert Terminal Boundary - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2103f33c Record Laravel introspection terminal commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel 13 Eloquent `fillAndInsert*` helpers without preserving Eloquent builder/model inference after their bool, int, or array results.

### Implementation Choice

- Add `fillAndInsert`, `fillAndInsertOrIgnore`, `fillAndInsertGetId`, and `fillForInsert` to Laravel Eloquent method recognition.
- Add the same helpers to the non-model terminal set so scope/macro fallback stops after these calls.
- Add semantic negative coverage proving a representative fill-insert chain does not infer the model type.

### Acceptance Criteria

- `fillAndInsert`, `fillAndInsertOrIgnore`, `fillAndInsertGetId`, and `fillForInsert` are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers stays `null` rather than `Builder<Model>`.
- `Album::query()->fillAndInsertGetId(...)->first()` does not infer `Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added Laravel 13 `fillAndInsert*` helpers to known Eloquent method recognition.
- Added the same helpers to the non-model terminal set so builder scope/macro fallback stops at fill-insert calls.
- Added direct return-type coverage and semantic negative coverage proving representative fill-insert chains do not infer the model type.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `3e537fd6 Stop Laravel fill insert builder leaks`.

## Slice: Laravel Relation Helper Recognition - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `aee1600e Record Laravel fill insert commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize additional Laravel 13 relation query helpers such as `whereAttachedTo(...)` and `whereDoesntHaveRelation(...)` while preserving model-aware builder inference.

### Implementation Choice

- Add the missing relation helper names to Laravel Eloquent static/fluent builder method recognition.
- Reuse existing builder-preserving return inference for known fluent methods.
- Add semantic coverage proving representative relation helper chains infer the model after `first()`.

### Acceptance Criteria

- `whereAttachedTo`, `orWhereAttachedTo`, `whereDoesntHaveRelation`, `orWhereDoesntHaveRelation`, `whereMorphDoesntHaveRelation`, and `orWhereMorphDoesntHaveRelation` are recognized as Laravel Eloquent builder method names.
- Direct return inference for these helpers resolves to `Builder<Model>`.
- Representative relation helper chains infer `App\Models\Album` after `first()`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added the missing Laravel 13 relation helper names to known Eloquent static/fluent builder method recognition.
- Added direct return-type coverage proving the helpers preserve `Builder<App\Models\Album>`.
- Added semantic assignment coverage proving representative relation helper chains infer `App\Models\Album` after `first()`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `dd674e43 Recognize Laravel relation query helpers`.

## Slice: Laravel Soft Delete Create Restore Inference - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `7ff9564b Record Laravel relation helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer Laravel SoftDeletingScope builder extensions `createOrRestore(...)` and `restoreOrCreate(...)` as current-model terminal methods.

### Implementation Choice

- Add the two soft-delete create/restore extensions to the Eloquent terminal-model method set.
- Reuse existing `TModel` return formatting for builder receivers.
- Add semantic assignment coverage for both helpers.

### Acceptance Criteria

- `createOrRestore` and `restoreOrCreate` are recognized as terminal model methods.
- Direct return inference for these helpers resolves to the current model type.
- Assignment chains infer `App\Models\Album`.
- Focused PHP method-completion tests, semantic-engine tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added `createOrRestore` and `restoreOrCreate` to Eloquent terminal-model method recognition.
- Added direct return-type coverage proving both helpers resolve to the current model type.
- Added semantic assignment coverage proving both helpers infer `App\Models\Album`.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "common Eloquent finder|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `3089a697 Infer Laravel soft delete create restore models`.

## Slice: Laravel Relation String Helper Coverage - 2026-06-20

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `63954a8d Record Laravel soft delete terminal commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Extend Laravel relation-name string detection and completion to newer relation helpers such as `withWhereRelation(...)`, `whereDoesntHaveRelation(...)`, and morph relation negative helpers.

### Implementation Choice

- Add the missing helpers to the relation-string method set in PHP navigation.
- Add `withWhereRelation` to Laravel Eloquent builder method recognition so diagnostics and return inference agree with navigation.
- Extend existing relation-string detection/completion tests and builder semantic coverage.

### Acceptance Criteria

- Relation strings in `withWhereRelation`, `whereDoesntHaveRelation`, `orWhereDoesntHaveRelation`, `whereMorphDoesntHaveRelation`, and `orWhereMorphDoesntHaveRelation` are detected.
- Completion contexts are produced for incomplete relation strings in those helpers.
- `withWhereRelation` preserves `Builder<Model>` inference.
- Focused PHP navigation tests, relevant PHP domain tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added newer relation helpers to the PHP navigation relation-string method set.
- Added `withWhereRelation` to Laravel Eloquent builder method recognition and builder-preserving inference coverage.
- Extended relation-string detection and completion-context tests for `withWhereRelation`, negative relation helpers, and morph negative relation helpers.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts -t "Laravel relation strings"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "resolves Laravel model assignments from Eloquent builder chains"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `1201efed Cover Laravel relation string helpers`.

## Slice: Laravel Fluent Through Named Arguments - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `06c6d6ad Record App runtime label root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer fluent-through relation targets when Laravel PHP 8 named arguments are used in `through(...)` and `has(...)`.

### Implementation Choice

- Reuse the fluent-through relation path parser but read preferred named relation arguments before falling back to the first positional argument.
- Support `relationship:` and `relation:` for `through(...)`, and `relation:` and `relationship:` for `has(...)`.
- Add property-completion coverage for direct named arguments and mixed named arguments where `relation:` follows a callback.

### Acceptance Criteria

- `$this->through(relationship: 'cars')->has(relation: 'owner')` resolves the distant relation target.
- `$this->through(relationship: 'cars')->has(callback: fn () => true, relation: 'mechanics')` ignores the non-relation callback argument and resolves the named relation.
- Existing positional fluent-through relation parsing keeps working.
- Focused and full PHP method-completion tests, `npm run check`, and `git diff --check` pass.

### Completed

- Added a relation-name argument selector for fluent-through parser calls.
- Preserved positional fallback for existing Laravel fluent-through relation strings.
- Added regression coverage for named `through(...)` and named `has(...)` relation arguments.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "fluent through relation targets"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed and pushed as `de8f5872 Support Laravel fluent through named arguments`.

## Slice: Laravel Semantic Fluent Through Named Arguments - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a98f9563 Record direct LSP status root response commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree had one in-progress regression test in `src/domain/phpSemanticEngine.test.ts` at resume.

### Goal

- Infer assigned model types from Laravel fluent-through chains that use named relation arguments and terminal methods such as `first()`.

### Implementation Choice

- Keep the fluent-through path parser as the single source of truth for positional and named relation arguments.
- Add semantic return inference for complete fluent-through call expressions after relation factory inference and before normal relation/builder fallback.
- Resolve `$this` fluent-through expressions from the class containing the expression so relation property lookup can walk through intermediate relation methods.

### Acceptance Criteria

- `$this->through(relationship: 'playlists')->has(relation: 'tracks')->first()` infers `App\Models\Track`.
- Existing explicit relation factory chain inference remains green.
- Focused and full PHP semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `569430d7 Infer Laravel fluent through semantic chains`.

## Slice: Laravel Semantic Fluent Through Variants - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e24c68cc Record Laravel fluent through semantic commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock the semantic fluent-through resolver against adjacent Laravel variants already supported by the shared parser.

### Implementation Choice

- Add coverage for dynamic fluent-through names such as `throughPlaylists()->hasTracks()->first()`.
- Add coverage for named fluent-through chains that terminate with `get()` and therefore infer an Eloquent collection of the distant model.
- Keep this as a narrow regression slice unless the new tests reveal a resolver gap.

### Acceptance Criteria

- Dynamic fluent-through terminal chains infer the distant related model.
- Named fluent-through `get()` chains infer `Collection<int, RelatedModel>`.
- Focused semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `a5715d58 Cover Laravel fluent through semantic variants`.

## Slice: Laravel Relation Method Semantic Chains - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f5eefd40 Record Laravel fluent through variants commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Infer assigned model types from ordinary Laravel relation method chains such as `$this->posts()->first()`, not only inline relation factory calls.

### Implementation Choice

- Reuse the existing relation method parser that already powers magic relation-property completion.
- Return typed Eloquent relation objects for model receiver method calls whose method body or PHPDoc return type identifies a Laravel relation target.
- Cover body-inferred relations and PHPDoc-generic through relations with semantic assignment tests.

### Acceptance Criteria

- `$this->posts()->first()` infers the related `Post` model from the relation method body.
- `$this->documentedTracks()->first()` infers `Track` from `HasManyThrough<Track, Playlist>` PHPDoc generics.
- Existing direct relation factory and fluent-through semantic chains remain green.
- Focused and full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `f09adc3c Infer Laravel relation method chains`.

## Slice: Laravel MorphTo Relation Method Chain Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a6d5dc63 Record Laravel relation method chains commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Guard the new relation-method semantic fallback against Laravel `morphTo()` edge cases.

### Implementation Choice

- Add semantic coverage for a documented single-target `morphTo` relation method chain.
- Add semantic coverage proving a documented multi-target `MorphTo<Post|Video, self>` relation method chain remains ambiguous instead of selecting the first model.

### Acceptance Criteria

- `$this->commentable()->first()` infers `Post` when the relation method documents `MorphTo<Post, self>`.
- `$this->attachable()->first()` remains unknown when the relation method documents `MorphTo<Post|Video, self>`.
- Focused and full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morphTo"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `810bb272 Guard Laravel morphTo relation method chains`.

## Slice: Laravel Relation Method Collection Chains - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `48e95808 Record Laravel morphTo relation method guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Verify relation-method semantic inference holds through collection-producing relation chains.

### Implementation Choice

- Extend the relation-method semantic fixture with `$this->posts()->get()` and `$this->posts()->get()->first()`.
- Keep the slice focused on coverage unless the new assertions expose a resolver gap.

### Acceptance Criteria

- `$this->posts()->get()` infers `Illuminate\Database\Eloquent\Collection<int, App\Models\Post>`.
- `$this->posts()->get()->first()` infers `App\Models\Post`.
- Existing direct relation factory, fluent-through, and relation-method chain tests remain green.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `2b2745ea Cover Laravel relation method collection chains`.

## Slice: Laravel Relation Method Terminal Variants - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `404ae6a6 Record controller stop runtime root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock relation-method semantic inference across additional Laravel terminal and collection-producing variants.

### Implementation Choice

- Extend the relation-method semantic fixture with `firstOrFail()`, `sole()`, `lazy()`, `lazy()->first()`, and `cursor()->first()`.
- Keep the slice focused on coverage because the existing Laravel semantic resolver already handles these variants.

### Acceptance Criteria

- `$this->posts()->firstOrFail()` and `$this->posts()->sole()` infer `App\Models\Post`.
- `$this->posts()->lazy()` infers `Illuminate\Support\LazyCollection<int, App\Models\Post>`.
- `$this->posts()->lazy()->first()` and `$this->posts()->cursor()->first()` infer `App\Models\Post`.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `de1e1a5c Cover Laravel relation method terminal variants`.

## Slice: Laravel Relation Method Finder Variants - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `37751d17 Record editor defaults root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock relation-method semantic inference across common Laravel finder terminals and scalar terminal boundaries.

### Implementation Choice

- Extend the relation-method semantic fixture with `find()`, `findOr()`, `findSole()`, `firstWhere()`, `findMany()`, and `findMany()->first()`.
- Add a scalar `value()->first()` negative assertion so scalar terminal calls do not leak model inference into invalid follow-up chains.
- Keep the slice focused on coverage because the existing Laravel semantic resolver already handles these variants.

### Acceptance Criteria

- Relation-method chains ending in `find`, `findOr`, `findSole`, and `firstWhere` infer `App\Models\Post`.
- `$this->posts()->findMany()` infers `Illuminate\Database\Eloquent\Collection<int, App\Models\Post>`.
- `$this->posts()->findMany()->first()` infers `App\Models\Post`.
- `$this->posts()->value('title')->first()` does not infer a related model.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `d1a1451c Cover Laravel relation method finder variants`.
