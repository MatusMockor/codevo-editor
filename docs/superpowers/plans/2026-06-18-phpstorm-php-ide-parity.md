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

## Slice: Laravel Relation Method Fluent And Boundary Variants - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b1281ed9 Record PHP lazy code action root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock relation-method semantic inference across common builder-preserving relation helpers and boolean terminal boundaries.

### Implementation Choice

- Extend the relation-method semantic fixture with `firstOr()`, `firstOrNew()`, `latest()->first()`, and `oldest()->first()`.
- Add `exists()->first()` and `doesntExist()->first()` negative assertions so boolean terminal calls do not leak related-model inference into invalid follow-up chains.
- Keep the slice focused on coverage because the existing Laravel semantic resolver already handles these variants.

### Acceptance Criteria

- Relation-method chains ending in `firstOr` and `firstOrNew` infer `App\Models\Post`.
- Relation-method chains through `latest()` and `oldest()` infer `App\Models\Post` after `first()`.
- `$this->posts()->exists()->first()` and `$this->posts()->doesntExist()->first()` do not infer a related model.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `24aaa0cf Cover Laravel relation method fluent boundaries`.

## Slice: Laravel In Random Order Builder Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e9ff87c3 Record Laravel relation fluent boundary commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel `inRandomOrder()` as a builder-preserving query helper across Eloquent and base query-builder surfaces.

### Implementation Choice

- Add `inRandomOrder` to Eloquent static builder and fluent builder method recognition.
- Add `inRandomOrder` to database query-builder fluent method recognition.
- Cover method recognition, return-type inference, and relation-method semantic inference through `$this->posts()->inRandomOrder()->first()`.

### Acceptance Criteria

- `inRandomOrder` is recognized as a Laravel Eloquent builder method name.
- Eloquent builder calls through `inRandomOrder` preserve `Builder<Model>` inference.
- Relation-method chains through `inRandomOrder()->first()` infer the related model.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `9970d1cc Recognize Laravel inRandomOrder builder helper`.

## Slice: Laravel Ordering Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b71aa1d8 Record Laravel inRandomOrder helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel ordering helpers that preserve Eloquent builder/model inference through query and relation chains.

### Implementation Choice

- Add `orderByDesc` and `reorder` to Eloquent static builder and fluent builder method recognition.
- Add `reorder` to database query-builder fluent method recognition.
- Cover method recognition, return-type inference, and relation-method semantic inference through `orderByDesc(...)->first()` and `reorder(...)->first()`.

### Acceptance Criteria

- `orderByDesc` and `reorder` are recognized as Laravel Eloquent builder method names.
- Eloquent builder calls through `orderByDesc` and `reorder` preserve `Builder<Model>` inference.
- Relation-method chains through `orderByDesc(...)->first()` and `reorder(...)->first()` infer the related model.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `e2db0586 Recognize Laravel ordering builder helpers`.

## Slice: Laravel Raw Query Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bd1b2fb3 Record Laravel ordering helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize common Laravel raw query helpers as builder-preserving methods so raw SQL fragments do not break model-aware inference.

### Implementation Choice

- Add `selectRaw`, `whereRaw`, `orWhereRaw`, `groupByRaw`, `havingRaw`, `orHavingRaw`, and `orderByRaw` to Eloquent static/fluent builder recognition.
- Add the same missing raw helpers to base query-builder fluent recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a raw helper chain ending in `first()`.

### Acceptance Criteria

- Common raw helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder raw helper classifiers recognize the same fluent helpers.
- Eloquent builder calls through raw helpers preserve `Builder<Model>` inference.
- Relation-method chains through raw helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `3aa27bdb Recognize Laravel raw query helpers`.

## Slice: Laravel Column Constraint Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0f6504df Record Laravel raw query helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize common Laravel column comparison and negative range helpers as Eloquent builder-preserving methods.

### Implementation Choice

- Add `whereColumn`, `orWhereColumn`, and `orWhereNotBetween` to Eloquent static/fluent builder recognition.
- Cover method recognition, Eloquent builder return-type preservation, and relation-method semantic inference through a column constraint chain ending in `first()`.

### Acceptance Criteria

- `whereColumn`, `orWhereColumn`, and `orWhereNotBetween` are recognized as Laravel Eloquent builder method names.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `20fafeee Recognize Laravel column constraint helpers`.

## Slice: Laravel Like And Multi-Column Constraint Helpers - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5c8b34c4 Record Laravel column constraint helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel string-matching and multi-column constraint helpers as builder-preserving methods.

### Implementation Choice

- Add `whereLike`, `orWhereLike`, `whereNotLike`, `orWhereNotLike`, `whereAny`, `whereAll`, and `whereNone` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a like/multi-column helper chain ending in `first()`.

### Acceptance Criteria

- Like and multi-column constraint helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `17961dd6 Recognize Laravel like constraint helpers`.

## Slice: Laravel JSON Query Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `92128987 Record Laravel like helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel JSON query helpers as builder-preserving methods so JSON filters do not break model-aware inference.

### Implementation Choice

- Add JSON contains, contains-key, doesnt-contain, doesnt-contain-key, overlaps, doesnt-overlap, and length helpers plus their `orWhere` variants to Eloquent static/fluent builder recognition.
- Add the same fluent JSON helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a JSON helper chain ending in `first()`.

### Acceptance Criteria

- JSON query helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent JSON helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `184dc8cd Recognize Laravel JSON query helpers`.

## Slice: Laravel Date-Part OrWhere Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5e2509bf Record Laravel JSON helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel date-part `orWhere` helpers as builder-preserving methods so date filters do not break model-aware inference.

### Implementation Choice

- Add `orWhereDay`, `orWhereMonth`, `orWhereTime`, and `orWhereYear` to Eloquent static/fluent builder recognition.
- Add the same fluent date-part helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a date-part helper chain ending in `first()`.

### Acceptance Criteria

- Date-part `orWhere` helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent date-part helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `d6520e93 Recognize Laravel date part query helpers`.

## Slice: Laravel Between Columns And Value Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3f69e667 Record Laravel date part helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel between-columns and value-between query helpers as builder-preserving methods.

### Implementation Choice

- Add `whereBetweenColumns`, `orWhereBetweenColumns`, `whereNotBetweenColumns`, `orWhereNotBetweenColumns`, `whereValueBetween`, `orWhereValueBetween`, `whereValueNotBetween`, and `orWhereValueNotBetween` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a between helper chain ending in `first()`.

### Acceptance Criteria

- Between-columns and value-between helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent between helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `b9dc8fe4 Recognize Laravel between query helpers`.

## Slice: Laravel Multi-Column OrWhere Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `899fb878 Record Laravel between helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel multi-column `orWhereAll`, `orWhereAny`, and `orWhereNone` helpers as builder-preserving methods.

### Implementation Choice

- Add `orWhereAll`, `orWhereAny`, and `orWhereNone` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through the multi-column helper chain ending in `first()`.

### Acceptance Criteria

- Multi-column `orWhere` helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent multi-column helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `0f05556b Recognize Laravel multi column orWhere helpers`.

## Slice: Laravel Full-Text And Null-Safe Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e652c9bd Record Laravel multi column orWhere helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel full-text search and null-safe equality query helpers as builder-preserving methods.

### Implementation Choice

- Add `whereFullText`, `orWhereFullText`, `whereNullSafeEquals`, and `orWhereNullSafeEquals` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a search/null-safe helper chain ending in `first()`.

### Acceptance Criteria

- Full-text and null-safe equality helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `4411cf06 Recognize Laravel full text query helpers`.

## Slice: Laravel Integer Raw And Row-Value Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `adb7e54b Record Laravel full text helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel integer raw `whereIn` and row-value query helpers as builder-preserving methods.

### Implementation Choice

- Add `whereIntegerInRaw`, `orWhereIntegerInRaw`, `whereIntegerNotInRaw`, `orWhereIntegerNotInRaw`, `whereRowValues`, and `orWhereRowValues` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through an integer/raw row-value helper chain ending in `first()`.

### Acceptance Criteria

- Integer raw and row-value helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `e6cd208e Recognize Laravel integer raw query helpers`.

## Slice: Laravel Exists Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5c2fc0dd Record Laravel integer raw helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel exists and not-exists query helpers as builder-preserving methods.

### Implementation Choice

- Add `whereExists`, `orWhereExists`, `whereNotExists`, and `orWhereNotExists` to Eloquent static/fluent builder recognition.
- Add missing `whereNotExists` and `orWhereNotExists` to base query-builder recognition while preserving existing `whereExists` and `orWhereExists` support.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through an exists helper chain ending in `first()`.

### Acceptance Criteria

- Exists and not-exists helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent exists helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `03a56605 Recognize Laravel exists query helpers`.

## Slice: Laravel Having Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bed99bd7 Record Laravel exists helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel fluent `having` helper variants as builder-preserving methods.

### Implementation Choice

- Add `havingBetween`, `havingNested`, `havingNotBetween`, `havingNotNull`, `havingNull`, `orHaving`, `orHavingBetween`, `orHavingNotBetween`, `orHavingNotNull`, and `orHavingNull` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition while preserving existing `having`, `havingRaw`, and `orHavingRaw` support.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a having helper chain ending in `first()`.

### Acceptance Criteria

- Common `having` helper variants are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent `having` helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `8c278184 Recognize Laravel having query helpers`.

## Slice: Laravel Lock Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `00a49a98 Record Laravel having helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel lock helper variants as builder-preserving methods.

### Implementation Choice

- Add `lock`, `lockForUpdate`, and `sharedLock` to Eloquent static/fluent builder recognition.
- Add missing `lockForUpdate` to base query-builder recognition while preserving existing `lock` and `sharedLock` support.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a lock helper chain ending in `first()`.

### Acceptance Criteria

- Lock helper variants are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent lock helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `d6214f67 Recognize Laravel lock query helpers`.

## Slice: Laravel Relative Date Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `537a8ae4 Record Laravel lock helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel relative date query helpers from `BuildsWhereDateClauses` as builder-preserving methods.

### Implementation Choice

- Add public `wherePast`, `whereNowOrPast`, `whereFuture`, `whereNowOrFuture`, `whereToday`, `whereBeforeToday`, `whereTodayOrBefore`, `whereAfterToday`, and `whereTodayOrAfter` helpers plus their public `orWhere` variants to Eloquent static/fluent builder recognition.
- Add the same public fluent helpers to base query-builder recognition.
- Leave protected internal helpers such as `wherePastOrFuture` and `whereTodayBeforeOrAfter` out of completion recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a relative date helper chain ending in `first()`.

### Acceptance Criteria

- Public relative date helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent relative date helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `f6156ede Recognize Laravel relative date query helpers`.

## Slice: Laravel Query Control Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8e498acc Record Laravel relative date helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel query-control helpers as builder-preserving methods so pagination, callbacks, timeout, reorder, and union operations do not break model-aware inference.

### Implementation Choice

- Add `beforeQuery`, `forPage`, `forPageAfterId`, `forPageBeforeId`, `reorderDesc`, `timeout`, `union`, and `unionAll` to Eloquent static/fluent builder recognition while preserving existing `afterQuery` support.
- Add `afterQuery`, `beforeQuery`, `forPage`, `forPageAfterId`, `forPageBeforeId`, `reorderDesc`, `timeout`, `union`, and `unionAll` to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a query-control helper chain ending in `first()`.

### Acceptance Criteria

- Query-control helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent query-control helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `1ad5a8c2 Recognize Laravel query control helpers`.

## Slice: Laravel Source Select And Join Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `845d5c05 Record Laravel query control helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel source, select, and join helper variants as builder-preserving methods.

### Implementation Choice

- Add `addSelect`, `selectSub`, `selectExpression`, `fromSub`, `fromRaw`, `useIndex`, `forceIndex`, `ignoreIndex`, join-sub, join-where, lateral join, straight join, and related left/right/cross variants to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition while preserving existing `select`, `selectRaw`, and basic join support.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a source/select/join helper chain ending in `first()`.

### Acceptance Criteria

- Source, select, and join helper variants are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent source/select/join helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `906477a6 Recognize Laravel source and join query helpers`.

## Slice: Laravel Vector And Order Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ef1fa0cb Record Laravel source join helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel vector search and order helper variants as builder-preserving methods.

### Implementation Choice

- Add `selectVectorDistance`, `whereVectorSimilarTo`, `whereVectorDistanceLessThan`, `orWhereVectorDistanceLessThan`, `orderByVectorDistance`, `inOrderOf`, and `groupLimit` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a vector/order helper chain ending in `first()`.

### Acceptance Criteria

- Vector search and order helper variants are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent vector/order helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `af113054 Recognize Laravel vector query helpers`.

## Slice: Laravel Negated Where Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1062fc7b Record Laravel vector helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize Laravel `whereNot` and `orWhereNot` helpers as builder-preserving methods.

### Implementation Choice

- Add `whereNot` and `orWhereNot` to Eloquent static/fluent builder recognition.
- Add the same fluent helpers to base query-builder recognition.
- Cover classifier behavior, Eloquent builder return-type preservation, and relation-method semantic inference through a negated where chain ending in `first()`.

### Acceptance Criteria

- Negated where helpers are recognized as Laravel Eloquent builder method names.
- Base query-builder classifiers recognize the same fluent negated where helpers.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "raw query builder|local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `e6567bfa Recognize Laravel negated where helpers`.

## Slice: Laravel Relationship Query Builder Helper Recognition - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ede3d786 Record Laravel negated where helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Recognize additional Laravel relationship query helpers as Eloquent builder-preserving methods.

### Implementation Choice

- Add missing `orHas`, `orDoesntHave`, and `orWhereRelation` to Eloquent static/fluent builder recognition.
- Expand classifier and return-type preservation coverage for relationship query variants including `orHasMorph`, `orDoesntHaveMorph`, `whereRelation`, `orWhereRelation`, `whereDoesntHave`, `orWhereDoesntHave`, and morph relation variants.
- Cover relation-method semantic inference through a relationship query chain ending in `first()`.

### Acceptance Criteria

- Relationship query helper variants are recognized as Laravel Eloquent builder method names.
- Eloquent builder calls through these helpers preserve `Builder<Model>` inference.
- Relation-method chains through these helpers infer the related model after `first()`.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "relation factory chains"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `64ef5240 Recognize Laravel relationship query helpers`.

## Slice: Laravel Scalar Aggregate Terminal Boundary - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b043785b Record Laravel relationship helper commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat Laravel scalar aggregate and callback terminal helpers as non-model terminal boundaries.

### Implementation Choice

- Add `sum`, `avg`, `average`, `min`, `max`, `aggregate`, `numericAggregate`, `rawValue`, `existsOr`, `doesntExistOr`, and `implode` to Eloquent builder method recognition.
- Add the same helpers to the non-model terminal boundary set so return-type inference stops instead of preserving `Builder<Model>`.
- Cover return-type null behavior and semantic model-assignment guards after chains that incorrectly continue with `first()`.

### Acceptance Criteria

- Scalar aggregate and callback terminal helpers are recognized as Laravel Eloquent builder method names.
- Eloquent builder return-type inference returns `null` for these terminal helpers.
- Model assignments after these terminal helpers do not infer the original model.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "Laravel model assignments"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `33ea4548 Treat Laravel scalar aggregates as terminals`.

## Slice: Laravel Mutation Terminal Boundary - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8809de01 Record Laravel scalar terminal commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Treat additional Laravel query mutation helpers as non-model terminal boundaries.

### Implementation Choice

- Add `insertGetId`, `insertOrIgnore`, `insertOrIgnoreReturning`, `insertUsing`, `insertOrIgnoreUsing`, `updateOrInsert`, `updateFrom`, and `truncate` to Eloquent builder method recognition.
- Add the same helpers to the non-model terminal boundary set so return-type inference stops instead of preserving `Builder<Model>`.
- Cover return-type null behavior and semantic model-assignment guards after chains that incorrectly continue with `first()`.

### Acceptance Criteria

- Mutation terminal helpers are recognized as Laravel Eloquent builder method names.
- Eloquent builder return-type inference returns `null` for these terminal helpers.
- Model assignments after these terminal helpers do not infer the original model.
- Focused/full method-completion and semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts -t "local scopes|infers Laravel builder return types without global local-scope leakage"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "Laravel model assignments"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `eb39dcf8 Treat Laravel mutation helpers as terminals`.

## Slice: Laravel Controller Group Route Actions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `73d08189 Record indexed definition guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve Laravel `Route::controller(...)->group(...)` action strings to the paired controller method before LSP fallback.

### Implementation Choice

- Extend `phpIdentifierContextAt` route-action detection beyond `[Controller::class, 'method']`.
- Recognize second-argument route action strings inside `Route::get/post/put/patch/delete/options/any/match(...)` calls nested in a `Route::controller(Controller::class)->group(...)` body.
- Preserve existing array route-action behavior.
- Add domain coverage for `show` and `store` strings in a controller group.
- Add workbench go-to-definition coverage proving the controller group action opens the indexed controller method without calling the LSP fallback.

### Acceptance Criteria

- Controller group route action strings are identified as `laravelRouteActionMethod` contexts.
- Go to Definition from a controller group action string opens the matching controller method.
- Existing Laravel route action string behavior remains unchanged.
- Focused/full navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "Laravel controller group route action strings|resolves Laravel controller group route action strings|resolves Laravel route action strings to the paired controller method"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `39c8fcfe Resolve Laravel controller group route actions`.

## Slice: Laravel Redirect Facade Route Names - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `26172898 Record Laravel controller group route action commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Provide Laravel named-route completions for `Redirect::route(...)` facade calls.

### Implementation Choice

- Add `Redirect::route` to the named-route reference call union.
- Detect `Redirect::route('name')` as a supported first-argument named-route context.
- Preserve existing `route`, `to_route`, `redirect()->route`, `URL::route`, and `Route::has` behavior.
- Add parser coverage for the new facade context.
- Add workbench coverage proving route-name completions work inside `Redirect::route('comments.pre')`.

### Acceptance Criteria

- `Redirect::route(...)` string literals produce a named-route reference context.
- Laravel named-route completions work inside `Redirect::route(...)`.
- Existing named-route helper completions still pass.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "supported first string arguments|Redirect facade route strings|suggests Laravel named routes inside route helper strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `ae52e331 Complete Laravel Redirect facade route names`.

## Slice: Chained Laravel Controller Route Groups - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `be672c55 Record Laravel Redirect facade route names commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve route action strings inside chained Laravel controller groups such as `Route::prefix(...)->controller(...)->group(...)`.

### Implementation Choice

- Extend controller group detection from direct `Route::controller(...)` calls to chained `->controller(...)` segments in Route chains.
- Preserve direct controller group detection.
- Add domain coverage for a `Route::prefix(...)->controller(...)->group(...)` action string.
- Change the workbench route-action go-to-definition regression to use the chained prefix/controller group shape.

### Acceptance Criteria

- Direct controller route groups still resolve action strings to controller methods.
- Chained prefix/controller route groups resolve action strings to controller methods.
- Go to Definition from a chained controller group action opens the indexed controller method.
- Focused/full navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "Laravel controller group route action strings|resolves Laravel controller group route action strings"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `ac9d0221 Resolve chained Laravel controller route groups`.

## Slice: Laravel Signed URL Route Names - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `080d903a Record chained Laravel controller route group commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Provide Laravel named-route completions for signed URL generation calls.

### Implementation Choice

- Add `URL::signedRoute`, `URL::temporarySignedRoute`, `Uri::signedRoute`, and `Uri::temporarySignedRoute` to named-route reference detection.
- Keep the existing first-argument route-name behavior for `route`, `to_route`, `redirect()->route`, `Redirect::route`, `URL::route`, and `Route::has`.
- Add parser coverage for each signed-route variant.
- Add workbench coverage proving route-name completions work inside `URL::temporarySignedRoute('comments.uns', ...)`.

### Acceptance Criteria

- Signed-route string literals produce named-route reference contexts.
- Laravel named-route completions work inside signed URL route calls.
- Existing named-route helper and Redirect facade route completions still pass.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "supported first string arguments|signed URL route strings|Redirect facade route strings|suggests Laravel named routes inside route helper strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `bd714103 Complete Laravel signed route names`.

## Slice: Laravel Signed Redirect Route Names - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0d41f54c Record Laravel signed route names commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Provide Laravel named-route completions for signed redirect route calls.

### Implementation Choice

- Add `redirect()->signedRoute`, `redirect()->temporarySignedRoute`, `Redirect::signedRoute`, and `Redirect::temporarySignedRoute` to named-route reference detection.
- Keep the existing route helper, Redirect facade, URL facade, Uri, and `Route::has` first-argument behavior unchanged.
- Add parser coverage for each signed redirect route variant.
- Add workbench coverage proving route-name completions work inside `redirect()->temporarySignedRoute('comments.pre', ...)`.

### Acceptance Criteria

- Signed redirect route string literals produce named-route reference contexts.
- Laravel named-route completions work inside signed redirect route calls.
- Existing named-route helper, signed URL, and Redirect facade route completions still pass.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "supported first string arguments|signed redirect route strings|signed URL route strings|Redirect facade route strings|suggests Laravel named routes inside route helper strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `c5025e55 Complete Laravel signed redirect route names`.

## Slice: Laravel Uri Route Names - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b9454e2a Record Laravel signed redirect route names commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Provide Laravel named-route completions for fluent `Uri::route(...)` calls.

### Implementation Choice

- Add `Uri::route` to named-route reference detection next to the existing `Uri::signedRoute` and `Uri::temporarySignedRoute` support.
- Keep existing helper, redirector, URL, signed URL, and `Route::has` first-argument behavior unchanged.
- Add parser coverage for `Uri::route('comments.uri')`.
- Add workbench coverage proving route-name completions work inside `Uri::route('comments.ur')`.

### Acceptance Criteria

- `Uri::route(...)` string literals produce named-route reference contexts.
- Laravel named-route completions work inside `Uri::route(...)`.
- Existing named-route helper, signed URL, signed redirect, and Redirect facade route completions still pass.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "supported first string arguments|Uri route strings|signed redirect route strings|signed URL route strings|Redirect facade route strings|suggests Laravel named routes inside route helper strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `828a610a Complete Laravel Uri route names`.

## Slice: Laravel Named Route Arguments - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6038f58c Record Laravel Uri route names commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Provide Laravel named-route completions when PHP 8 named arguments are used for route names.

### Implementation Choice

- Replace the route-name first-argument opener check with a small context object that records an optional top-level named argument.
- Allow `name:` for `route`, URL, Uri, and `Route::has` route-name APIs.
- Allow `route:` for `to_route`, redirector, and Redirect facade route-name APIs.
- Reject unsupported named arguments such as `route(label: ...)`, `redirect()->route(name: ...)`, and `URL::route(route: ...)`.
- Add parser coverage for supported and unsupported named-argument cases.
- Add workbench coverage proving route-name completions work inside `route(name: 'comments.sh')`.

### Acceptance Criteria

- Supported PHP named arguments produce named-route reference contexts.
- Unsupported named arguments remain ignored.
- Laravel named-route completions work inside a named route helper argument.
- Existing route-name helper, URL, Uri, signed redirect, and unsupported-call behavior still pass.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "supported named arguments|unsupported route-like calls|named route helper arguments|route helper strings|Uri route strings|signed redirect route strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `d799b5e7 Complete Laravel named route arguments`.

## Slice: Laravel Named Route Definitions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `315daa71 Record Laravel named route arguments commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include PHP 8 named arguments in Laravel route-name definition extraction.

### Implementation Choice

- Extend the closed-literal route argument helper with optional allowed named argument names.
- Use `name:` support for chained `->name(...)` route definitions.
- Use `name:` support for `Route::name(...)->group(...)` and chained route group name prefixes.
- Keep `as(...)`, resource route parsing, and unsupported `name(label: ...)` cases conservative.
- Add parser coverage for named route definitions, named group prefixes, and unsupported named route definition arguments.
- Add workbench coverage proving route-name completions can be sourced from `->name(name: 'comments.show')`.

### Acceptance Criteria

- `->name(name: '...')` route definitions are indexed.
- `Route::name(name: '...')->group(...)` prefixes are applied.
- Unsupported named route definition arguments remain ignored.
- Laravel named-route completions work when route definitions use named arguments.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "named route definition arguments|chained Laravel route definitions|combines group prefixes|route helper strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `b0ba1773 Complete Laravel named route definitions`.

## Slice: Laravel Named Resource Route Definitions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `09b40e2b Record Laravel named route definitions commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include PHP 8 named arguments in Laravel resource and singleton route-name extraction.

### Implementation Choice

- Allow `name:` when extracting the first literal route name for `Route::resource`, `Route::apiResource`, `Route::singleton`, and `Route::apiSingleton`.
- Keep resource array route parsing unchanged because those APIs take a route map instead of a single name.
- Keep unsupported named arguments such as `label:` ignored.
- Add parser coverage for named-argument resource and singleton route definitions, including prefixed groups.
- Update workbench route completion coverage so resource route names can be sourced from `Route::resource(name: 'comments', ...)`.

### Acceptance Criteria

- Named-argument resource definitions expand to the expected resource route names.
- Named-argument singleton definitions expand to the expected singleton route names.
- Group prefixes still apply to named-argument resource and singleton definitions.
- Unsupported named arguments remain ignored.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "resource route names from named arguments|singleton route names from named arguments|resource route names from resource-only route files|literal Laravel resource route names|literal Laravel singleton route names"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `5eaedc64 Complete Laravel named resource route definitions`.

## Slice: Laravel Named Resource Filters - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6d37fe64 Record Laravel named resource route definitions commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include PHP 8 named arguments in Laravel resource `only(...)` and `except(...)` route-name filtering.

### Implementation Choice

- Pass the current filter method name into `laravelRouteActionNamesAtOpenParen`.
- Let resource filters read `only(only: [...])`, `only(only: 'index')`, `except(except: [...])`, and `except(except: 'destroy')`.
- Keep unsupported named arguments such as `only(label: [...])` ignored instead of treating their strings as route action filters.
- Reuse the named-argument value helper introduced for literal route arguments.
- Update workbench resource completion coverage so resource route names can be sourced from `Route::resource(...)->only(only: ['edit'])`.

### Acceptance Criteria

- Named `only:` filters reduce resource route names to the requested actions.
- Named `except:` filters remove the requested resource route actions.
- Unsupported named filter arguments do not accidentally filter route names.
- Existing positional `only(...)` and `except(...)` behavior remains unchanged.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "named only and except arguments|only and except|resource route names from resource-only route files|resource route names from named arguments"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `dca3dbd0 Complete Laravel named resource filters`.

## Slice: Laravel Named Resource Route Overrides - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `64edecd6 Record Laravel named resource filters commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include PHP 8 named arguments in Laravel resource `names(...)` route-name override maps.

### Implementation Choice

- Extend the route string-map helper with optional allowed named argument names.
- Use `names:` only for resource and singleton route override maps, leaving group array prefix parsing unchanged.
- Keep unsupported named arguments such as `names(label: [...])` ignored.
- Add parser coverage for named resource overrides, filtered API resource overrides, singleton overrides inside named groups, and unsupported named override arguments.
- Add workbench coverage proving route-name completions can be sourced from `Route::resource(...)->names(names: ['edit' => 'comments.modify'])`.

### Acceptance Criteria

- `->names(names: [...])` overrides resource route names.
- Named override maps work after named `only:` filters.
- Singleton route override maps support `names:`.
- Unsupported named override arguments do not accidentally override route names.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "route name overrides from named arguments|literal Laravel resource route name overrides|resource route names from resource-only route files"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `17b2a289 Complete Laravel named resource route overrides`.

## Slice: Laravel Named Group Route Prefixes - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e2670d7e Record Laravel named resource route overrides commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Include PHP 8 named arguments in Laravel `Route::group(...)` route-name prefix extraction.

### Implementation Choice

- Allow `attributes:` when reading array route group attributes.
- Reuse the existing group `as` prefix extraction after resolving the named argument value.
- Leave unsupported named group arguments such as `options:` unprefixed while still indexing their inner route names.
- Add parser coverage for single and nested `Route::group(attributes: ['as' => ...])` prefixes.
- Add workbench coverage proving route-name completions can be sourced from a named-argument route group prefix.

### Acceptance Criteria

- `Route::group(attributes: ['as' => 'admin.'], ...)` prefixes inner route names.
- Nested named-argument route groups combine prefixes in order.
- Unsupported named group arguments do not accidentally apply prefixes or hide inner route definitions.
- Laravel route-name completions include named-argument group prefixes.
- Focused/full route parser and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts src/application/useWorkbenchController.preview.test.tsx -t "named-argument Laravel route group name prefixes|array Laravel route group name prefixes|named route group attributes|route helper strings"`
- PASS: `npm test -- src/domain/phpLaravelRoutes.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `8733e771 Complete Laravel named group route prefixes`.

## Slice: Laravel Named Controller Groups - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4f671de1 Record Laravel named group route prefixes commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve Laravel controller group action strings when `Route::controller(...)` uses PHP 8 named arguments.

### Implementation Choice

- Extend controller group detection to accept `controller(controller: CommentController::class)`.
- Preserve existing direct `Route::controller(CommentController::class)` and chained `->controller(CommentController::class)` detection.
- Add domain coverage for direct and chained named controller groups.
- Update workbench go-to-definition coverage so a chained named controller group action resolves before LSP fallback.

### Acceptance Criteria

- Direct `Route::controller(controller: ...)->group(...)` action strings resolve to controller methods.
- Chained `Route::prefix(...)->controller(controller: ...)->group(...)` action strings resolve to controller methods.
- Existing positional controller group behavior remains unchanged.
- Go to Definition from a named controller group action opens the indexed controller method without LSP fallback.
- Focused/full navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "Laravel controller group route action strings|resolves Laravel controller group route action strings"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `2140450c Complete Laravel named controller groups`.

## Slice: Laravel Named Controller Route Actions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `43f0277d Record Laravel named controller groups commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve Laravel controller group action strings when route methods use PHP 8 named `action:` arguments.

### Implementation Choice

- Add a top-level call argument-name helper for string literals.
- Treat route action strings inside controller groups as valid when they are either the existing second positional argument or an explicit named `action:` argument.
- Keep unsupported named arguments such as `label:` ignored.
- Add domain coverage for `Route::get(action: 'method', uri: ...)` and unsupported named string arguments.
- Update workbench go-to-definition coverage so a named `action:` route opens the indexed controller method before LSP fallback.

### Acceptance Criteria

- `Route::get(action: 'show', uri: ...)` inside a controller group resolves to the grouped controller method.
- Unsupported named route strings such as `label: 'notAction'` remain ordinary string/class identifiers.
- Existing positional controller group route action behavior remains unchanged.
- Go to Definition from a named `action:` route opens the indexed controller method without LSP fallback.
- Focused/full navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "Laravel controller group route action strings|resolves Laravel controller group route action strings"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `4ddfcdbe Complete Laravel named controller route actions`.

## Slice: Laravel Resource Route Target Search - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2be9e9c6 Record Laravel named controller route actions commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Make Laravel named-route completions discover resource-style route files beyond `Route::resource` and `Route::apiResource`.

### Implementation Choice

- Expand named-route target search queries to include `Route::singleton`, `Route::apiSingleton`, `Route::resources`, `Route::apiResources`, and `Route::softDeletableResources`.
- Preserve existing `->name(`, `Route::resource`, and `Route::apiResource` discovery.
- Add workbench coverage proving route-name completions can be sourced from a singleton-only route file.

### Acceptance Criteria

- Singleton-only route files can contribute named-route completions.
- Existing resource-only route file completions still work.
- Existing resource override completions still work.
- Full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "resource route names from resource-only route files|singleton route names from singleton-only route files|resource route name overrides from named arguments"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `43ba25e9 Complete Laravel resource route target search`.

## Slice: Laravel Named Relation Strings - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `552f3241 Record Laravel resource route target search commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Provide Laravel relation-string navigation and completions when PHP 8 named arguments are used.

### Implementation Choice

- Allow first-argument relation strings through named `relation:` and `relations:` arguments.
- Support both direct string arguments and array relation arguments such as `with(relations: ['children.parent'])`.
- Tighten positional relation string detection so unsupported named arguments such as `label:` are ignored.
- Preserve incomplete-string completion such as `$comment->load('chi`.
- Add domain coverage for navigation contexts, completion contexts, named array relation paths, and unsupported named arguments.
- Add workbench coverage proving relation completions work inside `load(relations: ...)` and `whereHas(relation: ...)`.

### Acceptance Criteria

- `load(relations: 'children')` resolves and completes relation names.
- `with(relations: ['children.parent'])` resolves nested relation paths.
- `whereHas(relation: 'attachments', ...)` resolves and completes relation names.
- Unsupported named arguments such as `label:` do not produce relation contexts.
- Focused/full navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "relation strings in named arguments|relation string completion contexts in named arguments|completes Laravel relation strings from the owning model|opens Laravel relation methods from relation-name strings"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `28afa83e Complete Laravel named relation strings`.

## Slice: Laravel Late Named Relation Strings - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `12e01161 Record Laravel named relation strings commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Support PHP 8 named relation arguments even when `relation:` / `relations:` appear after other named arguments.

### Implementation Choice

- Treat explicit `relation:` and `relations:` relation-string arguments as valid regardless of their top-level argument index.
- Keep positional relation-string detection limited to the first argument with whitespace-only prefix.
- Preserve incomplete positional string completion such as `$comment->load('chi`.
- Add parser coverage for delayed named string relation arguments and delayed named array relation paths.
- Add workbench coverage proving completions work inside `whereHas(callback: ..., relation: 'attach')`.

### Acceptance Criteria

- `whereHas(callback: ..., relation: '...')` resolves and completes relation names.
- `with(callback: ..., relations: ['parent.child'])` resolves nested relation paths.
- Unsupported named arguments such as `label:` remain ignored.
- Existing positional and first named relation-string behavior remains unchanged.
- Focused/full navigation and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "relation strings in named arguments|relation string completion contexts in named arguments|completes Laravel relation strings from the owning model"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `4e1f676b Complete Laravel late named relation strings`.

## Slice: Trait Host Constant Diagnostics - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `99adadf9 Record Laravel late named relation strings commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Improve PHPactor trait host-context reconciliation beyond methods and properties by handling class constants declared on trait host classes.

### Implementation Choice

- Add a PHPactor trait host-constant diagnostic parser for `self::`, `static::`, and `parent::` constant reads.
- Filter host-constant diagnostics only when contextual analysis proves a concrete class or enum using the trait exposes the constant.
- Reuse the existing class hierarchy traversal shape for traits, mixins, supertypes, intermediate traits, and descendant classes.
- Keep unconfirmed constant diagnostics visible, including method-call lookalikes such as `static::HOST_STATE()`.
- Add preview coverage for a trait using `static::HOST_STATE` where the host class declares `private const HOST_STATE`.

### Acceptance Criteria

- `static::HOST_STATE` inside a trait is not reported when a real host declares `HOST_STATE`.
- Alternate PHPactor wording for trait constants is recognized.
- Missing or method-call-like constants are not suppressed.
- Existing trait host-method and host-property diagnostic behavior remains unchanged.
- Focused/full diagnostic and preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpLanguageServerDiagnosticFilters.test.ts -t "trait host-constant"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "trait host-constant"`
- PASS: `npm test -- src/domain/phpLanguageServerDiagnosticFilters.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `74fdef20 Reconcile trait host constant diagnostics`.

## Slice: Stale Type Hierarchy Tab Switch Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `681f5815 Record trait host constant diagnostics commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down workspace-tab isolation for JavaScript/TypeScript type hierarchy requests when a project tab switch happens while the LSP request is in flight.

### Implementation Choice

- Add a preview controller regression mirroring the existing call hierarchy stale-tab-switch guard.
- Start a type hierarchy request in `/workspace-a`, switch to `/workspace-b`, then reject the delayed request.
- Assert the stale error does not set the user-facing message or create a Type Hierarchy notice.
- Keep this as a test-only slice because the controller already uses the root/session active guard for type hierarchy.

### Acceptance Criteria

- A delayed type hierarchy failure from an inactive project tab is ignored.
- The active workspace remains `/workspace-b`.
- No stale Type Hierarchy notice leaks into the active tab.
- The existing same-root session restart guard remains covered.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "type hierarchy errors after switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `2012fccd Cover stale type hierarchy tab switches`.

## Slice: Stale File Structure Tab Switch Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9f3dc8ab Record stale type hierarchy tab switch guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down workspace-tab isolation for JavaScript/TypeScript file structure requests when document-symbol loading finishes after a project tab switch.

### Implementation Choice

- Add a preview controller regression for delayed `documentSymbols` failures from an inactive project tab.
- Start file structure loading in `/workspace-a`, switch to `/workspace-b`, then reject the delayed document-symbol request.
- Assert the stale error does not set the active user-facing message or create a JavaScript/TypeScript File Structure notice.
- Keep this as a test-only slice because the controller already guards file structure loading through the requested root/session checks.

### Acceptance Criteria

- A delayed file structure failure from an inactive project tab is ignored.
- The active workspace remains `/workspace-b`.
- No stale JavaScript/TypeScript File Structure notice leaks into the active tab.
- Existing same-root session restart file structure coverage remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "file structure errors after switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `c7c7bbd5 Cover stale file structure tab switches`.

## Slice: Stale File Structure Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3df931eb Record stale file structure tab switch guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down the successful-response side of JavaScript/TypeScript file structure isolation when document-symbol results arrive after a workspace tab switch.

### Implementation Choice

- Add a preview controller regression for delayed successful `documentSymbols` responses from an inactive project tab.
- Start file structure loading in `/workspace-a`, switch to `/workspace-b`, then resolve the delayed request with a stale `StaleUserService` symbol.
- Assert the active workspace remains `/workspace-b` and the stale symbol does not populate the active file structure outline.
- Keep the previous stale-error regression alongside this stale-result regression.

### Acceptance Criteria

- A delayed file structure result from an inactive project tab is ignored.
- The active workspace remains `/workspace-b`.
- Stale symbols do not populate the active file structure outline.
- Stale error and same-root session restart coverage remain unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "file structure results after switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "file structure .* switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `af693582 Cover stale file structure tab results`.

## Slice: Laravel Morph Map Class-String Constants - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2c0eb1aa Record stale file structure result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve Laravel `morphTo()` fallback targets when `Relation::morphMap()` values are local class-string constants.

### Implementation Choice

- Reuse the existing PHP class-string constant resolver inside morph map model-class extraction.
- Resolve the class containing the morph map value expression so `self::POST_MODEL` can be mapped back to `Post::class`.
- Preserve existing support for direct `Post::class` values and string class names.
- Add semantic coverage for relation-property and terminal-chain inference through a morph map declared in a service provider class.

### Acceptance Criteria

- `Relation::morphMap(['post' => self::POST_MODEL])` resolves `self::POST_MODEL` to the mapped model class.
- `$comment->commentable`, `$this->morphTo()->first()`, and `$comment->commentable->...` infer `App\Models\Post` when the morph map has one resolved target.
- Existing direct morph map and ambiguous multi-target morphTo behavior remains unchanged.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- FAIL then fixed: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map targets from local class-string constants"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map targets"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `2262d399 Resolve morph map class-string constants`.

## Slice: Laravel Morph Map Array Constants - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1ae5650c Record morph map class-string constants commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve Laravel `morphTo()` fallback targets when `Relation::morphMap()` receives a local array class constant.

### Implementation Choice

- Allow morph map argument extraction to resolve class-constant array bodies such as `self::MORPH_MAP`.
- Reuse existing class-body and class-constant statement parsing instead of adding a broad parser.
- Keep inline arrays, named `map:` arguments, direct `Post::class`, string class names, and class-string constant map values unchanged.
- Add semantic coverage for relation-property and terminal-chain inference through a service-provider `private const MORPH_MAP = ['post' => Post::class]`.

### Acceptance Criteria

- `Relation::morphMap(self::MORPH_MAP)` resolves the inline array body stored in `MORPH_MAP`.
- `$comment->commentable`, `$this->morphTo()->first()`, and `$comment->commentable->...` infer `App\Models\Post` when the resolved morph map has one target.
- Existing direct morph map, class-string constant value, and ambiguous multi-target morphTo behavior remains unchanged.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- FAIL then fixed: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph maps from local array constants"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `76205e39 Resolve morph map array constants`.

## Slice: Laravel Morph Map Array Constant Values - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `610deb30 Record morph map array constants commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock the combined Laravel morph map path where an array class constant contains class-string constant values.

### Implementation Choice

- Add semantic regression coverage for `Relation::morphMap(self::MORPH_MAP)` when `MORPH_MAP` contains `'post' => self::POST_MODEL`.
- Keep this as a test-only slice because the previous class-string value and array-constant resolvers already compose correctly.
- Cover relation-property and terminal-chain inference through the combined provider constant setup.

### Acceptance Criteria

- `private const MORPH_MAP = ['post' => self::POST_MODEL]` resolves through `Relation::morphMap(self::MORPH_MAP)`.
- `$comment->commentable`, `$this->morphTo()->first()`, and `$comment->commentable->...` infer `App\Models\Post`.
- Existing direct morph map, class-string constant value, array constant, and ambiguous multi-target morphTo behavior remains unchanged.
- Focused/full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "array constants with class-string constant values"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `c2b27554 Cover morph map array constant values`.

## Slice: Laravel Morph Map Constants in Workbench Completions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `687ec58c Record morph map array constant values commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Prove the Laravel morph map constant inference reaches the real workbench PHP method-completion flow, not only the domain semantic resolver.

### Implementation Choice

- Extend the existing preview relation-completion scenario with an untyped `mappedOwner(): MorphTo` relation.
- Define `Relation::morphMap(self::MORPH_MAP)` in the model source where `MORPH_MAP` contains a class-string constant value (`self::OWNER_MODEL`).
- Assert `$comment->mappedOwner()->first()` offers `App\Models\User::getName()` completions through `providePhpMethodCompletions`.
- Keep this as a test-only slice because the current resolver path already carries the type through the workbench.

### Acceptance Criteria

- Workbench method completions resolve `mappedOwner()->first()` to `App\Models\User` through a local morph map array constant and class-string constant value.
- Existing Laravel relation, relation-property, documented morphTo, collection, and named-argument relation completion behavior remains unchanged.
- Focused preview test, full preview test file, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "infers Laravel relation model completions from property and relation chains"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `bcc02a6b Cover morph map constants in workbench completions`.

## Slice: Laravel Morph Map Array Constant Aliases - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `de38bad8 Record morph map workbench completion commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Resolve Laravel `morphTo()` fallback targets when `Relation::morphMap()` receives a class constant that aliases another local morph-map array constant.

### Implementation Choice

- Add semantic coverage for `Relation::morphMap(self::ACTIVE_MORPH_MAP)` where `ACTIVE_MORPH_MAP = self::MORPH_MAP`.
- Extend `phpLaravelMorphMapArrayConstantBody` to recursively resolve class-constant map aliases.
- Track visited `Class::CONSTANT` keys to prevent recursive alias cycles from hanging inference.
- Preserve existing inline arrays, direct array constants, class-string constant values, and ambiguous morphTo behavior.

### Acceptance Criteria

- `private const ACTIVE_MORPH_MAP = self::MORPH_MAP` resolves through `Relation::morphMap(self::ACTIVE_MORPH_MAP)`.
- `$comment->commentable`, `$this->morphTo()->first()`, and `$comment->commentable->...` infer `App\Models\Post` when the aliased map has one target.
- Recursive constant lookup stops safely on already-visited constants.
- Focused morph-map tests, full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- FAIL then fixed: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map array constant aliases"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `5914c381 Resolve morph map array constant aliases`.

## Slice: Laravel Project Morph Map Completions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `fa621ce4 Record morph map alias constant commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Let workbench PHP method completions use Laravel morph maps defined in separate project files such as `app/Providers/AppServiceProvider.php`.

### Implementation Choice

- Add a project-level morph-map lookup that searches PHP files for `morphMap`/`enforceMorphMap`, reads matching files, and extracts entries with the existing domain parser.
- Cache the single unambiguous project morph-map model type alongside other PHP framework caches and clear it with index/workspace cache resets.
- Use the project morph-map fallback when `morphTo()` relation targets are otherwise unknown in method-return and relation-property inference paths.
- Keep multi-target morph maps conservative: if more than one model type is found, inference remains ambiguous.

### Acceptance Criteria

- A controller completion for `$comment->mappedOwner()->first()` resolves to `App\Models\User` when `Comment.php` only contains `morphTo()` and `AppServiceProvider.php` registers a single-target morph map.
- Existing local morph-map, relation, documented morphTo, semantic, and completion behavior remains unchanged.
- Focused preview regression, full preview file, full semantic tests, `npm run check`, and `git diff --check` pass.

### Verification

- FAIL then fixed: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "infers Laravel morph map completions from service provider files"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `69430235 Resolve project morph map completions`.

## Slice: Laravel Project Morph Map Edit Refresh - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3faab39e Record PHP signature help tab switch commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Keep Laravel project morph-map completions current after editing an open service provider file.

### Implementation Choice

- Add a workbench preview regression that first resolves `mappedOwner()->first()` through an `AppServiceProvider.php` morph map pointing at `User`.
- Open and edit the provider document so the morph map points at `Post`.
- Verify the next controller completion resolves `Post::getTitle()` instead of the stale cached `User::getName()`.
- Clear the project morph-map model-type cache when a PHP document is edited.

### Acceptance Criteria

- Editing an open PHP provider document invalidates cached project morph-map inference.
- Workbench completions update from the old morph-map target to the edited target without requiring an index reset or workspace reload.
- Existing project morph-map completions, semantic morph-map behavior, full preview tests, `npm run check`, and `git diff --check` pass.

### Verification

- FAIL then fixed: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "refreshes Laravel morph map completions after editing service provider files"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "morph map completions"`
- PASS: `npm test -- src/domain/phpSemanticEngine.test.ts -t "morph map"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `7a22c697 Refresh project morph maps after edits`.

## Slice: Laravel Container Binding Edit Refresh - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `cd66899f Record project morph map edit refresh commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Keep Laravel container-binding completions current after editing an open service provider file.

### Implementation Choice

- Add a workbench preview regression that resolves an interface repository binding from `CommentRepositoryInterface` to `EloquentCommentRepository`, producing `Comment::forceDelete()`.
- Edit the open `AppServiceProvider.php` binding to point the same interface at `CachedCommentRepository`, which returns `ArchivedComment`.
- Clear Laravel container-binding cache when a PHP document changes, and keep navigation reads pointed at the latest open-document content through refs.
- Prefer explicit Laravel container bindings over repository naming convention fallback when resolving method-call return types for assigned variables and chained calls.

### Acceptance Criteria

- Editing an open PHP provider document invalidates cached container binding inference.
- Workbench completions update from the old concrete repository return model to the newly bound concrete return model without requiring an index reset or workspace reload.
- Existing container-binding warm-up, go-to-definition, preview completions, `npm run check`, and `git diff --check` pass.

### Verification

- FAIL then fixed: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "refreshes Laravel container binding completions after editing service provider files"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "container binding"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `7b81bf6b Refresh Laravel container bindings after edits`.

## Slice: Stale Type Hierarchy Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `67f6f79b Record container binding edit refresh commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down the successful-response side of JavaScript/TypeScript type hierarchy isolation when a project tab switch happens while `prepareTypeHierarchy` is in flight.

### Implementation Choice

- Add a preview controller regression for a delayed successful `prepareTypeHierarchy` response from an inactive project tab.
- Start type hierarchy loading in `/workspace-a`, switch to `/workspace-b`, then resolve the stale request with a `StaleUser` item.
- Assert the command resolves, the active workspace remains `/workspace-b`, subtype/supertype calls are not made, and no stale type hierarchy view is opened.
- Keep this as a test-only slice because the controller already guards type hierarchy requests through the requested root/session checks.

### Acceptance Criteria

- A delayed type hierarchy result from an inactive project tab is ignored.
- The active workspace remains `/workspace-b`.
- Stale type hierarchy results do not trigger follow-up hierarchy calls or populate the active view.
- Existing stale type hierarchy error and same-root session restart coverage remain unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "type hierarchy .* switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `a2640877 Cover stale type hierarchy tab results`.

## Slice: Stale Call Hierarchy Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ce0c17f1 Record stale type hierarchy result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down the successful-response side of JavaScript/TypeScript call hierarchy isolation when a project tab switch happens while `prepareCallHierarchy` is in flight.

### Implementation Choice

- Add a preview controller regression for a delayed successful `prepareCallHierarchy` response from an inactive project tab.
- Start call hierarchy loading in `/workspace-a`, switch to `/workspace-b`, then resolve the stale request with a `staleLoadUser` item.
- Assert the command resolves, the active workspace remains `/workspace-b`, incoming/outgoing calls are not requested, and no stale call hierarchy view is opened.
- Keep this as a test-only slice because the controller already guards call hierarchy requests through the requested root/session checks.

### Acceptance Criteria

- A delayed call hierarchy result from an inactive project tab is ignored.
- The active workspace remains `/workspace-b`.
- Stale call hierarchy results do not trigger follow-up hierarchy calls or populate the active view.
- Existing stale call hierarchy error and same-root session restart coverage remain unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "call hierarchy .* switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `e2cba685 Cover stale call hierarchy tab results`.

## Slice: Stale Hierarchy Follow-up Result Guards - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `dc6717c4 Record stale call hierarchy result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down JavaScript/TypeScript hierarchy isolation when the initial hierarchy preparation succeeds before a project tab switch, but the follow-up hierarchy requests finish after the switch.

### Implementation Choice

- Add a call hierarchy regression where `prepareCallHierarchy` returns in `/workspace-a`, `incomingCalls`/`outgoingCalls` remain in flight, the user switches to `/workspace-b`, and the delayed calls resolve afterward.
- Add a type hierarchy regression where `prepareTypeHierarchy` returns in `/workspace-a`, `typeHierarchySupertypes`/`typeHierarchySubtypes` remain in flight, the user switches to `/workspace-b`, and the delayed calls resolve afterward.
- Assert both commands resolve without populating stale hierarchy views in the active workspace.
- Keep this as a test-only slice because the controller already checks the requested root/session after the follow-up requests.

### Acceptance Criteria

- Delayed call hierarchy follow-up results from an inactive project tab are ignored.
- Delayed type hierarchy follow-up results from an inactive project tab are ignored.
- The active workspace remains `/workspace-b` and no stale hierarchy view is populated.
- Existing prepare-result, stale-error, and same-root restart hierarchy guards remain unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "hierarchy .* switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `fd395830 Cover stale hierarchy follow-up tab results`.

## Slice: Stale Workspace Symbol Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a2b0a255 Record stale hierarchy follow-up guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down JavaScript/TypeScript workspace-symbol isolation when Cmd+O class search results arrive after switching project tabs.

### Implementation Choice

- Add a preview controller regression for a delayed successful `workspaceSymbols` response from `/workspace-a`.
- Start `class.quickOpen` in Basic mode, query `User`, switch to `/workspace-b`, then resolve the stale workspace-symbol request with `StaleUser`.
- Assert the active workspace remains `/workspace-b` and the stale symbol does not populate class-open results.
- Keep this as a test-only slice because `searchClassOpenSymbols` already checks the requested root after all symbol searches settle.

### Acceptance Criteria

- Delayed workspace-symbol results from an inactive project tab are ignored.
- The active workspace remains `/workspace-b`.
- Stale workspace symbols do not populate class-open results in the active tab.
- Existing stale workspace-symbol error coverage remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace symbol .* switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `adbdf6de Cover stale workspace symbol tab results`.

## Slice: Stale Indexed Definition Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ff5efbe4 Record stale workspace symbol result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down indexed PHP Go to Definition isolation when a project-symbol search result arrives after switching project tabs.

### Implementation Choice

- Add a preview controller regression for a delayed successful indexed symbol search from `/workspace-a`.
- Start Go to Definition on `CommentsAgent` in `/workspace-a`, switch to `/workspace-b`, then resolve the stale search with `/workspace-a/src/CommentsAgent.php`.
- Assert the active workspace remains `/workspace-b`, the stale target is not opened, no reveal target is set, and the stale open message is not shown.
- Keep this as a test-only slice because the existing navigation path already drops stale opens.

### Acceptance Criteria

- Delayed indexed definition results from an inactive project tab are ignored.
- The active workspace remains `/workspace-b`.
- Stale indexed targets do not open or reveal in the active tab.
- Existing stale indexed error and miss coverage remain unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "indexed go to definition .* switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `b64672d1 Cover stale indexed definition tab results`.

## Slice: Stale JavaScript TypeScript Implementation Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2315cb36 Record stale indexed definition result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down JavaScript/TypeScript Go to Implementation isolation when LSP implementation results arrive after switching project tabs.

### Implementation Choice

- Add a preview controller regression for a delayed successful `implementation` response from `/workspace-a`.
- Start Go to Implementation on `PlatformAdapter::getPlatform`, switch to `/workspace-b`, then resolve the stale implementation location from `/workspace-a`.
- Assert the active workspace remains `/workspace-b`, the stale implementation target is not opened, no implementation chooser is shown, and no reveal target is set.
- Keep this as a test-only slice because the existing navigation path already guards stale implementation results.

### Acceptance Criteria

- Delayed implementation results from an inactive project tab are ignored.
- The active workspace remains `/workspace-b`.
- Stale implementation results do not open a target or populate an implementation chooser in the active tab.
- Existing implementation chooser behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "implementation results after switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `e12aa0ec Cover stale implementation tab results`.

## Slice: Stale JavaScript TypeScript Source Definition Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c024d664 Record stale implementation result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down JavaScript/TypeScript source-definition isolation when LSP source-definition results arrive after switching project tabs.

### Implementation Choice

- Add a preview controller regression for a delayed successful `sourceDefinition` response from `/workspace-a`.
- Start Go to Source Definition from `/workspace-a/src/main.ts`, switch to `/workspace-b`, then resolve the stale target from `/workspace-a/packages/user/src/user.ts`.
- Assert the active workspace remains `/workspace-b`, the stale target is not read/opened, no reveal target is set, and the stale success message is not shown.
- Keep this as a test-only slice because the existing navigation path already guards stale source-definition results.

### Acceptance Criteria

- Delayed source-definition results from an inactive project tab are ignored.
- The active workspace remains `/workspace-b`.
- Stale source-definition targets do not open, reveal, or trigger a file read in the active tab.
- Existing source-definition happy-path behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "source definition results after switching project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `eb2c7ec5 Cover stale source definition tab results`.

## Slice: Stale Indexed PHP Implementation Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `933fa512 Record stale source definition result guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down indexed PHP Go to Implementation fallback isolation when project-symbol results arrive after switching project tabs.

### Implementation Choice

- Capture the requested document and workspace root before indexed PHP implementation fallback starts async work.
- Drop stale results after symbol search, before/after implementation source reads, after inheritance checks, and before chooser/open side effects.
- Add a preview controller regression that starts indexed Go to Implementation in `/workspace-a`, switches to `/workspace-b`, then resolves the stale project-symbol search.
- Assert the stale implementation file is not read, the active workspace remains `/workspace-b`, the target is not opened, and no implementation chooser is shown.

### Acceptance Criteria

- Delayed indexed PHP implementation results from an inactive project tab are ignored.
- Stale implementation candidates from the previous tab do not trigger source reads after tab switch.
- The active workspace remains `/workspace-b`.
- Existing indexed implementation open and chooser behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "indexed PHP implementation"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `52660175 Guard stale indexed PHP implementation results`.

## Slice: Stale PHP Language Server Definition Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `047ef3aa Record stale indexed PHP implementation guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down PHP language-server Go to Definition isolation when definition results arrive after switching project tabs or after a same-root LSP session restart.

### Implementation Choice

- Add PHP language-server runtime status refs and a session-active helper mirroring the JS/TS navigation guard shape.
- Capture the requested PHP document, root, and session before language-server navigation starts async work.
- Drop stale PHP `definition`/`implementation` navigation after document sync, after LSP responses, before chooser/open side effects, and in stale error paths.
- Add preview regressions for delayed PHP definition results after tab switch and after same-root PHP LSP session restart, using an external target that would otherwise open in the active workspace.

### Acceptance Criteria

- Delayed PHP definition results from an inactive project tab are ignored.
- Delayed PHP definition results from a previous same-root LSP session are ignored.
- Stale PHP LSP targets do not trigger target file reads, reveal state, or success messages.
- Existing JavaScript/TypeScript and indexed PHP navigation behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP language server definition"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `22d7320c Guard stale PHP language server navigation results`.

## Slice: Stale Implementation Chooser Target Read Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `434dcfd2 Record stale PHP language server navigation guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale implementation chooser target source reads when project tabs switch while multi-target implementation metadata is being assembled.

### Implementation Choice

- Let `implementationTargetsFromLocations` accept a session/root guard and process targets sequentially.
- Check the guard before each target source read and again before converting a location into an implementation target.
- Pass the PHP and JavaScript/TypeScript session-active guards into their respective implementation chooser paths.
- Add a preview regression where a delayed first JS/TS implementation target read is interrupted by switching from `/workspace-a` to `/workspace-b`, proving the second stale target is never read.

### Acceptance Criteria

- Stale implementation chooser target reads stop after tab switch.
- No implementation chooser is shown for stale multi-target results.
- Existing JS/TS and PHP implementation chooser behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "implementation chooser targets"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `c209c481 Stop stale implementation chooser target reads`.

## Slice: Stale Inherited PHP File Structure Candidate Read Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `94e3ecea Record stale implementation chooser target read guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale inherited PHP file-structure candidate reads after switching project tabs while parent outline resolution is in flight.

### Implementation Choice

- Add a local active-root guard to `loadInheritedPhpFileOutline`.
- Check the guard after reading the child source, before each parent candidate read, after parent source reads, after PHP outline parsing, and before continuing after a failed candidate.
- Add a preview regression with duplicate PSR-4 candidates where the first parent read is delayed, the workspace tab switches, and the first candidate then fails.
- Assert the second stale parent candidate is never read or parsed.

### Acceptance Criteria

- Stale inherited PHP file-structure parent candidate reads stop after tab switch.
- Inactive workspace results do not populate inherited file-structure state.
- Existing inherited/current file-structure behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "inherited PHP file structure"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `c722dd0b Stop stale inherited PHP structure reads`.

## Slice: Stale PHP Method Provider Result Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d3846043 Record stale inherited PHP structure read guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP method completion and signature provider results from being returned after switching project tabs.

### Implementation Choice

- Capture the requested workspace root at the start of `providePhpMethodCompletions` and `providePhpMethodSignature`.
- Return an empty completion list or `null` signature when the active workspace root changes during async provider work.
- Check the guard after named-route, relation, static method, receiver method, and signature method resolution awaits.
- Add a preview regression where a delayed service class read is interrupted by switching from `/workspace-a` to `/workspace-b`, proving the stale method completion resolves to `[]`.

### Acceptance Criteria

- PHP method completions do not return stale results after tab switch.
- PHP method signatures share the same root guard.
- Existing PHP semantic completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP method completions"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `ac3f8326 Guard stale PHP method provider results`.

## Slice: Stale Contextual PHP Class Navigation Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c84e17bb Record stale PHP method provider guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale contextual PHP class navigation targets from opening after switching project tabs.

### Implementation Choice

- Capture the requested root, descriptor, and source path in `openPhpClassTarget`.
- Guard after indexed project-symbol search, before opening indexed targets, before PSR-4 fallback reads, after fallback reads, and before continuing after fallback errors.
- Use the captured root and descriptor for all candidate resolution.
- Add a preview regression where Go to Definition starts on `CommentsAgent` in `/workspace-a`, switches to `/workspace-b`, then resolves the stale index target to an external file that would otherwise open in the active workspace.

### Acceptance Criteria

- Stale contextual PHP class targets are ignored after tab switch.
- Stale external targets are not read, opened, or revealed in the active workspace.
- Existing indexed and contextual PHP definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "contextual PHP class targets"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `20dbbd02 Guard stale contextual PHP class navigation`.

## Slice: Stale Contextual PHP Method Navigation Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `078d023e Record stale contextual PHP class navigation guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale contextual PHP method navigation targets from opening after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `openDirectPhpMethodTarget`.
- Guard after indexed method symbol search, before opening indexed method targets, before/after class hierarchy source reads, before hierarchy target opens, after hierarchy read failures, and after framework binding resolution.
- Add a preview regression where Go to Definition starts on `$this->commentsService->create()` in `/workspace-a`, switches to `/workspace-b`, then resolves the stale method index target to an external file.

### Acceptance Criteria

- Stale contextual PHP method targets are ignored after tab switch.
- Stale external method targets are not read, opened, or revealed in the active workspace.
- Existing contextual PHP method definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "contextual PHP method targets"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `87cf8052 Guard stale contextual PHP method navigation`.

## Slice: Stale Contextual PHP Property Navigation Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `82b8751f Record stale contextual PHP method navigation guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale contextual PHP property navigation targets from opening after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `openDirectPhpPropertyTarget`.
- Guard before/after class hierarchy source reads, before property target opens, and after hierarchy read failures.
- Add a preview regression where Go to Definition starts on `$comment->externalId` in `/workspace-a`, switches to `/workspace-b` after the earlier property-existence/method fallback reads, then proves the stale property target read is not started.

### Acceptance Criteria

- Stale contextual PHP property targets are ignored after tab switch.
- Stale property target reads do not continue after tab switch.
- Existing contextual PHP property definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "contextual PHP property targets"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `b01045f8 Guard stale contextual PHP property navigation`.

## Slice: Stale Laravel Model Attribute Target Candidate Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `976d57fe Record stale contextual PHP property navigation guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel model-attribute target candidate reads after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `openPhpLaravelModelAttributeTarget`.
- Guard before each class source read, after source reads, before target opens, and after failed candidate reads.
- Add a preview regression where Go to Definition starts on `$comment->content` in `/workspace-a`, the model attribute source read is delayed, the workspace switches to `/workspace-b`, and the delayed read fails.
- Assert no additional package candidate read is started after the tab switch.

### Acceptance Criteria

- Stale Laravel model-attribute target candidate reads stop after tab switch.
- Stale attribute targets are not opened or revealed in the active workspace.
- Existing Laravel attribute/property definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Laravel model attribute target candidates"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `f2fac6ea Guard stale Laravel model attribute targets`.

## Slice: Stale Laravel Dynamic Where Target Candidate Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `73395720 Record stale Laravel model attribute guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel dynamic-where target candidate reads after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `openPhpLaravelDynamicWhereTarget`.
- Guard before each class source read, after source reads, before target opens, and after failed candidate reads.
- Add a preview regression where Go to Definition starts on `Comment::whereContent()` in `/workspace-a`, the dynamic-where model source read is delayed, the workspace switches to `/workspace-b`, and the delayed read fails.
- Assert no additional package candidate read is started after the tab switch.

### Acceptance Criteria

- Stale Laravel dynamic-where target candidate reads stop after tab switch.
- Stale dynamic-where targets are not opened or revealed in the active workspace.
- Existing Laravel dynamic-where definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Laravel dynamic where target candidates"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `226dd56f Guard stale Laravel dynamic where targets`.

## Slice: Stale Laravel Request Method Hint Target Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `09a0f0ac Record stale Laravel dynamic where guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel request method-hint targets from opening after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `openPhpMethodHintTarget`.
- Guard before Laravel request method hint candidate reads, after source reads, before target opens, and after failed candidate reads.
- Add a preview regression where Go to Definition starts on `$request->input()` in `/workspace-a`, the Laravel `InteractsWithInput` source read is delayed, the workspace switches to `/workspace-b`, and the delayed read resolves.
- Assert the stale Laravel trait target is not opened or revealed in the active workspace.

### Acceptance Criteria

- Stale Laravel request method-hint targets are ignored after tab switch.
- Existing Laravel request helper definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Laravel request method hint"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `1d80f537 Guard stale Laravel request method hint targets`.

## Slice: Stale Laravel Named Route Definition Target Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a7c9aea4 Record stale Laravel request method hint guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel named-route definition targets from opening after switching project tabs.

### Implementation Choice

- Capture the requested root in `collectPhpLaravelNamedRouteTargets`.
- Guard after named-route text search, before route file reads, after route file reads, after failed reads, and before returning sorted targets.
- Guard `goToPhpLaravelNamedRouteDefinition` after target collection and immediately before opening the route definition.
- Add a preview regression where Go to Definition starts on `route('comments.show')` in `/workspace-a`, the route definition file read is delayed, the workspace switches to `/workspace-b`, and the delayed read resolves.

### Acceptance Criteria

- Stale Laravel named-route targets are ignored after tab switch.
- Stale named-route definition files are not opened or revealed in the active workspace.
- Existing Laravel named-route definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale Laravel named route definition"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `915ab10f Guard stale Laravel named route targets`.

## Slice: Stale Laravel Relation String Owner Resolution Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2387e248 Record stale Laravel named route guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel relation-string owner resolution from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root in `resolvePhpLaravelRelationPathOwnerType` and stop nested relation owner resolution when the active workspace changes.
- Capture the requested root in `goToPhpLaravelRelationStringDefinition`.
- Guard after each async owner/type resolution step, before stale not-found messages, before opening the relation target, and after target open attempts.
- Add a preview regression where Go to Definition starts on `Comment::with('children.parent')` in `/workspace-a`, the nested owner model read is delayed, the workspace switches to `/workspace-b`, and the delayed read resolves.
- Assert the stale command does not continue into `/workspace-b` relation target reads, open a relation model, reveal a target, or publish a stale not-found message.

### Acceptance Criteria

- Stale Laravel relation-string owner resolution stops after tab switch.
- Stale relation target reads are not started in the newly active workspace by an old command.
- Existing Laravel relation-string definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale Laravel relation string owner"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `73d5400a Guard stale Laravel relation string targets`.

## Slice: Stale Laravel Relation String Completion Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `09924da8 Record stale Laravel relation string guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel relation-string completion traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `collectPhpLaravelRelationCompletionsForClass`.
- Guard before class source reads, after source reads, after trait/mixin/parent recursion, after failed reads, and before returning relation completions.
- Add a preview regression where relation completions start for `Comment::with('par')` in `/workspace-a`, the model source read is delayed, the workspace switches to `/workspace-b`, and the delayed read resolves.
- Assert the stale completion request returns no suggestions and does not continue into `/workspace-b` parent model reads.

### Acceptance Criteria

- Stale Laravel relation-string completion traversal stops after tab switch.
- Stale completion requests do not start follow-up class reads in the newly active workspace.
- Existing Laravel relation-string completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale Laravel relation string completion traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `1047e268 Guard stale Laravel relation completions`.

## Slice: Stale PHP Class Source Resolver Fallback Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e46d1031 Record stale Laravel relation completion guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP class source path resolution from falling back into the newly active workspace after switching project tabs.

### Implementation Choice

- Capture the requested root in `findPhpClassSourcePathsByFileName`.
- Guard after file search, before/after candidate source reads, after failed reads, and before returning fallback paths.
- Capture the requested root and descriptor in `resolvePhpClassSourcePaths`.
- Guard after indexed symbol search, while processing index results, before/after file-name fallback, and before returning resolved paths.
- Add a preview regression where PHP method completions start in `/workspace-a`, indexed class lookup is delayed, the workspace switches to `/workspace-b`, and the delayed indexed lookup returns no symbols.
- Assert the stale completion request returns no suggestions and does not start a `/workspace-b` file-name fallback search.

### Acceptance Criteria

- Stale PHP class source path resolution stops after tab switch.
- Stale class resolver misses do not start fallback file searches in the newly active workspace.
- Existing PHP method completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP class source resolver fallback"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `2118c6c9 Guard stale PHP class source resolver fallback`.

## Slice: Stale PHP Method Completion Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6d4fc323 Record stale PHP class source resolver guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP method completion traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `collectPhpMethodsForClass`.
- Guard before class source reads, after class member reads, after inherited template resolution, after trait/mixin/supertype recursion, after failed reads, before framework-bound concrete resolution, and before returning method completions.
- Add a preview regression where method completions start in `/workspace-a`, a service class read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends a base service.
- Assert the stale completion request returns no suggestions and does not continue into `/workspace-b` base service reads.

### Acceptance Criteria

- Stale PHP method completion traversal stops after tab switch.
- Stale method completion requests do not start inherited class reads in the newly active workspace.
- Existing PHP method completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP method completion traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `a0124315 Guard stale PHP method completion traversal`.

## Slice: Stale PHP Property Relation Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b81f5de7 Record stale PHP method completion guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP property/relation type traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `resolvePhpClassPropertyOrRelationType`.
- Guard before class source reads, after member reads, after morph-map resolution, after trait/mixin/supertype recursion, after failed reads, and before returning from the resolver.
- Add a preview regression where Go to Definition starts on `Comment::with('children.parent')` in `/workspace-a`, the owner model read is delayed, the workspace switches to `/workspace-b`, and the delayed owner source extends `BaseComment`.
- Assert the stale resolver does not continue into `/workspace-b` base model reads or reveal a target.

### Acceptance Criteria

- Stale PHP property/relation type traversal stops after tab switch.
- Stale relation owner resolution does not start inherited model reads in the newly active workspace.
- Existing Laravel relation-string definition behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale Laravel relation property owner traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `c3583f1a Guard stale PHP property relation traversal`.

## Slice: Stale PHP Collection Model Type Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6aea1328 Record stale PHP property relation guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP collection model type traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `resolvePhpCollectionModelTypeFromClass`.
- Guard before class source reads, after collection source reads, after parent collection recursion, after failed reads, and before returning the resolved model type.
- Add a preview regression where method completions start from a documented `AlbumCollection` variable in `/workspace-a`, the collection class read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends `BaseAlbumCollection`.
- Assert the stale completion request returns no suggestions and does not continue into `/workspace-b` base collection reads.

### Acceptance Criteria

- Stale PHP collection model type traversal stops after tab switch.
- Stale collection completion requests do not start inherited collection reads in the newly active workspace.
- Existing Laravel collection model completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP collection model type traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `1421efa5 Guard stale PHP collection model traversal`.

## Slice: Stale PHP Method Return Type Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c5451178 Record stale PHP collection model guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP method return type traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `resolvePhpMethodReturnType`.
- Guard after framework-bound concrete resolution, after class member reads, after morph-map resolution, after return expression resolution, after inherited template resolution, after trait/mixin/supertype recursion, after failed reads, and before bound-concrete fallback returns.
- Add a preview regression where method completions start from a repository call in `/workspace-a`, the repository class read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends `BaseCommentRepository`.
- Assert the stale completion request returns no suggestions and does not continue into `/workspace-b` base repository reads.

### Acceptance Criteria

- Stale PHP method return type traversal stops after tab switch.
- Stale return type inference does not start inherited repository reads in the newly active workspace.
- Existing PHP method return completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP method return type traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `8165b764 Guard stale PHP method return traversal`.

## Slice: Stale PHP Method Hierarchy Diagnostic Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c9b68894 Record stale PHP method return guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP method hierarchy diagnostic traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `phpClassHierarchyHasMethod`.
- Guard before hierarchy source reads, after member reads, after trait/mixin/supertype recursion, after failed reads, and before returning from the helper.
- Add a preview regression where a PHP diagnostic from `/workspace-a` starts checking `App\\Models\\Comment::knownHook()`, the model source read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends `BaseComment`.
- Assert the stale diagnostic traversal does not continue into `/workspace-b` base model reads.

### Acceptance Criteria

- Stale PHP method hierarchy diagnostic traversal stops after tab switch.
- Stale diagnostics do not start inherited class reads in the newly active workspace.
- Existing PHP diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP method hierarchy diagnostic traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `5f785353 Guard stale PHP method hierarchy diagnostics`.

## Slice: Stale PHP Static Method Hierarchy Diagnostic Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `830c5e34 Record stale PHP method hierarchy guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP static method hierarchy diagnostic traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `phpClassHierarchyHasStaticMethod`.
- Guard before hierarchy source reads, after member reads, after trait/mixin/supertype recursion, after failed reads, and before returning from the helper.
- Add a preview regression where a PHP diagnostic from `/workspace-a` starts checking `App\\Factories\\CommentFactory::make()`, the factory source read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends `BaseCommentFactory`.
- Assert the stale diagnostic traversal does not continue into `/workspace-b` base factory reads.

### Acceptance Criteria

- Stale PHP static method hierarchy diagnostic traversal stops after tab switch.
- Stale static-method diagnostics do not start inherited class reads in the newly active workspace.
- Existing PHP static method diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP static method hierarchy diagnostic traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `9bd9c8fd Guard stale PHP static hierarchy diagnostics`.

## Slice: Stale PHP Property Hierarchy Diagnostic Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f4a35c0a Record stale PHP static hierarchy guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP property hierarchy diagnostic traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `phpClassHierarchyHasProperty`.
- Guard before hierarchy source reads, after member reads, after trait/mixin/supertype recursion, after failed reads, and before returning from the helper.
- Add a preview regression where a PHP diagnostic from `/workspace-a` starts checking `App\\Models\\Comment::$externalId`, the model source read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends `BaseComment`.
- Assert the stale diagnostic traversal does not continue into `/workspace-b` base model reads.

### Acceptance Criteria

- Stale PHP property hierarchy diagnostic traversal stops after tab switch.
- Stale property diagnostics do not start inherited class reads in the newly active workspace.
- Existing PHP property diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP property hierarchy diagnostic traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `a51c286e Guard stale PHP property hierarchy diagnostics`.

## Slice: Stale PHP Constant Hierarchy Diagnostic Traversal Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `dac7be20 Record stale PHP property hierarchy guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP constant hierarchy diagnostic traversal from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root and descriptor in `phpClassHierarchyHasConstant`.
- Guard before hierarchy source reads, after member reads, after trait/mixin/supertype recursion, after failed reads, and before returning from the helper.
- Add a preview regression where a trait-host constant diagnostic from `/workspace-a` starts checking `App\\Support\\HostState::HOST_STATE`, the hierarchy host source read is delayed, the workspace switches to `/workspace-b`, and the delayed source extends `BaseHostState`.
- Assert the stale diagnostic traversal does not continue into `/workspace-b` base host reads.

### Acceptance Criteria

- Stale PHP constant hierarchy diagnostic traversal stops after tab switch.
- Stale constant diagnostics do not start inherited class reads in the newly active workspace.
- Existing PHP trait-host constant diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP constant hierarchy diagnostic traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `359ecf6c Guard stale PHP constant hierarchy diagnostics`.

## Slice: Stale PHP Trait Host Method Search Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c30b44e9 Record stale PHP constant hierarchy guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP trait host-method searches from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root in `phpTraitHostMethodExists`.
- Run trait-host and descendant host text searches against the requested root.
- Guard after text search, before and after candidate host reads, after recursive trait and descendant hierarchy checks, after failed reads, and before returning from the helper.
- Add a preview regression where a trait method diagnostic from `/workspace-a` starts a delayed host text search, the workspace switches to `/workspace-b`, and the delayed search returns a host candidate.
- Assert the stale diagnostic traversal does not read the stale host candidate.

### Acceptance Criteria

- Stale PHP trait host-method searches stop after tab switch.
- Stale trait diagnostics do not start host file reads after workspace changes.
- Existing PHP trait host-method diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP trait host-method search"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `da3149f7 Guard stale PHP trait host method search`.

## Slice: Stale PHP Trait Host Property Search Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `19b9aeb1 Record stale PHP trait host method guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP trait host-property searches from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root in `phpTraitHostPropertyExists`.
- Run trait-host and descendant host text searches against the requested root.
- Guard after text search, before and after candidate host reads, after recursive trait and descendant hierarchy checks, after failed reads, and before returning from the helper.
- Add a preview regression where a trait property diagnostic from `/workspace-a` starts a delayed host text search, the workspace switches to `/workspace-b`, and the delayed search returns a host candidate.
- Assert the stale diagnostic traversal does not read the stale host candidate.

### Acceptance Criteria

- Stale PHP trait host-property searches stop after tab switch.
- Stale trait property diagnostics do not start host file reads after workspace changes.
- Existing PHP trait host-property diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP trait host-property search"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `d1c560c4 Guard stale PHP trait host property search`.

## Slice: Stale PHP Trait Host Constant Search Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f9e34cdf Record stale PHP trait host property guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale PHP trait host-constant searches from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root in `phpTraitHostConstantExists`.
- Run trait-host and descendant host text searches against the requested root.
- Guard after text search, before and after candidate host reads, after recursive trait and descendant hierarchy checks, after failed reads, and before returning from the helper.
- Add a preview regression where a trait constant diagnostic from `/workspace-a` starts a delayed host text search, the workspace switches to `/workspace-b`, and the delayed search returns a host candidate.
- Assert the stale diagnostic traversal does not read the stale host candidate.

### Acceptance Criteria

- Stale PHP trait host-constant searches stop after tab switch.
- Stale trait constant diagnostics do not start host file reads after workspace changes.
- Existing PHP trait host-constant diagnostic filtering behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP trait host-constant search"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `25954382 Guard stale PHP trait host constant search`.

## Slice: Stale Laravel Morph Map Search Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `7716d400 Record stale PHP trait host constant guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel morph map searches from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root in `resolvePhpLaravelProjectMorphMapModelType`.
- Run `morphMap` and `enforceMorphMap` text searches against the requested root.
- Guard before cache lookup, after parallel text search, before and after provider reads, after failed reads, and before writing the morph map model cache.
- Add a preview regression where morph map completion inference from `/workspace-a` starts a delayed `morphMap` search, the workspace switches to `/workspace-b`, and the delayed search returns a service provider candidate.
- Assert stale inference resolves without reading the stale provider candidate.

### Acceptance Criteria

- Stale Laravel morph map searches stop after tab switch.
- Stale morph map inference does not read or cache provider files after workspace changes.
- Existing Laravel morph map completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale Laravel morph map search"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `2f142c95 Guard stale Laravel morph map search`.

## Slice: Stale Laravel Container Binding Search Guard - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d0e15eb6 Record stale Laravel morph map guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Stop stale Laravel container binding searches from continuing after switching project tabs.

### Implementation Choice

- Capture the requested root in `resolvePhpFrameworkBoundConcrete`.
- Run binding text search against the requested root.
- Guard before cache lookup, after text search, before and after provider reads, after failed reads, and before writing the framework binding cache.
- Add a preview regression where repository completion inference from `/workspace-a` starts a delayed binding search, the workspace switches to `/workspace-b`, and the delayed search returns a service provider candidate.
- Assert stale inference resolves without reading or caching the stale provider candidate.

### Acceptance Criteria

- Stale Laravel container binding searches stop after tab switch.
- Stale binding inference does not read or cache provider files after workspace changes.
- Existing Laravel container binding completion behavior remains unchanged.
- Focused/full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale Laravel container binding search"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `7151cbb8 Guard stale Laravel container binding search`.

## Slice: Returnless PHPDoc Magic Method Completions - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e8ec223f Record stale Laravel container binding guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Improve PhpStorm-like PHPDoc magic method support for projects that omit explicit return types in `@method` annotations.

### Implementation Choice

- Replace the narrow `@method returnType name(...)` parser with a tolerant line parser that finds the method name before `(`.
- Treat a leading `static` token as the magic-method static modifier.
- Preserve explicit return types when present and use `null` when the PHPDoc line omits the return type.
- Add domain coverage for returnless instance and static `@method` annotations.
- Add workbench preview coverage proving inferred interface PHPDoc methods without return types appear in method completions.

### Acceptance Criteria

- Returnless PHPDoc magic methods appear in PHP method completions.
- Existing PHPDoc magic method parsing with explicit return types remains unchanged.
- Focused/full PHP method completion tests, preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/application/useWorkbenchController.preview.test.tsx -t "returnless PHPDoc|PHPDoc magic methods without explicit return types"`
- PASS: `npm test -- src/domain/phpMethodCompletions.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `b6deb264 Support returnless PHPDoc magic methods`.

## Slice: Returnless PHPDoc Magic Method Navigation Coverage - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `63ed26d5 Record returnless PHPDoc magic method commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down Cmd+B / Go to Definition behavior for static PHPDoc magic methods that omit explicit return types.

### Implementation Choice

- Extend domain navigation coverage for `@method static findForSlug(...)`.
- Extend the workbench PHPDoc magic method definition regression so `CommentFactory::findForSlug()` opens the returnless PHPDoc method line.
- Keep the slice coverage-only because the current navigation parser already accepted optional return types.

### Acceptance Criteria

- Returnless static PHPDoc magic methods have discoverable definition positions.
- Workbench Go to Definition opens the returnless PHPDoc method annotation.
- Existing PHPDoc magic method navigation remains unchanged.
- Focused/full navigation and preview tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "PHPDoc magic method definitions"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `acef2408 Cover returnless PHPDoc magic method navigation`.

## Slice: Returnless PHPDoc Magic Method Diagnostic Coverage - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `dc6d777c Record returnless PHPDoc magic navigation commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Lock down contextual diagnostic filtering for returnless PHPDoc magic methods inherited through implemented interfaces.

### Implementation Choice

- Extend the existing implemented-interface PHPDoc method diagnostic regression.
- Add a returnless `@method archive()` annotation and matching `$comment->archive()` diagnostic.
- Keep the expected diagnostics limited to the genuinely missing method.
- Keep the slice coverage-only because returnless PHPDoc parsing now flows through the existing hierarchy diagnostic filter.

### Acceptance Criteria

- Returnless PHPDoc magic methods suppress matching false-positive method diagnostics.
- Existing explicit-return PHPDoc diagnostic filtering remains unchanged.
- Focused/full preview tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "implemented interface PHPDoc method diagnostics"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `5288432c Cover returnless PHPDoc method diagnostics`.

## Slice: Spaced Generic PHPDoc Magic Method Navigation - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8e7fa239 Record returnless PHPDoc diagnostic commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Make Cmd+B / Go to Definition find PHPDoc magic methods whose return type contains spaced generic arguments.

### Implementation Choice

- Replace the PHPDoc method definition regex with a per-line parser that identifies the method name immediately before the first `(`.
- Add domain coverage for a `@method \\Illuminate\\Support\\Collection<int, Comment> activeComments()` annotation.
- Extend workbench PHPDoc magic method navigation coverage so `CommentFactory::activeComments()` opens the spaced-generic PHPDoc method line.

### Acceptance Criteria

- PHPDoc magic method navigation works with spaced generic return types.
- Existing explicit-return and returnless PHPDoc magic method navigation remains unchanged.
- Focused/full navigation and preview tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx -t "PHPDoc magic method definitions"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Committed as `152df127 Support spaced generic PHPDoc method navigation`.

## Slice: Laravel LoadMorph Aggregate Relation Strings - 2026-06-21

### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `26989ce0 Record spaced generic PHPDoc navigation commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

### Goal

- Make Laravel relation-string navigation and completion recognize aggregate `loadMorph*` relation methods.

### Implementation Choice

- Extend the existing Laravel relation-string method allowlist with `loadMorphAggregate`, `loadMorphAvg`, `loadMorphMax`, `loadMorphMin`, and `loadMorphSum`.
- Add domain coverage for first-argument relation detection across all five methods.
- Add completion-context coverage for an incomplete `loadMorphAvg` first argument while preserving non-relation argument filtering.

### Acceptance Criteria

- Relation strings in aggregate `loadMorph*` calls resolve to Laravel relation-string contexts.
- Completion context works in the first argument of aggregate `loadMorph*` calls.
- Existing Laravel relation-string parsing remains unchanged.
- Focused/full navigation tests, `npm run check`, and `git diff --check` pass.

### Verification

- PASS: `npm test -- src/domain/phpNavigation.test.ts -t "Laravel relation string"`
- PASS: `npm test -- src/domain/phpNavigation.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status

- Pending commit.
