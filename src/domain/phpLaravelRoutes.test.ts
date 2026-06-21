import { describe, expect, it } from "vitest";
import {
  phpLaravelNamedRouteDefinitions,
  phpLaravelNamedRouteReferenceContextAt,
} from "./phpLaravelRoutes";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length,
    lineNumber: lines.length,
  };
}

function cursorAfter(source: string, needle: string) {
  const position = positionAfter(source, needle);

  return {
    column: position.column + 1,
    lineNumber: position.lineNumber,
  };
}

function positionOf(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

function expectedRouteDefinitions(
  source: string,
  routeName: string,
  actions: string[],
  positionNeedle = routeName,
) {
  return actions.map((action) => ({
    name: `${routeName}.${action}`,
    position: positionOf(source, positionNeedle),
  }));
}

describe("phpLaravelRoutes", () => {
  it("detects Laravel named-route references in supported first string arguments", () => {
    const source = `<?php
route('comments.show', ['comment' => $comment]);
to_route("comments.index");
redirect()->route('comments.edit');
redirect()->signedRoute('comments.edit-signed');
redirect()->temporarySignedRoute('comments.edit-expiring', now()->addHour());
Redirect::route('comments.preview');
Redirect::signedRoute('comments.preview-signed');
Redirect::temporarySignedRoute('comments.preview-temporary', now()->addHour());
URL::route('comments.feed');
URL::signedRoute('comments.unsubscribe');
URL::temporarySignedRoute('comments.preview-expiring', now()->addHour());
Uri::route('comments.uri');
Uri::signedRoute('comments.secure');
Uri::temporarySignedRoute('comments.secure-expiring', now()->addHour());
Route::has('comments.destroy');
`;

    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.sh"),
      ),
    ).toEqual({
      call: "route",
      name: "comments.show",
      position: positionOf(source, "comments.show"),
      prefix: "comments.sh",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.index"),
      ),
    ).toEqual({
      call: "to_route",
      name: "comments.index",
      position: positionOf(source, "comments.index"),
      prefix: "comments.index",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.edit"),
      ),
    ).toEqual({
      call: "redirect()->route",
      name: "comments.edit",
      position: positionOf(source, "comments.edit"),
      prefix: "comments.edit",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.edit-signed"),
      ),
    ).toEqual({
      call: "redirect()->signedRoute",
      name: "comments.edit-signed",
      position: positionOf(source, "comments.edit-signed"),
      prefix: "comments.edit-signed",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.edit-expiring"),
      ),
    ).toEqual({
      call: "redirect()->temporarySignedRoute",
      name: "comments.edit-expiring",
      position: positionOf(source, "comments.edit-expiring"),
      prefix: "comments.edit-expiring",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.preview"),
      ),
    ).toEqual({
      call: "Redirect::route",
      name: "comments.preview",
      position: positionOf(source, "comments.preview"),
      prefix: "comments.preview",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.preview-signed"),
      ),
    ).toEqual({
      call: "Redirect::signedRoute",
      name: "comments.preview-signed",
      position: positionOf(source, "comments.preview-signed"),
      prefix: "comments.preview-signed",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.preview-temporary"),
      ),
    ).toEqual({
      call: "Redirect::temporarySignedRoute",
      name: "comments.preview-temporary",
      position: positionOf(source, "comments.preview-temporary"),
      prefix: "comments.preview-temporary",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.feed"),
      ),
    ).toEqual({
      call: "URL::route",
      name: "comments.feed",
      position: positionOf(source, "comments.feed"),
      prefix: "comments.feed",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.unsubscribe"),
      ),
    ).toEqual({
      call: "URL::signedRoute",
      name: "comments.unsubscribe",
      position: positionOf(source, "comments.unsubscribe"),
      prefix: "comments.unsubscribe",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.preview-expiring"),
      ),
    ).toEqual({
      call: "URL::temporarySignedRoute",
      name: "comments.preview-expiring",
      position: positionOf(source, "comments.preview-expiring"),
      prefix: "comments.preview-expiring",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.uri"),
      ),
    ).toEqual({
      call: "Uri::route",
      name: "comments.uri",
      position: positionOf(source, "comments.uri"),
      prefix: "comments.uri",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.secure"),
      ),
    ).toEqual({
      call: "Uri::signedRoute",
      name: "comments.secure",
      position: positionOf(source, "comments.secure"),
      prefix: "comments.secure",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.secure-expiring"),
      ),
    ).toEqual({
      call: "Uri::temporarySignedRoute",
      name: "comments.secure-expiring",
      position: positionOf(source, "comments.secure-expiring"),
      prefix: "comments.secure-expiring",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.destroy"),
      ),
    ).toEqual({
      call: "Route::has",
      name: "comments.destroy",
      position: positionOf(source, "comments.destroy"),
      prefix: "comments.destroy",
    });
  });

  it("detects Laravel named-route references in supported named arguments", () => {
    const source = `<?php
route(name: 'comments.show', parameters: ['comment' => $comment]);
to_route(route: 'comments.index');
URL::signedRoute(name: 'comments.secure', parameters: ['comment' => $comment]);
redirect()->temporarySignedRoute(route: 'comments.preview', expiration: now()->addHour());
Route::has(name: 'comments.destroy');
`;

    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.show"),
      ),
    ).toEqual({
      call: "route",
      name: "comments.show",
      position: positionOf(source, "comments.show"),
      prefix: "comments.show",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.index"),
      ),
    ).toEqual({
      call: "to_route",
      name: "comments.index",
      position: positionOf(source, "comments.index"),
      prefix: "comments.index",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.secure"),
      ),
    ).toEqual({
      call: "URL::signedRoute",
      name: "comments.secure",
      position: positionOf(source, "comments.secure"),
      prefix: "comments.secure",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.preview"),
      ),
    ).toEqual({
      call: "redirect()->temporarySignedRoute",
      name: "comments.preview",
      position: positionOf(source, "comments.preview"),
      prefix: "comments.preview",
    });
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.destroy"),
      ),
    ).toEqual({
      call: "Route::has",
      name: "comments.destroy",
      position: positionOf(source, "comments.destroy"),
      prefix: "comments.destroy",
    });
  });

  it("ignores non-first arguments and unsupported route-like calls", () => {
    const source = `<?php
route('comments.show', ['label' => 'not.a.route']);
$router->route('comments.member');
Route::get('/comments')->name('comments.definition');
redirect()->away('comments.away');
route(label: 'comments.label');
redirect()->route(name: 'comments.redirect-name');
URL::route(route: 'comments.url-route');
`;

    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "not.a.route"),
      ),
    ).toBeNull();
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.member"),
      ),
    ).toBeNull();
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.definition"),
      ),
    ).toBeNull();
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.away"),
      ),
    ).toBeNull();
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.label"),
      ),
    ).toBeNull();
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.redirect-name"),
      ),
    ).toBeNull();
    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.url-route"),
      ),
    ).toBeNull();
  });

  it("supports incomplete first string arguments for completion context", () => {
    const source = `<?php
return route('comments.sh
`;

    expect(
      phpLaravelNamedRouteReferenceContextAt(
        source,
        cursorAfter(source, "comments.sh"),
      ),
    ).toEqual({
      call: "route",
      name: "comments.sh",
      position: positionOf(source, "comments.sh"),
      prefix: "comments.sh",
    });
  });

  it("extracts literal names from chained Laravel route definitions", () => {
    const source = `<?php
use Illuminate\\Support\\Facades\\Route;

Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->middleware('auth')
    ->name('comments.show');

Route::post('/comments', [CommentController::class, 'store'])->name("comments.store");
Route::view('/dashboard', 'dashboard')->name('dashboard.index');
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "comments.show",
        position: positionOf(source, "comments.show"),
      },
      {
        name: "comments.store",
        position: positionOf(source, "comments.store"),
      },
      {
        name: "dashboard.index",
        position: positionOf(source, "dashboard.index"),
      },
    ]);
  });

  it("extracts literal names from named route definition arguments", () => {
    const source = `<?php
Route::name(name: 'admin.')->group(function () {
    Route::get('/dashboard', DashboardController::class)->name(name: 'dashboard');
});

Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name(name: 'comments.show');

Route::get('/ignored', IgnoredController::class)->name(label: 'comments.ignored');
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "admin.dashboard",
        position: positionOf(source, "dashboard');"),
      },
      {
        name: "comments.show",
        position: positionOf(source, "comments.show"),
      },
    ]);
  });

  it("combines group prefixes and ignores dynamic/unrelated route names", () => {
    const source = `<?php
Route::name('admin.')->group(function () {
    Route::get('/dashboard', DashboardController::class)->name('dashboard');
});
Route::get('/comments/{comment}', [CommentController::class, 'show'])->name('comments.' . $suffix);
$builder->name('not.a.route');
// Route::get('/draft')->name('comments.draft');
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "admin.dashboard",
        position: positionOf(source, "dashboard');"),
      },
    ]);
  });

  it("expands literal Laravel resource route names", () => {
    const source = `<?php
Route::resource('comments', CommentController::class);
Route::apiResource('api.comments', ApiCommentController::class);
Route::name('admin.')->group(function () {
    Route::resource('reports', ReportController::class);
});
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "comments.index",
        position: positionOf(source, "comments"),
      },
      {
        name: "comments.create",
        position: positionOf(source, "comments"),
      },
      {
        name: "comments.store",
        position: positionOf(source, "comments"),
      },
      {
        name: "comments.show",
        position: positionOf(source, "comments"),
      },
      {
        name: "comments.edit",
        position: positionOf(source, "comments"),
      },
      {
        name: "comments.update",
        position: positionOf(source, "comments"),
      },
      {
        name: "comments.destroy",
        position: positionOf(source, "comments"),
      },
      {
        name: "api.comments.index",
        position: positionOf(source, "api.comments"),
      },
      {
        name: "api.comments.store",
        position: positionOf(source, "api.comments"),
      },
      {
        name: "api.comments.show",
        position: positionOf(source, "api.comments"),
      },
      {
        name: "api.comments.update",
        position: positionOf(source, "api.comments"),
      },
      {
        name: "api.comments.destroy",
        position: positionOf(source, "api.comments"),
      },
      {
        name: "admin.reports.index",
        position: positionOf(source, "reports"),
      },
      {
        name: "admin.reports.create",
        position: positionOf(source, "reports"),
      },
      {
        name: "admin.reports.store",
        position: positionOf(source, "reports"),
      },
      {
        name: "admin.reports.show",
        position: positionOf(source, "reports"),
      },
      {
        name: "admin.reports.edit",
        position: positionOf(source, "reports"),
      },
      {
        name: "admin.reports.update",
        position: positionOf(source, "reports"),
      },
      {
        name: "admin.reports.destroy",
        position: positionOf(source, "reports"),
      },
    ]);
  });

  it("expands literal Laravel singleton route names", () => {
    const source = `<?php
Route::singleton('profile', ProfileController::class);
Route::apiSingleton('api.profile', ApiProfileController::class);
Route::name('admin.')->group(function () {
    Route::singleton('reports.thumbnail', ReportThumbnailController::class);
});
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "profile.show",
        position: positionOf(source, "profile"),
      },
      {
        name: "profile.edit",
        position: positionOf(source, "profile"),
      },
      {
        name: "profile.update",
        position: positionOf(source, "profile"),
      },
      {
        name: "api.profile.show",
        position: positionOf(source, "api.profile"),
      },
      {
        name: "api.profile.update",
        position: positionOf(source, "api.profile"),
      },
      {
        name: "admin.reports.thumbnail.show",
        position: positionOf(source, "reports.thumbnail"),
      },
      {
        name: "admin.reports.thumbnail.edit",
        position: positionOf(source, "reports.thumbnail"),
      },
      {
        name: "admin.reports.thumbnail.update",
        position: positionOf(source, "reports.thumbnail"),
      },
    ]);
  });

  it("expands literal Laravel resource array route names", () => {
    const source = `<?php
Route::resources([
    'photos' => PhotoController::class,
    'posts.comments' => [PostCommentController::class, 'index'],
]);
Route::apiResources([
    'api.photos' => ApiPhotoController::class,
]);
Route::softDeletableResources([
    'trash.photos' => TrashPhotoController::class,
]);
Route::name('admin.')->group(function () {
    Route::resources([
        'reports' => ReportController::class,
    ]);
});
`;
    const webActions = [
      "index",
      "create",
      "store",
      "show",
      "edit",
      "update",
      "destroy",
    ];
    const apiActions = ["index", "store", "show", "update", "destroy"];

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      ...expectedRouteDefinitions(source, "photos", webActions),
      ...expectedRouteDefinitions(source, "posts.comments", webActions),
      ...expectedRouteDefinitions(source, "api.photos", apiActions),
      ...expectedRouteDefinitions(source, "trash.photos", webActions),
      ...expectedRouteDefinitions(source, "admin.reports", webActions, "reports"),
    ]);
  });

  it("filters literal Laravel resource route names with only and except", () => {
    const source = `<?php
Route::resource('photos', PhotoController::class)->only(['index', 'show']);
Route::resource('posts', PostController::class)->except(['create', 'edit', 'destroy']);
Route::apiResource('api.comments', ApiCommentController::class)->except(['destroy']);
Route::resource('reports', ReportController::class)->only('index', 'store');
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      ...expectedRouteDefinitions(source, "photos", ["index", "show"]),
      ...expectedRouteDefinitions(source, "posts", [
        "index",
        "store",
        "show",
        "update",
      ]),
      ...expectedRouteDefinitions(source, "api.comments", [
        "index",
        "store",
        "show",
        "update",
      ]),
      ...expectedRouteDefinitions(source, "reports", ["index", "store"]),
    ]);
  });

  it("uses literal Laravel resource route name overrides", () => {
    const source = `<?php
Route::resource('photos', PhotoController::class)->names([
    'create' => 'photos.build',
    'show' => 'photos.view',
]);
Route::apiResource('api.comments', ApiCommentController::class)
    ->only(['index', 'show'])
    ->names([
        'index' => 'api.comments.feed',
        'show' => 'api.comments.detail',
        'destroy' => 'api.comments.remove',
    ]);
Route::name('admin.')->group(function () {
    Route::singleton('profile', ProfileController::class)->names([
        'show' => 'profile.details',
    ]);
});
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "photos.index",
        position: positionOf(source, "photos"),
      },
      {
        name: "photos.build",
        position: positionOf(source, "photos.build"),
      },
      {
        name: "photos.store",
        position: positionOf(source, "photos"),
      },
      {
        name: "photos.view",
        position: positionOf(source, "photos.view"),
      },
      {
        name: "photos.edit",
        position: positionOf(source, "photos"),
      },
      {
        name: "photos.update",
        position: positionOf(source, "photos"),
      },
      {
        name: "photos.destroy",
        position: positionOf(source, "photos"),
      },
      {
        name: "api.comments.feed",
        position: positionOf(source, "api.comments.feed"),
      },
      {
        name: "api.comments.detail",
        position: positionOf(source, "api.comments.detail"),
      },
      {
        name: "admin.profile.details",
        position: positionOf(source, "profile.details"),
      },
      {
        name: "admin.profile.edit",
        position: positionOf(source, "profile"),
      },
      {
        name: "admin.profile.update",
        position: positionOf(source, "profile"),
      },
    ]);
  });

  it("expands Laravel singleton route name modifiers", () => {
    const source = `<?php
Route::singleton('photos.thumbnail', ThumbnailController::class)->creatable();
Route::singleton('profile.avatar', AvatarController::class)->destroyable();
Route::apiSingleton('api.profile.avatar', ApiAvatarController::class)->creatable();
Route::apiSingleton('api.profile.settings', ApiSettingsController::class)->destroyable();
Route::singleton('comments.badge', BadgeController::class); // ->creatable()
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "photos.thumbnail.create",
        position: positionOf(source, "photos.thumbnail"),
      },
      {
        name: "photos.thumbnail.store",
        position: positionOf(source, "photos.thumbnail"),
      },
      {
        name: "photos.thumbnail.show",
        position: positionOf(source, "photos.thumbnail"),
      },
      {
        name: "photos.thumbnail.edit",
        position: positionOf(source, "photos.thumbnail"),
      },
      {
        name: "photos.thumbnail.update",
        position: positionOf(source, "photos.thumbnail"),
      },
      {
        name: "photos.thumbnail.destroy",
        position: positionOf(source, "photos.thumbnail"),
      },
      {
        name: "profile.avatar.show",
        position: positionOf(source, "profile.avatar"),
      },
      {
        name: "profile.avatar.edit",
        position: positionOf(source, "profile.avatar"),
      },
      {
        name: "profile.avatar.update",
        position: positionOf(source, "profile.avatar"),
      },
      {
        name: "profile.avatar.destroy",
        position: positionOf(source, "profile.avatar"),
      },
      {
        name: "api.profile.avatar.store",
        position: positionOf(source, "api.profile.avatar"),
      },
      {
        name: "api.profile.avatar.show",
        position: positionOf(source, "api.profile.avatar"),
      },
      {
        name: "api.profile.avatar.update",
        position: positionOf(source, "api.profile.avatar"),
      },
      {
        name: "api.profile.avatar.destroy",
        position: positionOf(source, "api.profile.avatar"),
      },
      {
        name: "api.profile.settings.show",
        position: positionOf(source, "api.profile.settings"),
      },
      {
        name: "api.profile.settings.update",
        position: positionOf(source, "api.profile.settings"),
      },
      {
        name: "api.profile.settings.destroy",
        position: positionOf(source, "api.profile.settings"),
      },
      {
        name: "comments.badge.show",
        position: positionOf(source, "comments.badge"),
      },
      {
        name: "comments.badge.edit",
        position: positionOf(source, "comments.badge"),
      },
      {
        name: "comments.badge.update",
        position: positionOf(source, "comments.badge"),
      },
    ]);
  });

  it("combines nested Laravel route name group prefixes", () => {
    const source = `<?php
Route::name('admin.')->group(function () {
    Route::name('reports.')->group(function () {
        Route::get('/reports/monthly', ReportsController::class)->name('monthly');
    });
});
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "admin.reports.monthly",
        position: positionOf(source, "monthly');"),
      },
    ]);
  });

  it("combines chained Laravel route name group prefixes", () => {
    const source = `<?php
Route::middleware(['web'])->name('admin.')->group(function () {
    Route::get('/dashboard', DashboardController::class)->name('dashboard');
});
Route::prefix('reports')->as('reports.')->group(function () {
    Route::resource('exports', ExportController::class)->only(['index']);
});
Route::name('outer.')->group(function () {
    Route::middleware('auth')->name('inner.')->group(function () {
        Route::get('/home', HomeController::class)->name('home');
    });
});
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "admin.dashboard",
        position: positionOf(source, "dashboard');"),
      },
      {
        name: "reports.exports.index",
        position: positionOf(source, "exports"),
      },
      {
        name: "outer.inner.home",
        position: positionOf(source, "home');"),
      },
    ]);
  });

  it("combines array Laravel route group name prefixes", () => {
    const source = `<?php
Route::group(['as' => 'admin.'], function () {
    Route::get('/dashboard', DashboardController::class)->name('dashboard');
});
Route::group(['as' => 'outer.'], function () {
    Route::group(['as' => 'inner.'], function () {
        Route::resource('reports', ReportController::class)->only(['index']);
    });
});
`;

    expect(phpLaravelNamedRouteDefinitions(source)).toEqual([
      {
        name: "admin.dashboard",
        position: positionOf(source, "dashboard');"),
      },
      {
        name: "outer.inner.reports.index",
        position: positionOf(source, "reports"),
      },
    ]);
  });
});
