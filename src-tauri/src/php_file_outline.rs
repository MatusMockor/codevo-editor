use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpFileOutline {
    pub nodes: Vec<PhpFileOutlineNode>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpFileOutlineNode {
    pub children: Vec<PhpFileOutlineNode>,
    pub column: Option<i64>,
    pub fully_qualified_name: Option<String>,
    pub id: String,
    pub kind: PhpFileOutlineNodeKind,
    pub label: String,
    pub line_number: Option<i64>,
    pub path: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PhpFileOutlineNodeKind {
    Class,
    Container,
    Constant,
    Enum,
    Function,
    Interface,
    Method,
    Property,
    Trait,
}

impl PhpFileOutlineNodeKind {
    fn is_type(self) -> bool {
        matches!(
            self,
            Self::Class | Self::Enum | Self::Interface | Self::Trait
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PhpFileOutlineSymbolRecord {
    pub column: i64,
    pub container_kind: Option<PhpFileOutlineNodeKind>,
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: PhpFileOutlineNodeKind,
    pub line_number: i64,
    pub name: String,
    pub path: String,
    pub relative_path: String,
}

pub fn build_php_file_outline(symbols: &[PhpFileOutlineSymbolRecord]) -> PhpFileOutline {
    let mut root_entries = Vec::new();
    let mut placeholder_containers = BTreeSet::new();
    let type_names = type_symbol_names(symbols);
    let mut members_by_container: BTreeMap<String, Vec<&PhpFileOutlineSymbolRecord>> =
        BTreeMap::new();

    for symbol in symbols {
        if symbol.kind.is_type() {
            root_entries.push(OutlineRootEntry::Symbol(symbol));
            continue;
        }

        if let Some(container_name) = symbol.container_name.as_deref() {
            members_by_container
                .entry(container_name.to_string())
                .or_default()
                .push(symbol);

            if type_names.contains(container_name) {
                continue;
            }

            if placeholder_containers.insert(container_name.to_string()) {
                root_entries.push(OutlineRootEntry::Placeholder(container_name.to_string()));
            }

            continue;
        }

        root_entries.push(OutlineRootEntry::Symbol(symbol));
    }

    PhpFileOutline {
        nodes: root_entries
            .into_iter()
            .map(|entry| outline_node(entry, &mut members_by_container))
            .collect(),
    }
}

enum OutlineRootEntry<'a> {
    Placeholder(String),
    Symbol(&'a PhpFileOutlineSymbolRecord),
}

fn type_symbol_names(symbols: &[PhpFileOutlineSymbolRecord]) -> BTreeSet<String> {
    symbols
        .iter()
        .filter(|symbol| symbol.kind.is_type())
        .map(|symbol| symbol.fully_qualified_name.clone())
        .collect()
}

fn outline_node(
    entry: OutlineRootEntry<'_>,
    members_by_container: &mut BTreeMap<String, Vec<&PhpFileOutlineSymbolRecord>>,
) -> PhpFileOutlineNode {
    match entry {
        OutlineRootEntry::Symbol(symbol) => {
            let children = members_by_container
                .remove(&symbol.fully_qualified_name)
                .unwrap_or_default()
                .into_iter()
                .map(symbol_node)
                .collect();

            PhpFileOutlineNode {
                children,
                ..symbol_node(symbol)
            }
        }
        OutlineRootEntry::Placeholder(container_name) => {
            let members = members_by_container
                .remove(&container_name)
                .unwrap_or_default();
            let kind = members
                .first()
                .and_then(|member| member.container_kind)
                .unwrap_or(PhpFileOutlineNodeKind::Container);

            PhpFileOutlineNode {
                children: members.into_iter().map(symbol_node).collect(),
                column: None,
                fully_qualified_name: Some(container_name.clone()),
                id: node_id("container", &container_name),
                kind,
                label: container_label(&container_name),
                line_number: None,
                path: None,
                relative_path: None,
            }
        }
    }
}

fn symbol_node(symbol: &PhpFileOutlineSymbolRecord) -> PhpFileOutlineNode {
    PhpFileOutlineNode {
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
    use super::{build_php_file_outline, PhpFileOutlineNodeKind, PhpFileOutlineSymbolRecord};

    #[test]
    fn builds_type_members_and_standalone_symbols_in_file_order() {
        let outline = build_php_file_outline(&[
            symbol(
                "App\\Domain\\User",
                "User",
                PhpFileOutlineNodeKind::Class,
                None,
            ),
            symbol(
                "App\\Domain\\User::name",
                "name",
                PhpFileOutlineNodeKind::Method,
                Some("App\\Domain\\User"),
            ),
            symbol(
                "App\\Domain\\helper",
                "helper",
                PhpFileOutlineNodeKind::Function,
                None,
            ),
        ]);

        assert_eq!(outline.nodes[0].label, "User");
        assert_eq!(outline.nodes[0].kind, PhpFileOutlineNodeKind::Class);
        assert_eq!(outline.nodes[0].children[0].label, "name");
        assert_eq!(outline.nodes[1].label, "helper");
    }

    #[test]
    fn uses_container_kind_for_missing_type_placeholders() {
        let outline = build_php_file_outline(&[symbol_with_container_kind(
            "App\\Contract\\UserContract::name",
            "name",
            PhpFileOutlineNodeKind::Method,
            "App\\Contract\\UserContract",
            PhpFileOutlineNodeKind::Interface,
        )]);

        assert_eq!(outline.nodes[0].label, "UserContract");
        assert_eq!(outline.nodes[0].kind, PhpFileOutlineNodeKind::Interface);
        assert_eq!(outline.nodes[0].children[0].label, "name");
    }

    fn symbol(
        fully_qualified_name: &str,
        name: &str,
        kind: PhpFileOutlineNodeKind,
        container_name: Option<&str>,
    ) -> PhpFileOutlineSymbolRecord {
        PhpFileOutlineSymbolRecord {
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
        kind: PhpFileOutlineNodeKind,
        container_name: &str,
        container_kind: PhpFileOutlineNodeKind,
    ) -> PhpFileOutlineSymbolRecord {
        PhpFileOutlineSymbolRecord {
            container_kind: Some(container_kind),
            ..symbol(fully_qualified_name, name, kind, Some(container_name))
        }
    }
}
