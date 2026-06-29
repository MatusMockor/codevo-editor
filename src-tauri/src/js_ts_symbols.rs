use crate::index::{WorkspaceSymbolKind, WorkspaceSymbolRange, WorkspaceSymbolRecord};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JsTsSymbol {
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: WorkspaceSymbolKind,
    pub name: String,
    pub range: WorkspaceSymbolRange,
}

pub trait JsTsSymbolExtractor {
    fn extract(&self, source: &str) -> Vec<JsTsSymbol>;
}

pub struct TextJsTsSymbolExtractor;

impl JsTsSymbolExtractor for TextJsTsSymbolExtractor {
    fn extract(&self, source: &str) -> Vec<JsTsSymbol> {
        extract_js_ts_symbols(source)
    }
}

pub fn workspace_symbol_record(symbol: JsTsSymbol) -> WorkspaceSymbolRecord {
    WorkspaceSymbolRecord {
        container_name: symbol.container_name,
        fully_qualified_name: symbol.fully_qualified_name,
        kind: symbol.kind,
        name: symbol.name,
        range: symbol.range,
    }
}

fn extract_js_ts_symbols(source: &str) -> Vec<JsTsSymbol> {
    let mut symbols = Vec::new();
    let mut container_stack: Vec<ContainerScope> = Vec::new();
    let mut byte_offset = 0usize;

    for (line_index, line) in source.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim_start();
        let leading_columns = line.len().saturating_sub(trimmed.len());

        if should_skip_line(trimmed) {
            byte_offset += line.len() + 1;
            continue;
        }

        close_finished_containers(&mut container_stack, line_number, leading_columns);

        let container = direct_container_for_line(&container_stack, leading_columns);

        if container_stack.last().is_some()
            && leading_columns > container_stack.last().unwrap().indent_columns
            && container.is_none()
        {
            byte_offset += line.len() + 1;
            continue;
        }

        if let Some(symbol) = extract_type_symbol(
            trimmed,
            line_number,
            leading_columns,
            byte_offset,
            container,
        ) {
            let symbol_scope = symbol_scope(&symbol, line, line_number, leading_columns);
            record_container_member_indent(&mut container_stack, leading_columns);
            symbols.push(symbol);

            if let Some(scope) = symbol_scope {
                container_stack.push(scope);
            }

            byte_offset += line.len() + 1;
            continue;
        }

        if let Some(symbol) = extract_function_symbol(
            trimmed,
            line_number,
            leading_columns,
            byte_offset,
            container,
        ) {
            record_container_member_indent(&mut container_stack, leading_columns);
            symbols.push(symbol);
            byte_offset += line.len() + 1;
            continue;
        }

        if let Some(symbol) = extract_property_symbol(
            trimmed,
            line_number,
            leading_columns,
            byte_offset,
            container,
        ) {
            record_container_member_indent(&mut container_stack, leading_columns);
            symbols.push(symbol);
            byte_offset += line.len() + 1;
            continue;
        }

        if let Some(symbol) = extract_variable_symbol(
            trimmed,
            line_number,
            leading_columns,
            byte_offset,
            container,
        ) {
            record_container_member_indent(&mut container_stack, leading_columns);
            symbols.push(symbol);
        }

        byte_offset += line.len() + 1;
    }

    symbols
}

fn close_finished_containers(
    container_stack: &mut Vec<ContainerScope>,
    line_number: usize,
    leading_columns: usize,
) {
    while let Some(scope) = container_stack.last() {
        if line_number <= scope.start_line {
            return;
        }

        if leading_columns > scope.indent_columns {
            return;
        }

        container_stack.pop();
    }
}

fn should_skip_line(trimmed: &str) -> bool {
    trimmed.is_empty()
        || trimmed.starts_with("//")
        || trimmed.starts_with('*')
        || trimmed.starts_with("/*")
        || trimmed.starts_with('@')
}

fn extract_type_symbol(
    trimmed: &str,
    line_number: usize,
    leading_columns: usize,
    byte_offset: usize,
    container: Option<&ContainerScope>,
) -> Option<JsTsSymbol> {
    let line = strip_type_prefixes(trimmed);
    let container_name = container.map(|scope| scope.name.clone());

    if let Some(name) = name_after_keyword(line, "class") {
        return Some(symbol(
            name,
            container_name,
            WorkspaceSymbolKind::Class,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = name_after_keyword(line, "interface") {
        return Some(symbol(
            name,
            container_name,
            WorkspaceSymbolKind::Interface,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = name_after_keyword(line, "enum") {
        return Some(symbol(
            name,
            container_name,
            WorkspaceSymbolKind::Enum,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = namespace_name(line) {
        return Some(symbol(
            name,
            container_name,
            WorkspaceSymbolKind::Interface,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = type_alias_name(line) {
        return Some(symbol(
            name,
            container_name,
            WorkspaceSymbolKind::Interface,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    None
}

fn extract_function_symbol(
    trimmed: &str,
    line_number: usize,
    leading_columns: usize,
    byte_offset: usize,
    container: Option<&ContainerScope>,
) -> Option<JsTsSymbol> {
    let line = strip_function_prefixes(trimmed);

    if let Some(name) = name_after_keyword(line, "function") {
        return Some(symbol(
            name,
            container.map(|scope| scope.name.clone()),
            symbol_kind_for_container(container),
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = container.and_then(|_| method_name(line)) {
        return Some(symbol(
            name,
            container.map(|scope| scope.name.clone()),
            symbol_kind_for_container(container),
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = assigned_function_name(line) {
        return Some(symbol(
            name,
            container.map(|scope| scope.name.clone()),
            WorkspaceSymbolKind::Function,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    None
}

fn extract_property_symbol(
    trimmed: &str,
    line_number: usize,
    leading_columns: usize,
    byte_offset: usize,
    container: Option<&ContainerScope>,
) -> Option<JsTsSymbol> {
    let container = container?;

    if !matches!(
        container.kind,
        ContainerKind::Class | ContainerKind::Interface
    ) {
        return None;
    }

    let line = strip_member_prefixes(trimmed);
    let name = accessor_name(line).or_else(|| member_property_name(line))?;

    Some(symbol(
        name,
        Some(container.name.clone()),
        WorkspaceSymbolKind::Property,
        line_number,
        leading_columns + column_of(trimmed, name),
        byte_offset + column_of(trimmed, name),
    ))
}

fn extract_variable_symbol(
    trimmed: &str,
    line_number: usize,
    leading_columns: usize,
    byte_offset: usize,
    container: Option<&ContainerScope>,
) -> Option<JsTsSymbol> {
    if container
        .is_some_and(|scope| matches!(scope.kind, ContainerKind::Class | ContainerKind::Interface))
    {
        return None;
    }

    let line = strip_variable_prefixes(trimmed);
    let name = variable_name(line)?;

    Some(symbol(
        name,
        container.map(|scope| scope.name.clone()),
        WorkspaceSymbolKind::Constant,
        line_number,
        leading_columns + column_of(trimmed, name),
        byte_offset + column_of(trimmed, name),
    ))
}

fn symbol(
    name: &str,
    container_name: Option<String>,
    kind: WorkspaceSymbolKind,
    line_number: usize,
    column: usize,
    start_byte: usize,
) -> JsTsSymbol {
    let fully_qualified_name = match container_name.as_deref() {
        Some(container) => format!("{container}.{name}"),
        None => name.to_string(),
    };

    JsTsSymbol {
        container_name,
        fully_qualified_name,
        kind,
        name: name.to_string(),
        range: WorkspaceSymbolRange {
            end_byte: (start_byte + name.len()) as i64,
            end_column: (column + name.len()) as i64,
            end_line: line_number as i64,
            start_byte: start_byte as i64,
            start_column: column as i64,
            start_line: line_number as i64,
        },
    }
}

fn strip_type_prefixes(line: &str) -> &str {
    strip_keywords(line, &["export", "default", "declare", "abstract", "const"])
}

fn strip_function_prefixes(line: &str) -> &str {
    strip_keywords(
        line,
        &[
            "export",
            "default",
            "declare",
            "public",
            "private",
            "protected",
            "static",
            "abstract",
            "override",
            "async",
        ],
    )
}

fn strip_variable_prefixes(line: &str) -> &str {
    strip_keywords(line, &["export", "declare"])
}

fn strip_member_prefixes(line: &str) -> &str {
    strip_keywords(
        line,
        &[
            "public",
            "private",
            "protected",
            "static",
            "readonly",
            "declare",
            "abstract",
            "override",
            "accessor",
        ],
    )
}

fn strip_keywords<'a>(mut line: &'a str, keywords: &[&str]) -> &'a str {
    loop {
        let mut stripped = false;

        for keyword in keywords {
            if let Some(rest) = strip_keyword(line, keyword) {
                line = rest;
                stripped = true;
                break;
            }
        }

        if !stripped {
            return line;
        }
    }
}

fn strip_keyword<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(keyword)?;

    if rest
        .chars()
        .next()
        .is_some_and(|character| character.is_alphanumeric() || character == '_')
    {
        return None;
    }

    Some(rest.trim_start())
}

fn name_after_keyword<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let rest = strip_keyword(line, keyword)?;
    leading_identifier(rest)
}

fn namespace_name(line: &str) -> Option<&str> {
    name_after_keyword(line, "namespace").or_else(|| name_after_keyword(line, "module"))
}

fn type_alias_name(line: &str) -> Option<&str> {
    let rest = strip_keyword(line, "type")?;
    let name = leading_identifier(rest)?;
    let after_name = rest[name.len()..].trim_start();

    if after_name.starts_with('=') || after_name.starts_with('<') {
        return Some(name);
    }

    None
}

fn variable_name(line: &str) -> Option<&str> {
    let rest = strip_keyword(line, "const")
        .or_else(|| strip_keyword(line, "let"))
        .or_else(|| strip_keyword(line, "var"))?;

    leading_identifier(rest)
}

fn assigned_function_name(line: &str) -> Option<&str> {
    let name = variable_name(line)?;
    let after_name = &line[byte_index_of(line, name) + name.len()..];

    if after_name.contains("=>") || after_name.contains("function") {
        return Some(name);
    }

    None
}

fn method_name(line: &str) -> Option<&str> {
    let line = strip_member_prefixes(line);

    if starts_with_control_keyword(line) || line.starts_with("get ") || line.starts_with("set ") {
        return None;
    }

    let line = strip_keyword(line, "async").unwrap_or(line);
    let name = leading_member_identifier(line)?;
    let after_name = line[name.len()..].trim_start();

    if after_name.starts_with('(') || method_has_type_parameters(after_name) {
        return Some(name);
    }

    None
}

fn accessor_name(line: &str) -> Option<&str> {
    let rest = strip_keyword(line, "get").or_else(|| strip_keyword(line, "set"))?;
    let name = leading_member_identifier(rest)?;
    let after_name = rest[name.len()..].trim_start();

    if after_name.starts_with('(') {
        return Some(name);
    }

    None
}

fn member_property_name(line: &str) -> Option<&str> {
    if starts_with_control_keyword(line) || line.starts_with("constructor") || line.starts_with('[')
    {
        return None;
    }

    let name = leading_member_identifier(line)?;
    let after_name = line[name.len()..].trim_start();

    if after_name.starts_with(':')
        || after_name.starts_with('=')
        || after_name.starts_with(';')
        || after_name.starts_with('!')
        || after_name.starts_with('?')
    {
        return Some(name);
    }

    None
}

fn method_has_type_parameters(after_name: &str) -> bool {
    if !after_name.starts_with('<') {
        return false;
    }

    let Some(paren_index) = after_name.find('(') else {
        return false;
    };
    let Some(terminator_index) = after_name.find([':', '=', ';', '{']) else {
        return false;
    };

    paren_index < terminator_index
}

fn starts_with_control_keyword(line: &str) -> bool {
    line.starts_with("if ")
        || line.starts_with("for ")
        || line.starts_with("while ")
        || line.starts_with("switch ")
        || line.starts_with("catch ")
}

fn leading_identifier(value: &str) -> Option<&str> {
    let first = value.chars().next()?;

    if !is_identifier_start(first) {
        return None;
    }

    first_identifier(value)
}

fn leading_member_identifier(value: &str) -> Option<&str> {
    if let Some(rest) = value.strip_prefix('#') {
        let name = leading_identifier(rest)?;
        return Some(&value[..name.len() + 1]);
    }

    leading_identifier(value)
}

fn first_identifier(value: &str) -> Option<&str> {
    let start = value
        .char_indices()
        .find(|(_, character)| is_identifier_start(*character))
        .map(|(index, _)| index)?;
    let end = value[start..]
        .char_indices()
        .find(|(index, character)| *index > 0 && !is_identifier_continue(*character))
        .map(|(index, _)| start + index)
        .unwrap_or(value.len());

    Some(&value[start..end])
}

fn is_identifier_start(character: char) -> bool {
    character == '_' || character == '$' || character.is_ascii_alphabetic()
}

fn is_identifier_continue(character: char) -> bool {
    is_identifier_start(character) || character.is_ascii_digit()
}

fn column_of(line: &str, name: &str) -> usize {
    byte_index_of(line, name) + 1
}

fn byte_index_of(line: &str, name: &str) -> usize {
    line.find(name).unwrap_or(0)
}

fn symbol_kind_for_container(container: Option<&ContainerScope>) -> WorkspaceSymbolKind {
    if container
        .is_some_and(|scope| matches!(scope.kind, ContainerKind::Class | ContainerKind::Interface))
    {
        return WorkspaceSymbolKind::Method;
    }

    WorkspaceSymbolKind::Function
}

fn direct_container_for_line(
    container_stack: &[ContainerScope],
    leading_columns: usize,
) -> Option<&ContainerScope> {
    let container = container_stack.last()?;

    if leading_columns <= container.indent_columns {
        return None;
    }

    if container
        .member_indent_columns
        .is_some_and(|member_indent| leading_columns != member_indent)
    {
        return None;
    }

    Some(container)
}

fn record_container_member_indent(container_stack: &mut [ContainerScope], leading_columns: usize) {
    let Some(container) = container_stack.last_mut() else {
        return;
    };

    if leading_columns <= container.indent_columns || container.member_indent_columns.is_some() {
        return;
    }

    container.member_indent_columns = Some(leading_columns);
}

fn symbol_scope(
    symbol: &JsTsSymbol,
    line: &str,
    line_number: usize,
    leading_columns: usize,
) -> Option<ContainerScope> {
    let kind = container_kind_for_symbol(symbol, line)?;

    if symbol.kind != WorkspaceSymbolKind::Class && symbol.kind != WorkspaceSymbolKind::Interface {
        return None;
    }

    if !line.contains('{') {
        return None;
    }

    Some(ContainerScope {
        indent_columns: leading_columns,
        kind,
        member_indent_columns: None,
        name: symbol.fully_qualified_name.clone(),
        start_line: line_number,
    })
}

fn container_kind_for_symbol(symbol: &JsTsSymbol, line: &str) -> Option<ContainerKind> {
    if symbol.kind == WorkspaceSymbolKind::Class {
        return Some(ContainerKind::Class);
    }

    if symbol.kind != WorkspaceSymbolKind::Interface {
        return None;
    }

    let line = strip_type_prefixes(line.trim_start());

    if namespace_name(line).is_some() {
        return Some(ContainerKind::Namespace);
    }

    if name_after_keyword(line, "interface").is_some() {
        return Some(ContainerKind::Interface);
    }

    None
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ContainerKind {
    Class,
    Interface,
    Namespace,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContainerScope {
    indent_columns: usize,
    kind: ContainerKind,
    member_indent_columns: Option<usize>,
    name: String,
    start_line: usize,
}

#[cfg(test)]
mod tests {
    use super::{extract_js_ts_symbols, WorkspaceSymbolKind};

    #[test]
    fn extracts_typescript_classes_functions_and_constants() {
        let source = r#"
export interface UserDto {
  id: string;
}

export class UserService {
  async findUser(id: string): Promise<UserDto> {
    return { id };
  }
}

export const createUser = () => ({ id: "1" });
function normalizeUser(user: UserDto) {
  return user;
}
"#;

        let symbols = extract_js_ts_symbols(source);
        let descriptors: Vec<_> = symbols
            .iter()
            .map(|symbol| (symbol.kind, symbol.fully_qualified_name.as_str()))
            .collect();

        assert!(descriptors.contains(&(WorkspaceSymbolKind::Interface, "UserDto")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Class, "UserService")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Method, "UserService.findUser")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Function, "createUser")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Function, "normalizeUser")));
    }

    #[test]
    fn extracts_common_typescript_declarations_and_members() {
        let source = r#"
export enum UserRole {
  Admin = "admin",
}

export namespace Api {
  export type Id = string;

  export interface Payload {
    id: Id;
  }

  export const makePayload = () => ({ id: "1" });
}

declare module Internal {
  export function boot(): void;
}

export abstract class Account {
  @Input()
  public accessor status = "active";
  protected readonly id!: string;
  static get displayName(): string {
    return "Account";
  }

  constructor(id: string) {}

  @memoize()
  public async refresh(): Promise<void> {}
}
"#;

        let symbols = extract_js_ts_symbols(source);
        let descriptors: Vec<_> = symbols
            .iter()
            .map(|symbol| (symbol.kind, symbol.fully_qualified_name.as_str()))
            .collect();

        assert!(descriptors.contains(&(WorkspaceSymbolKind::Enum, "UserRole")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Interface, "Api")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Interface, "Api.Id")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Interface, "Api.Payload")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Property, "Api.Payload.id")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Function, "Api.makePayload")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Interface, "Internal")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Function, "Internal.boot")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Class, "Account")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Property, "Account.status")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Property, "Account.id")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Property, "Account.displayName")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Method, "Account.constructor")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Method, "Account.refresh")));
    }

    #[test]
    fn avoids_common_typescript_false_positives() {
        let source = r#"
const { skipped } = source;
module.exports = {};

class Example {
  run() {
    const local = () => {};
    value = 1;
  }

  field = 1;
}
"#;

        let symbols = extract_js_ts_symbols(source);
        let descriptors: Vec<_> = symbols
            .iter()
            .map(|symbol| (symbol.kind, symbol.fully_qualified_name.as_str()))
            .collect();

        assert!(descriptors.contains(&(WorkspaceSymbolKind::Class, "Example")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Method, "Example.run")));
        assert!(descriptors.contains(&(WorkspaceSymbolKind::Property, "Example.field")));
        assert!(!descriptors.iter().any(|(_, name)| *name == "skipped"));
        assert!(!descriptors.iter().any(|(_, name)| *name == "exports"));
        assert!(!descriptors.iter().any(|(_, name)| *name == "Example.local"));
        assert!(!descriptors.iter().any(|(_, name)| *name == "Example.value"));
    }
}
