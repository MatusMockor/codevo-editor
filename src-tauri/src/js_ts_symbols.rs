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

        close_finished_containers(&mut container_stack, line_number, leading_columns);

        if should_skip_line(trimmed) {
            byte_offset += line.len() + 1;
            continue;
        }

        if let Some(symbol) =
            extract_type_symbol(trimmed, line_number, leading_columns, byte_offset)
        {
            let symbol_scope = symbol_scope(&symbol, line, line_number, leading_columns);
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
            container_stack.last(),
        ) {
            symbols.push(symbol);
            byte_offset += line.len() + 1;
            continue;
        }

        if let Some(symbol) = extract_variable_symbol(
            trimmed,
            line_number,
            leading_columns,
            byte_offset,
            container_stack.last(),
        ) {
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
}

fn extract_type_symbol(
    trimmed: &str,
    line_number: usize,
    leading_columns: usize,
    byte_offset: usize,
) -> Option<JsTsSymbol> {
    let line = strip_export_prefix(trimmed);

    if let Some(name) = name_after_keyword(line, "class") {
        return Some(symbol(
            name,
            None,
            WorkspaceSymbolKind::Class,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = name_after_keyword(line, "interface") {
        return Some(symbol(
            name,
            None,
            WorkspaceSymbolKind::Interface,
            line_number,
            leading_columns + column_of(trimmed, name),
            byte_offset + column_of(trimmed, name),
        ));
    }

    if let Some(name) = type_alias_name(line) {
        return Some(symbol(
            name,
            None,
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
    let line = strip_async_prefix(strip_export_prefix(trimmed));

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

    if let Some(name) = method_name(line) {
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

fn extract_variable_symbol(
    trimmed: &str,
    line_number: usize,
    leading_columns: usize,
    byte_offset: usize,
    container: Option<&ContainerScope>,
) -> Option<JsTsSymbol> {
    let line = strip_export_prefix(trimmed);
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

fn strip_export_prefix(line: &str) -> &str {
    let line = strip_keyword(line, "export").unwrap_or(line);
    strip_keyword(line, "default").unwrap_or(line)
}

fn strip_async_prefix(line: &str) -> &str {
    strip_keyword(line, "async").unwrap_or(line)
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
    first_identifier(rest)
}

fn type_alias_name(line: &str) -> Option<&str> {
    let rest = strip_keyword(line, "type")?;
    let name = first_identifier(rest)?;
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

    first_identifier(rest)
}

fn assigned_function_name(line: &str) -> Option<&str> {
    let name = variable_name(line)?;
    let after_name = &line[column_of(line, name) + name.len()..];

    if after_name.contains("=>") || after_name.contains("function") {
        return Some(name);
    }

    None
}

fn method_name(line: &str) -> Option<&str> {
    if line.starts_with("if ")
        || line.starts_with("for ")
        || line.starts_with("while ")
        || line.starts_with("switch ")
        || line.starts_with("catch ")
    {
        return None;
    }

    let line = strip_async_prefix(line);
    let name = first_identifier(line)?;
    let after_name = line[name.len()..].trim_start();

    if after_name.starts_with('(') {
        return Some(name);
    }

    None
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
    line.find(name).unwrap_or(0) + 1
}

fn symbol_kind_for_container(container: Option<&ContainerScope>) -> WorkspaceSymbolKind {
    if container.is_some() {
        return WorkspaceSymbolKind::Method;
    }

    WorkspaceSymbolKind::Function
}

fn symbol_scope(
    symbol: &JsTsSymbol,
    line: &str,
    line_number: usize,
    leading_columns: usize,
) -> Option<ContainerScope> {
    if symbol.kind != WorkspaceSymbolKind::Class && symbol.kind != WorkspaceSymbolKind::Interface {
        return None;
    }

    if !line.contains('{') {
        return None;
    }

    Some(ContainerScope {
        indent_columns: leading_columns,
        name: symbol.name.clone(),
        start_line: line_number,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContainerScope {
    indent_columns: usize,
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
}
