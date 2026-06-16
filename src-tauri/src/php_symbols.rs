use crate::php_parser::PhpSyntaxTree;
use tree_sitter::Node;

pub trait PhpSymbolExtractor {
    fn extract(&self, tree: &PhpSyntaxTree, source: &str) -> Vec<PhpSymbol>;
}

pub struct TreeSitterPhpSymbolExtractor;

impl PhpSymbolExtractor for TreeSitterPhpSymbolExtractor {
    fn extract(&self, tree: &PhpSyntaxTree, source: &str) -> Vec<PhpSymbol> {
        let mut symbols = Vec::new();
        let context = PhpSymbolContext::default();
        extract_node(tree.root(), source, &context, &mut symbols);
        symbols
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PhpSymbol {
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: PhpSymbolKind,
    pub name: String,
    pub range: PhpSymbolRange,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum PhpSymbolKind {
    Class,
    Constant,
    Enum,
    Function,
    Interface,
    Method,
    Property,
    Trait,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct PhpSymbolRange {
    pub end_byte: usize,
    pub end_column: usize,
    pub end_line: usize,
    pub start_byte: usize,
    pub start_column: usize,
    pub start_line: usize,
}

#[derive(Default, Clone)]
struct PhpSymbolContext {
    container_name: Option<String>,
    namespace: Option<String>,
}

impl PhpSymbolContext {
    fn with_container(&self, container_name: String) -> Self {
        Self {
            container_name: Some(container_name),
            namespace: self.namespace.clone(),
        }
    }

    fn with_namespace(&self, namespace: Option<String>) -> Self {
        Self {
            container_name: None,
            namespace,
        }
    }
}

fn extract_node(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    match node.kind() {
        "program" | "declaration_list" | "compound_statement" | "enum_declaration_list" => {
            extract_children_sequential(node, source, context, symbols);
        }
        "class_declaration" => {
            extract_named_type(node, source, context, symbols, PhpSymbolKind::Class);
        }
        "interface_declaration" => {
            extract_named_type(node, source, context, symbols, PhpSymbolKind::Interface);
        }
        "trait_declaration" => {
            extract_named_type(node, source, context, symbols, PhpSymbolKind::Trait);
        }
        "enum_declaration" => {
            extract_named_type(node, source, context, symbols, PhpSymbolKind::Enum);
        }
        "function_definition" => {
            extract_function(node, source, context, symbols);
        }
        "method_declaration" => {
            extract_method(node, source, context, symbols);
        }
        "property_declaration" => {
            extract_properties(node, source, context, symbols);
        }
        "const_declaration" => {
            extract_constants(node, source, context, symbols);
        }
        _ => {
            extract_children(node, source, context, symbols);
        }
    }
}

fn extract_children_sequential(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let mut current = context.clone();
    let mut cursor = node.walk();

    for child in node.named_children(&mut cursor) {
        if child.kind() == "namespace_definition" {
            let namespace_context = current.with_namespace(namespace_name(child, source));

            if let Some(body) = child.child_by_field_name("body") {
                extract_node(body, source, &namespace_context, symbols);
                continue;
            }

            current = namespace_context;
            continue;
        }

        extract_node(child, source, &current, symbols);
    }
}

fn extract_children(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let mut cursor = node.walk();

    for child in node.named_children(&mut cursor) {
        extract_node(child, source, context, symbols);
    }
}

fn extract_named_type(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
    kind: PhpSymbolKind,
) {
    let name = match field_text(node, "name", source) {
        Some(name) => name,
        None => {
            extract_children(node, source, context, symbols);
            return;
        }
    };
    let fully_qualified_name = qualified_name(context.namespace.as_deref(), &name);

    symbols.push(PhpSymbol {
        container_name: None,
        fully_qualified_name: fully_qualified_name.clone(),
        kind,
        name,
        range: symbol_range(node),
    });

    if let Some(body) = node.child_by_field_name("body") {
        let child_context = context.with_container(fully_qualified_name);
        extract_node(body, source, &child_context, symbols);
    }
}

fn extract_function(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let name = match field_text(node, "name", source) {
        Some(name) => name,
        None => return,
    };

    symbols.push(PhpSymbol {
        container_name: None,
        fully_qualified_name: qualified_name(context.namespace.as_deref(), &name),
        kind: PhpSymbolKind::Function,
        name,
        range: symbol_range(node),
    });
}

fn extract_method(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let name = match field_text(node, "name", source) {
        Some(name) => name,
        None => return,
    };
    let container_name = context.container_name.clone();
    let fully_qualified_name = match container_name.as_deref() {
        Some(container) => member_name(container, &name),
        None => name.clone(),
    };

    symbols.push(PhpSymbol {
        container_name,
        fully_qualified_name,
        kind: PhpSymbolKind::Method,
        name,
        range: symbol_range(node),
    });
    extract_promoted_properties(node, source, context, symbols);
}

fn extract_properties(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let mut cursor = node.walk();

    for child in node.named_children(&mut cursor) {
        if child.kind() != "property_element" {
            continue;
        }

        extract_property(child, source, context, symbols);
    }
}

fn extract_promoted_properties(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let mut cursor = node.walk();

    for child in node.named_children(&mut cursor) {
        if child.kind() == "property_promotion_parameter" {
            extract_property(child, source, context, symbols);
            continue;
        }

        extract_promoted_properties(child, source, context, symbols);
    }
}

fn extract_property(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let name = match property_name(node, source) {
        Some(name) => name,
        None => return,
    };
    let container_name = match context.container_name.clone() {
        Some(container_name) => container_name,
        None => return,
    };
    let fully_qualified_name = member_name(&container_name, &name);

    symbols.push(PhpSymbol {
        container_name: Some(container_name),
        fully_qualified_name,
        kind: PhpSymbolKind::Property,
        name,
        range: symbol_range(node),
    });
}

fn extract_constants(
    node: Node<'_>,
    source: &str,
    context: &PhpSymbolContext,
    symbols: &mut Vec<PhpSymbol>,
) {
    let mut cursor = node.walk();

    for child in node.named_children(&mut cursor) {
        if child.kind() != "const_element" {
            continue;
        }

        let name = match first_named_child_text(child, "name", source) {
            Some(name) => name,
            None => continue,
        };
        let container_name = context.container_name.clone();
        let fully_qualified_name = match container_name.as_deref() {
            Some(container) => member_name(container, &name),
            None => qualified_name(context.namespace.as_deref(), &name),
        };

        symbols.push(PhpSymbol {
            container_name,
            fully_qualified_name,
            kind: PhpSymbolKind::Constant,
            name,
            range: symbol_range(child),
        });
    }
}

fn namespace_name(node: Node<'_>, source: &str) -> Option<String> {
    field_text(node, "name", source)
}

fn property_name(node: Node<'_>, source: &str) -> Option<String> {
    let raw_name = field_text(node, "name", source)
        .or_else(|| first_named_child_text(node, "variable_name", source))?;
    Some(raw_name.trim().trim_start_matches('&').to_string())
}

fn field_text(node: Node<'_>, field: &str, source: &str) -> Option<String> {
    node.child_by_field_name(field)
        .and_then(|child| node_text(child, source))
}

fn first_named_child_text(node: Node<'_>, kind: &str, source: &str) -> Option<String> {
    let mut cursor = node.walk();

    for child in node.named_children(&mut cursor) {
        if child.kind() == kind {
            return node_text(child, source);
        }
    }

    None
}

fn node_text(node: Node<'_>, source: &str) -> Option<String> {
    node.utf8_text(source.as_bytes())
        .ok()
        .map(|value| value.to_string())
}

fn qualified_name(namespace: Option<&str>, name: &str) -> String {
    let namespace = match namespace {
        Some(namespace) => namespace,
        None => return name.to_string(),
    };

    if namespace.is_empty() {
        return name.to_string();
    }

    format!("{namespace}\\{name}")
}

fn member_name(container: &str, name: &str) -> String {
    format!("{container}::{name}")
}

fn symbol_range(node: Node<'_>) -> PhpSymbolRange {
    let start = node.start_position();
    let end = node.end_position();

    PhpSymbolRange {
        end_byte: node.end_byte(),
        end_column: end.column + 1,
        end_line: end.row + 1,
        start_byte: node.start_byte(),
        start_column: start.column + 1,
        start_line: start.row + 1,
    }
}

#[cfg(test)]
mod tests {
    use super::{PhpSymbolExtractor, PhpSymbolKind, TreeSitterPhpSymbolExtractor};
    use crate::php_parser::{PhpSyntaxParser, TreeSitterPhpParser};

    #[test]
    fn extracts_php_symbols_from_namespaced_fixture() {
        let symbols = extract_symbols(valid_symbol_fixture());
        let descriptors: Vec<(PhpSymbolKind, String)> = symbols
            .iter()
            .map(|symbol| (symbol.kind, symbol.fully_qualified_name.clone()))
            .collect();

        assert_eq!(
            descriptors,
            vec![
                (
                    PhpSymbolKind::Interface,
                    "App\\Domain\\UserRepository".to_string(),
                ),
                (
                    PhpSymbolKind::Method,
                    "App\\Domain\\UserRepository::find".to_string(),
                ),
                (PhpSymbolKind::Trait, "App\\Domain\\Timestamped".to_string()),
                (
                    PhpSymbolKind::Method,
                    "App\\Domain\\Timestamped::touch".to_string(),
                ),
                (PhpSymbolKind::Enum, "App\\Domain\\UserStatus".to_string()),
                (PhpSymbolKind::Class, "App\\Domain\\User".to_string()),
                (
                    PhpSymbolKind::Constant,
                    "App\\Domain\\User::TYPE".to_string()
                ),
                (
                    PhpSymbolKind::Property,
                    "App\\Domain\\User::$displayName".to_string()
                ),
                (PhpSymbolKind::Method, "App\\Domain\\User::name".to_string()),
                (PhpSymbolKind::Function, "App\\Domain\\helper".to_string()),
                (
                    PhpSymbolKind::Constant,
                    "App\\Domain\\APP_VERSION".to_string()
                ),
            ]
        );
    }

    #[test]
    fn records_symbol_ranges_and_containers() {
        let symbols = extract_symbols(valid_symbol_fixture());
        let method = symbols
            .iter()
            .find(|symbol| symbol.fully_qualified_name == "App\\Domain\\User::name")
            .expect("method symbol");

        assert_eq!(method.name, "name");
        assert_eq!(method.container_name.as_deref(), Some("App\\Domain\\User"));
        assert!(method.range.start_line > 1);
        assert!(method.range.end_byte > method.range.start_byte);

        let class = symbols
            .iter()
            .find(|symbol| symbol.fully_qualified_name == "App\\Domain\\User")
            .expect("class symbol");

        assert_eq!(class.container_name, None);
    }

    #[test]
    fn extracts_available_symbols_from_incomplete_fixture() {
        let symbols = extract_symbols(incomplete_symbol_fixture());
        let names: Vec<String> = symbols
            .iter()
            .map(|symbol| symbol.fully_qualified_name.clone())
            .collect();

        assert!(names.contains(&"App\\Broken".to_string()));
        assert!(names.contains(&"App\\Broken::name".to_string()));
    }

    fn extract_symbols(source: &str) -> Vec<super::PhpSymbol> {
        let mut parser = TreeSitterPhpParser::new().expect("parser");
        let tree = parser.parse(source).expect("parse fixture");
        TreeSitterPhpSymbolExtractor.extract(&tree, source)
    }

    fn valid_symbol_fixture() -> &'static str {
        r#"<?php

namespace App\Domain;

interface UserRepository
{
    public function find(string $id): ?User;
}

trait Timestamped
{
    public function touch(): void {}
}

enum UserStatus: string
{
    case Active = 'active';
}

final class User
{
    public const TYPE = 'user';
    private string $displayName = 'Matus';

    public function name(): string
    {
        return 'Matus';
    }
}

function helper(): void {}

const APP_VERSION = '1.0.0';
"#
    }

    fn incomplete_symbol_fixture() -> &'static str {
        r#"<?php

namespace App;

final class Broken
{
    public function name(): string
    {
        return 'draft';
    }
"#
    }
}
