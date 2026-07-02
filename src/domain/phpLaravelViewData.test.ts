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
      {
        detail: "view data",
        name: "$comment",
        typeHint: "Comment",
        valueExpression: "$comment",
        valueOffset: source.indexOf("$comment,"),
      },
      {
        detail: "view data",
        name: "$count",
        typeHint: null,
        valueExpression: "$count",
        valueOffset: source.indexOf("$count,"),
      },
    ]);
  });

  it("extracts variables from View::make data", () => {
    const source = `<?php

return View::make('comments.show', ['comment' => $comment]);
`;

    expect(phpLaravelViewDataBindings(source)).toEqual([
      {
        variables: [
          {
            detail: "view data",
            name: "$comment",
            typeHint: null,
            valueExpression: "$comment",
            valueOffset: source.indexOf("$comment]"),
          },
        ],
        viewName: "comments.show",
      },
    ]);
  });

  it("extracts variables from compact data", () => {
    const source = `<?php

return view('comments.index', compact('comments', 'paginator'));
`;

    expect(phpLaravelViewVariablesForView(source, "comments.index")).toEqual([
      {
        detail: "view data compact()",
        name: "$comments",
        typeHint: null,
        valueExpression: "$comments",
        valueOffset: source.indexOf("compact("),
      },
      {
        detail: "view data compact()",
        name: "$paginator",
        typeHint: null,
        valueExpression: "$paginator",
        valueOffset: source.indexOf("compact("),
      },
    ]);
  });

  it("extracts variables from with string and array chains", () => {
    const source = `<?php

return view('comments.show')
    ->with('comment', $comment)
    ->with(['paginator' => $paginator]);
`;

    expect(phpLaravelViewVariablesForView(source, "comments.show")).toEqual([
      {
        detail: "view data with()",
        name: "$comment",
        typeHint: null,
        valueExpression: "$comment",
        valueOffset: source.indexOf("$comment)"),
      },
      {
        detail: "view data with()",
        name: "$paginator",
        typeHint: null,
        valueExpression: "$paginator",
        valueOffset: source.indexOf("$paginator]"),
      },
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
        valueExpression: "$comment",
        valueOffset: source.indexOf("$comment]"),
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
      {
        detail: "view data",
        name: "$comments",
        typeHint: null,
        valueExpression: "$comments",
        valueOffset: source.indexOf("$comments]"),
      },
    ]);
  });

  it("captures a member expression passed as view data", () => {
    const source = `<?php

return view('db.list', ['useraccount' => $this->connectedUseraccount]);
`;

    expect(phpLaravelViewVariablesForView(source, "db.list")).toEqual([
      {
        detail: "view data",
        name: "$useraccount",
        typeHint: null,
        valueExpression: "$this->connectedUseraccount",
        valueOffset: source.indexOf("$this->connectedUseraccount"),
      },
    ]);
  });

  it("derives a display hint from the value variable when keys differ", () => {
    const source = `<?php

$userAccount = new UserAccount();

return view('tools.search', ['useraccount' => $userAccount]);
`;

    expect(phpLaravelViewVariablesForView(source, "tools.search")).toEqual([
      {
        detail: "view data",
        name: "$useraccount",
        typeHint: "UserAccount",
        valueExpression: "$userAccount",
        valueOffset: source.indexOf("$userAccount]"),
      },
    ]);
  });

  it("extracts variables from a local array variable passed as view data", () => {
    const source = `<?php

class SearchAccountToolController
{
    public function search()
    {
        $viewVariables = [];

        $viewVariables['useraccount_name'] = 'None';
        $userAccount = new UserAccount();
        $viewVariables['useraccount'] = $userAccount;
        $viewVariables['resultAccounts'] = $accounts;

        return view('modules.tools.search_account', $viewVariables);
    }
}
`;

    expect(
      phpLaravelViewVariablesForView(source, "modules.tools.search_account"),
    ).toEqual([
      {
        detail: "view data",
        name: "$resultAccounts",
        typeHint: null,
        valueExpression: "$accounts",
        valueOffset: source.indexOf("$accounts;"),
      },
      {
        detail: "view data",
        name: "$useraccount",
        typeHint: "UserAccount",
        valueExpression: "$userAccount",
        valueOffset: source.indexOf("$userAccount;"),
      },
      {
        detail: "view data",
        name: "$useraccount_name",
        typeHint: null,
        valueExpression: "'None'",
        valueOffset: source.indexOf("'None'"),
      },
    ]);
  });

  it("extracts entries from an inline array variable assignment", () => {
    const source = `<?php

$viewVariables = ['connection' => $connectionSlug, 'tables' => $tables];

return view('modules.db_view.list', $viewVariables);
`;

    expect(
      phpLaravelViewVariablesForView(source, "modules.db_view.list").map(
        (variable) => [variable.name, variable.valueExpression],
      ),
    ).toEqual([
      ["$connection", "$connectionSlug"],
      ["$tables", "$tables"],
    ]);
  });

  it("scopes array-variable element assignments to the enclosing function", () => {
    const source = `<?php

class ToolsController
{
    public function first()
    {
        $viewVariables['stale'] = $old;

        return view('tools.first', $viewVariables);
    }

    public function second()
    {
        $viewVariables['fresh'] = $new;

        return view('tools.second', $viewVariables);
    }
}
`;

    expect(
      phpLaravelViewVariablesForView(source, "tools.second").map(
        (variable) => variable.name,
      ),
    ).toEqual(["$fresh"]);
  });
});
