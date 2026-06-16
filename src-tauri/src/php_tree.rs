use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpTree {
    pub nodes: Vec<PhpTreeNode>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpTreeNode {
    pub children: Vec<PhpTreeNode>,
    pub column: Option<i64>,
    pub fully_qualified_name: Option<String>,
    pub id: String,
    pub kind: PhpTreeNodeKind,
    pub label: String,
    pub line_number: Option<i64>,
    pub path: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PhpTreeNodeKind {
    Class,
    Container,
    Constant,
    Enum,
    Function,
    Interface,
    Method,
    Namespace,
    Trait,
}

impl PhpTreeNodeKind {
    fn is_type(self) -> bool {
        matches!(
            self,
            Self::Class | Self::Enum | Self::Interface | Self::Trait
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PhpTreeSymbolRecord {
    pub column: i64,
    pub container_kind: Option<PhpTreeNodeKind>,
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: PhpTreeNodeKind,
    pub line_number: i64,
    pub name: String,
    pub path: String,
    pub relative_path: String,
}

pub fn build_php_tree(symbols: &[PhpTreeSymbolRecord]) -> PhpTree {
    let mut root = NamespaceGroup::default();

    for symbol in symbols {
        if symbol.kind.is_type() {
            root.insert_type(symbol);
        }
    }

    for symbol in symbols {
        if symbol.kind.is_type() {
            continue;
        }

        if let Some(container_name) = symbol.container_name.as_deref() {
            root.insert_member(container_name, symbol);
            continue;
        }

        root.insert_symbol(symbol);
    }

    PhpTree {
        nodes: root.into_nodes(None),
    }
}

#[derive(Default)]
struct NamespaceGroup {
    namespaces: BTreeMap<String, NamespaceGroup>,
    symbols: Vec<PhpTreeNode>,
    types: BTreeMap<String, TypeGroup>,
}

impl NamespaceGroup {
    fn namespace_mut(&mut self, parts: &[String]) -> &mut NamespaceGroup {
        if parts.is_empty() {
            return self;
        }

        self.namespaces
            .entry(parts[0].clone())
            .or_default()
            .namespace_mut(&parts[1..])
    }

    fn insert_type(&mut self, symbol: &PhpTreeSymbolRecord) {
        let namespace = namespace_parts_for_symbol(symbol);
        let group = self.namespace_mut(&namespace);
        group
            .types
            .entry(symbol.fully_qualified_name.clone())
            .or_insert_with(|| TypeGroup {
                members: Vec::new(),
                node: symbol_node(symbol),
            });
    }

    fn insert_member(&mut self, container_name: &str, symbol: &PhpTreeSymbolRecord) {
        let namespace = namespace_parts_for_container(container_name);
        let group = self.namespace_mut(&namespace);
        let label = container_label(container_name);
        let kind = symbol.container_kind.unwrap_or(PhpTreeNodeKind::Container);
        let container = group
            .types
            .entry(container_name.to_string())
            .or_insert_with(|| TypeGroup {
                members: Vec::new(),
                node: PhpTreeNode {
                    children: Vec::new(),
                    column: None,
                    fully_qualified_name: Some(container_name.to_string()),
                    id: node_id("symbol", container_name),
                    kind,
                    label,
                    line_number: None,
                    path: None,
                    relative_path: None,
                },
            });
        container.members.push(symbol_node(symbol));
    }

    fn insert_symbol(&mut self, symbol: &PhpTreeSymbolRecord) {
        let namespace = namespace_parts_for_symbol(symbol);
        self.namespace_mut(&namespace)
            .symbols
            .push(symbol_node(symbol));
    }

    fn into_nodes(self, parent_namespace: Option<String>) -> Vec<PhpTreeNode> {
        let mut nodes = Vec::new();

        for (name, group) in self.namespaces {
            let namespace = match parent_namespace.as_deref() {
                Some(parent) => format!("{parent}\\{name}"),
                None => name.clone(),
            };
            nodes.push(PhpTreeNode {
                children: group.into_nodes(Some(namespace.clone())),
                column: None,
                fully_qualified_name: Some(namespace.clone()),
                id: node_id("namespace", &namespace),
                kind: PhpTreeNodeKind::Namespace,
                label: name,
                line_number: None,
                path: None,
                relative_path: None,
            });
        }

        for type_group in self.types.into_values() {
            nodes.push(type_group.into_node());
        }

        nodes.extend(self.symbols);
        nodes
    }
}

struct TypeGroup {
    members: Vec<PhpTreeNode>,
    node: PhpTreeNode,
}

impl TypeGroup {
    fn into_node(self) -> PhpTreeNode {
        PhpTreeNode {
            children: self.members,
            ..self.node
        }
    }
}

fn symbol_node(symbol: &PhpTreeSymbolRecord) -> PhpTreeNode {
    PhpTreeNode {
        children: Vec::new(),
        column: Some(symbol.column),
        fully_qualified_name: Some(symbol.fully_qualified_name.clone()),
        id: node_id("symbol", &symbol.fully_qualified_name),
        kind: symbol.kind,
        label: symbol.name.clone(),
        line_number: Some(symbol.line_number),
        path: Some(symbol.path.clone()),
        relative_path: Some(symbol.relative_path.clone()),
    }
}

fn namespace_parts_for_symbol(symbol: &PhpTreeSymbolRecord) -> Vec<String> {
    let suffix = format!("\\{}", symbol.name);
    let namespace = match symbol.fully_qualified_name.strip_suffix(&suffix) {
        Some(namespace) => namespace,
        None => return Vec::new(),
    };

    namespace_parts(namespace)
}

fn namespace_parts_for_container(container_name: &str) -> Vec<String> {
    let label = container_label(container_name);
    let suffix = format!("\\{label}");
    let namespace = match container_name.strip_suffix(&suffix) {
        Some(namespace) => namespace,
        None => return Vec::new(),
    };

    namespace_parts(namespace)
}

fn namespace_parts(namespace: &str) -> Vec<String> {
    if namespace.is_empty() {
        return Vec::new();
    }

    namespace
        .split('\\')
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn container_label(container_name: &str) -> String {
    match container_name.rsplit('\\').next() {
        Some(label) => label.to_string(),
        None => container_name.to_string(),
    }
}

fn node_id(prefix: &str, value: &str) -> String {
    format!("{prefix}:{value}")
}

#[cfg(test)]
mod tests {
    use super::{build_php_tree, PhpTreeNodeKind, PhpTreeSymbolRecord};

    #[test]
    fn builds_namespaces_types_and_members() {
        let tree = build_php_tree(&[
            symbol("App\\Domain\\User", "User", PhpTreeNodeKind::Class, None),
            symbol(
                "App\\Domain\\User::name",
                "name",
                PhpTreeNodeKind::Method,
                Some("App\\Domain\\User"),
            ),
            symbol(
                "App\\Domain\\helper",
                "helper",
                PhpTreeNodeKind::Function,
                None,
            ),
        ]);

        let app = &tree.nodes[0];
        let domain = &app.children[0];
        let user = domain
            .children
            .iter()
            .find(|node| node.label == "User")
            .expect("user node");
        let helper = domain
            .children
            .iter()
            .find(|node| node.label == "helper")
            .expect("helper node");

        assert_eq!(app.kind, PhpTreeNodeKind::Namespace);
        assert_eq!(domain.label, "Domain");
        assert_eq!(user.kind, PhpTreeNodeKind::Class);
        assert_eq!(user.children[0].label, "name");
        assert_eq!(helper.kind, PhpTreeNodeKind::Function);
    }

    #[test]
    fn keeps_global_symbols_at_root() {
        let tree = build_php_tree(&[symbol(
            "global_helper",
            "global_helper",
            PhpTreeNodeKind::Function,
            None,
        )]);

        assert_eq!(tree.nodes[0].label, "global_helper");
        assert_eq!(tree.nodes[0].kind, PhpTreeNodeKind::Function);
    }

    #[test]
    fn uses_container_kind_for_placeholder_members() {
        let tree = build_php_tree(&[symbol_with_container_kind(
            "App\\Contract\\UserContract::name",
            "name",
            PhpTreeNodeKind::Method,
            "App\\Contract\\UserContract",
            PhpTreeNodeKind::Interface,
        )]);
        let app = &tree.nodes[0];
        let contract = &app.children[0];
        let user_contract = &contract.children[0];

        assert_eq!(user_contract.label, "UserContract");
        assert_eq!(user_contract.kind, PhpTreeNodeKind::Interface);
        assert_eq!(user_contract.children[0].label, "name");
    }

    fn symbol(
        fully_qualified_name: &str,
        name: &str,
        kind: PhpTreeNodeKind,
        container_name: Option<&str>,
    ) -> PhpTreeSymbolRecord {
        PhpTreeSymbolRecord {
            column: 1,
            container_kind: None,
            container_name: container_name.map(ToString::to_string),
            fully_qualified_name: fully_qualified_name.to_string(),
            kind,
            line_number: 1,
            name: name.to_string(),
            path: "/project/src/User.php".to_string(),
            relative_path: "src/User.php".to_string(),
        }
    }

    fn symbol_with_container_kind(
        fully_qualified_name: &str,
        name: &str,
        kind: PhpTreeNodeKind,
        container_name: &str,
        container_kind: PhpTreeNodeKind,
    ) -> PhpTreeSymbolRecord {
        PhpTreeSymbolRecord {
            container_kind: Some(container_kind),
            ..symbol(fully_qualified_name, name, kind, Some(container_name))
        }
    }
}
