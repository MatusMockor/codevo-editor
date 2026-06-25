import type { EditorPosition } from "./languageServerFeatures";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
  phpStatementPrefixRangeBeforeOffset,
} from "./phpReceiverExpressions";

export interface PhpPostfixCompletionContext {
  keyword: string;
  receiverExpression: string;
  replaceRange: {
    end: number;
    start: number;
  };
}

export interface PhpPostfixCompletionItem {
  detail: string;
  insertText: string;
  keyword: string;
  label: string;
}

interface PhpPostfixTemplate {
  detail: string;
  render: (receiverExpression: string) => string;
}

const PHP_POSTFIX_ARRAY_ACCESS_PATTERN = String.raw`(?:\[[^\]]*\])`;
const PHP_POSTFIX_RECEIVER_PATTERN = String.raw`${PHP_EXPRESSION_RECEIVER_PATTERN}${PHP_POSTFIX_ARRAY_ACCESS_PATTERN}*(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN}${PHP_POSTFIX_ARRAY_ACCESS_PATTERN}*)*`;
const PHP_POSTFIX_CONTEXT_PATTERN = new RegExp(
  `(${PHP_POSTFIX_RECEIVER_PATTERN})\\.([A-Za-z_][A-Za-z0-9_]*)$`,
);

const PHP_POSTFIX_TEMPLATES: Record<string, PhpPostfixTemplate> = {
  dd: {
    detail: "dd($expr);",
    render: (receiverExpression) => `dd(${receiverExpression});`,
  },
  dump: {
    detail: "dump($expr);",
    render: (receiverExpression) => `dump(${receiverExpression});`,
  },
  foreach: {
    detail: "foreach ($expr as $item) { ... }",
    render: (receiverExpression) =>
      `foreach (${receiverExpression} as $\${1:item}) {\n\t$0\n}`,
  },
  if: {
    detail: "if ($expr) { ... }",
    render: (receiverExpression) => `if (${receiverExpression}) {\n\t$0\n}`,
  },
  isset: {
    detail: "if (isset($expr)) { ... }",
    render: (receiverExpression) =>
      `if (isset(${receiverExpression})) {\n\t$0\n}`,
  },
  nn: {
    detail: "if ($expr !== null) { ... }",
    render: (receiverExpression) =>
      `if (${receiverExpression} !== null) {\n\t$0\n}`,
  },
  notnull: {
    detail: "if ($expr !== null) { ... }",
    render: (receiverExpression) =>
      `if (${receiverExpression} !== null) {\n\t$0\n}`,
  },
  return: {
    detail: "return $expr;",
    render: (receiverExpression) => `return ${receiverExpression};`,
  },
  var: {
    detail: "$name = $expr;",
    render: (receiverExpression) => `$\${1:name} = ${receiverExpression};$0`,
  },
};

export function phpPostfixCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpPostfixCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const prefix = phpStatementPrefixRangeBeforeOffset(source, offset);
  const match = PHP_POSTFIX_CONTEXT_PATTERN.exec(prefix.text);
  const receiverExpressionSource = match?.[1];
  const keyword = match?.[2];

  if (!receiverExpressionSource || !keyword) {
    return null;
  }

  if (!isKnownPostfixKeyword(keyword)) {
    return null;
  }

  return {
    keyword,
    receiverExpression: phpNormalizeReceiverExpression(receiverExpressionSource),
    replaceRange: {
      end: offset,
      start: prefix.startOffset + (match.index ?? 0),
    },
  };
}

export function phpPostfixCompletionItems(
  receiverExpression: string,
  keyword: string,
): PhpPostfixCompletionItem[] {
  const template = PHP_POSTFIX_TEMPLATES[keyword];

  if (!template) {
    return [];
  }

  return [
    {
      detail: template.detail,
      insertText: template.render(receiverExpression),
      keyword,
      label: keyword,
    },
  ];
}

const PHP_POSTFIX_KEYWORDS = new Set(Object.keys(PHP_POSTFIX_TEMPLATES));

function isKnownPostfixKeyword(keyword: string): boolean {
  return PHP_POSTFIX_KEYWORDS.has(keyword);
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}
