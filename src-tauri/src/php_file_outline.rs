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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_static: Option<bool>,
    pub kind: PhpFileOutlineNodeKind,
    pub label: String,
    pub line_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<PhpFileOutlineParameter>>,
    pub path: Option<String>,
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<PhpSymbolVisibility>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PhpSymbolVisibility {
    Public,
    Protected,
    Private,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpFileOutlineParameter {
    pub name: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,
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
    pub is_static: bool,
    pub kind: PhpFileOutlineNodeKind,
    pub line_number: i64,
    pub name: String,
    pub parameters: Vec<PhpFileOutlineParameter>,
    pub path: String,
    pub relative_path: String,
    pub return_type: Option<String>,
    pub visibility: Option<PhpSymbolVisibility>,
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
                is_static: None,
                kind,
                label: container_label(&container_name),
                line_number: None,
                parameters: None,
                path: None,
                relative_path: None,
                return_type: None,
                visibility: None,
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
        is_static: static_flag_for(symbol),
        kind: symbol.kind,
        label: symbol.name.clone(),
        line_number: Some(symbol.line_number),
        parameters: parameters_for(symbol),
        path: Some(symbol.path.clone()),
        relative_path: Some(symbol.relative_path.clone()),
        return_type: symbol.return_type.clone(),
        visibility: symbol.visibility,
    }
}

fn callable_kind(kind: PhpFileOutlineNodeKind) -> bool {
    matches!(
        kind,
        PhpFileOutlineNodeKind::Function | PhpFileOutlineNodeKind::Method
    )
}

fn parameters_for(symbol: &PhpFileOutlineSymbolRecord) -> Option<Vec<PhpFileOutlineParameter>> {
    if !callable_kind(symbol.kind) {
        return None;
    }

    Some(symbol.parameters.clone())
}

fn static_flag_for(symbol: &PhpFileOutlineSymbolRecord) -> Option<bool> {
    let supports_static = matches!(
        symbol.kind,
        PhpFileOutlineNodeKind::Method | PhpFileOutlineNodeKind::Property
    );

    if !supports_static {
        return None;
    }

    Some(symbol.is_static)
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
    use super::{
        build_php_file_outline, PhpFileOutlineNodeKind, PhpFileOutlineParameter,
        PhpFileOutlineSymbolRecord, PhpSymbolVisibility,
    };

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
    fn carries_signature_metadata_onto_member_nodes() {
        let outline = build_php_file_outline(&[
            symbol(
                "App\\Domain\\User",
                "User",
                PhpFileOutlineNodeKind::Class,
                None,
            ),
            PhpFileOutlineSymbolRecord {
                is_static: true,
                parameters: vec![
                    PhpFileOutlineParameter {
                        name: "$id".to_string(),
                        type_name: Some("string".to_string()),
                    },
                    PhpFileOutlineParameter {
                        name: "$flag".to_string(),
                        type_name: None,
                    },
                ],
                return_type: Some("?User".to_string()),
                visibility: Some(PhpSymbolVisibility::Protected),
                ..symbol(
                    "App\\Domain\\User::find",
                    "find",
                    PhpFileOutlineNodeKind::Method,
                    Some("App\\Domain\\User"),
                )
            },
        ]);

        let method = &outline.nodes[0].children[0];

        assert_eq!(method.label, "find");
        assert_eq!(method.visibility, Some(PhpSymbolVisibility::Protected));
        assert_eq!(method.is_static, Some(true));
        assert_eq!(method.return_type.as_deref(), Some("?User"));
        assert_eq!(
            method.parameters,
            Some(vec![
                PhpFileOutlineParameter {
                    name: "$id".to_string(),
                    type_name: Some("string".to_string()),
                },
                PhpFileOutlineParameter {
                    name: "$flag".to_string(),
                    type_name: None,
                },
            ]),
        );
    }

    #[test]
    fn leaves_signature_metadata_unset_for_type_nodes() {
        let outline = build_php_file_outline(&[symbol(
            "App\\Domain\\User",
            "User",
            PhpFileOutlineNodeKind::Class,
            None,
        )]);

        let class = &outline.nodes[0];

        assert_eq!(class.visibility, None);
        assert_eq!(class.is_static, None);
        assert_eq!(class.parameters, None);
        assert_eq!(class.return_type, None);
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
            is_static: false,
            kind,
            line_number: 1,
            name: name.to_string(),
            parameters: Vec::new(),
            path: "/project/src/User.php".to_string(),
            relative_path: "src/User.php".to_string(),
            return_type: None,
            visibility: None,
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
