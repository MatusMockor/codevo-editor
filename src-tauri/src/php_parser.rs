use serde::Serialize;
use std::{error::Error, fmt};
use tree_sitter::{Node, Parser, Tree};

pub trait PhpSyntaxParser {
    fn parse(&mut self, source: &str) -> Result<PhpSyntaxTree, PhpParseError>;
}

pub struct TreeSitterPhpParser {
    parser: Parser,
}

impl TreeSitterPhpParser {
    pub fn new() -> Result<Self, PhpParseError> {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_php::LANGUAGE_PHP.into())
            .map_err(|error| PhpParseError::Language(error.to_string()))?;

        Ok(Self { parser })
    }
}

impl PhpSyntaxParser for TreeSitterPhpParser {
    fn parse(&mut self, source: &str) -> Result<PhpSyntaxTree, PhpParseError> {
        let tree = self
            .parser
            .parse(source, None)
            .ok_or(PhpParseError::ParseCancelled)?;

        Ok(PhpSyntaxTree::from_tree(tree))
    }
}

#[derive(Debug)]
pub enum PhpParseError {
    Language(String),
    ParseCancelled,
}

impl fmt::Display for PhpParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Language(error) => write!(formatter, "failed to load PHP grammar: {error}"),
            Self::ParseCancelled => write!(formatter, "PHP parse was cancelled"),
        }
    }
}

impl Error for PhpParseError {}

#[derive(Debug)]
pub struct PhpSyntaxTree {
    tree: Tree,
    summary: PhpSyntaxTreeSummary,
}

impl PhpSyntaxTree {
    pub fn root(&self) -> Node<'_> {
        self.tree.root_node()
    }

    pub fn summary(&self) -> &PhpSyntaxTreeSummary {
        &self.summary
    }

    pub fn diagnostics(&self) -> Vec<PhpSyntaxDiagnostic> {
        let mut diagnostics = Vec::new();
        collect_diagnostics(self.root(), &mut diagnostics);
        diagnostics
    }

    fn from_tree(tree: Tree) -> Self {
        let root = tree.root_node();
        let summary = PhpSyntaxTreeSummary {
            error_count: count_error_nodes(root),
            has_error: root.has_error(),
            has_missing_nodes: contains_missing_nodes(root),
            root_end_byte: root.end_byte(),
            root_kind: root.kind().to_string(),
            root_start_byte: root.start_byte(),
        };

        Self { tree, summary }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PhpSyntaxTreeSummary {
    pub error_count: usize,
    pub has_error: bool,
    pub has_missing_nodes: bool,
    pub root_end_byte: usize,
    pub root_kind: String,
    pub root_start_byte: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpSyntaxDiagnostic {
    pub character: usize,
    pub end_character: usize,
    pub end_line: usize,
    pub line: usize,
    pub message: String,
}

fn count_error_nodes(node: Node<'_>) -> usize {
    let mut count = usize::from(node.is_error());
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        count += count_error_nodes(child);
    }

    count
}

fn contains_missing_nodes(node: Node<'_>) -> bool {
    if node.is_missing() {
        return true;
    }

    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if contains_missing_nodes(child) {
            return true;
        }
    }

    false
}

fn collect_diagnostics(node: Node<'_>, diagnostics: &mut Vec<PhpSyntaxDiagnostic>) {
    if node.is_error() {
        diagnostics.push(syntax_diagnostic(node, "PHP syntax error.".to_string()));
    }

    if node.is_missing() {
        diagnostics.push(syntax_diagnostic(
            node,
            format!("Missing PHP syntax: {}.", node.kind()),
        ));
    }

    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        collect_diagnostics(child, diagnostics);
    }
}

fn syntax_diagnostic(node: Node<'_>, message: String) -> PhpSyntaxDiagnostic {
    let start = node.start_position();
    let end = node.end_position();

    PhpSyntaxDiagnostic {
        character: start.column,
        end_character: diagnostic_end_character(start.row, start.column, end.row, end.column),
        end_line: end.row,
        line: start.row,
        message,
    }
}

fn diagnostic_end_character(
    start_line: usize,
    start_character: usize,
    end_line: usize,
    end_character: usize,
) -> usize {
    if start_line == end_line && end_character <= start_character {
        return start_character + 1;
    }

    end_character
}

#[cfg(test)]
mod tests {
    use super::{PhpSyntaxParser, TreeSitterPhpParser};

    #[test]
    fn parses_valid_php_fixture_without_errors() {
        let mut parser = TreeSitterPhpParser::new().expect("parser");
        let tree = parser.parse(valid_php_fixture()).expect("parse PHP");
        let summary = tree.summary();

        assert_eq!(summary.root_kind, "program");
        assert_eq!(summary.root_start_byte, 0);
        assert_eq!(summary.root_end_byte, valid_php_fixture().len());
        assert!(!summary.has_error);
        assert!(!summary.has_missing_nodes);
        assert_eq!(summary.error_count, 0);
        assert_eq!(tree.root().kind(), "program");
    }

    #[test]
    fn parses_incomplete_php_fixture_with_recoverable_errors() {
        let mut parser = TreeSitterPhpParser::new().expect("parser");
        let tree = parser.parse(incomplete_php_fixture()).expect("parse PHP");
        let summary = tree.summary();

        assert_eq!(summary.root_end_byte, incomplete_php_fixture().len());
        assert!(summary.has_error);
        assert!(summary.error_count > 0 || summary.has_missing_nodes);
    }

    #[test]
    fn reports_recoverable_syntax_diagnostics() {
        let mut parser = TreeSitterPhpParser::new().expect("parser");
        let tree = parser.parse(incomplete_php_fixture()).expect("parse PHP");
        let diagnostics = tree.diagnostics();

        assert!(!diagnostics.is_empty());
        assert!(diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("syntax")));
    }

    fn valid_php_fixture() -> &'static str {
        r#"<?php

namespace App\Domain;

final class User
{
    public function name(): string
    {
        return 'Matus';
    }
}
"#
    }

    fn incomplete_php_fixture() -> &'static str {
        r#"<?php

namespace App\Domain;

final class User
{
    public function name(): string
    {
        return
"#
    }
}
