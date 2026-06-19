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

  it("combines group prefixes and ignores dynamic/resource/unrelated route names", () => {
    const source = `<?php
Route::name('admin.')->group(function () {
    Route::get('/dashboard', DashboardController::class)->name('dashboard');
});
Route::resource('comments', CommentController::class);
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
