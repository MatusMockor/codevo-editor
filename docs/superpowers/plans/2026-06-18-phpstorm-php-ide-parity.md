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

- Pending commit.
