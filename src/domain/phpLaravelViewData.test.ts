import { describe, expect, it } from "vitest";
import {
  phpLaravelViewDataBindings,
  phpLaravelViewVariablesForView,
} from "./phpLaravelViewData";

describe("phpLaravelViewDataBindings", () => {
  it("extracts variables from view array data", () => {
    const source = `<?php
use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);
        $count = 3;

        return view('comments.show', [
            'comment' => $comment,
            'count' => $count,
        ]);
    }
}
`;

    expect(phpLaravelViewVariablesForView(source, "comments.show")).toEqual([
      { detail: "view data", name: "$comment", typeHint: "Comment" },
      { detail: "view data", name: "$count", typeHint: null },
    ]);
  });

  it("extracts variables from View::make data", () => {
    const source = `<?php

return View::make('comments.show', ['comment' => $comment]);
`;

    expect(phpLaravelViewDataBindings(source)).toEqual([
      {
        variables: [{ detail: "view data", name: "$comment", typeHint: null }],
        viewName: "comments.show",
      },
    ]);
  });

  it("extracts variables from compact data", () => {
    const source = `<?php

return view('comments.index', compact('comments', 'paginator'));
`;

    expect(phpLaravelViewVariablesForView(source, "comments.index")).toEqual([
      { detail: "view data compact()", name: "$comments", typeHint: null },
      { detail: "view data compact()", name: "$paginator", typeHint: null },
    ]);
  });

  it("extracts variables from with string and array chains", () => {
    const source = `<?php

return view('comments.show')
    ->with('comment', $comment)
    ->with(['paginator' => $paginator]);
`;

    expect(phpLaravelViewVariablesForView(source, "comments.show")).toEqual([
      { detail: "view data with()", name: "$comment", typeHint: null },
      { detail: "view data with()", name: "$paginator", typeHint: null },
    ]);
  });

  it("uses PHPDoc @var type hints conservatively", () => {
    const source = `<?php
/** @var \\App\\Models\\Comment $comment */
$comment = repository();

return view('comments.show', ['comment' => $comment]);
`;

    expect(phpLaravelViewVariablesForView(source, "comments.show")).toEqual([
      {
        detail: "view data",
        name: "$comment",
        typeHint: "\\App\\Models\\Comment",
      },
    ]);
  });

  it("ignores dynamic views, unsafe keys, and unrelated view bindings", () => {
    const source = `<?php

return view($dynamic, ['comment' => $comment]);
return view('comments.show', ['bad-key' => $bad]);
return view('comments.index', ['comments' => $comments]);
`;

    expect(phpLaravelViewVariablesForView(source, "comments.show")).toEqual([]);
    expect(phpLaravelViewVariablesForView(source, "comments.index")).toEqual([
      { detail: "view data", name: "$comments", typeHint: null },
    ]);
  });
});
