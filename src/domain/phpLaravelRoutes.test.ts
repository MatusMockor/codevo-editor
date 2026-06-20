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
URL::route('comments.feed');
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
});
