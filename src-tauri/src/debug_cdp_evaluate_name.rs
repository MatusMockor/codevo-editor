// Pure, fail-closed JavaScript evaluate-name construction for CDP variables.

const MAX_EVALUATE_NAME_BYTES: usize = 4 * 1024;
const MAX_SAFE_JAVASCRIPT_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn scope_child_evaluate_name(name: &str, synthetic: bool) -> Option<String> {
    if synthetic || !is_safe_text(name) || !is_binding_identifier(name) {
        return None;
    }
    Some(name.to_string())
}

pub(super) fn nested_evaluate_name(
    parent: Option<&str>,
    name: &str,
    synthetic: bool,
) -> Option<String> {
    let parent = parent.filter(|value| is_safe_text(value))?;
    if synthetic || !is_safe_text(name) || is_internal_name(name) {
        return None;
    }

    let candidate = if is_canonical_array_index(name) {
        format!("{parent}[{name}]")
    } else if is_identifier_name(name) {
        format!("{parent}.{name}")
    } else {
        let encoded = serde_json::to_string(name).ok()?;
        format!("{parent}[{encoded}]")
    };
    bounded(candidate)
}

pub(super) fn private_evaluate_name(
    parent: Option<&str>,
    name: &str,
    synthetic: bool,
) -> Option<String> {
    let private_name = name.strip_prefix('#')?;
    if parent != Some("this")
        || synthetic
        || !is_safe_text(name)
        || private_name == "constructor"
        || !is_identifier_name(private_name)
    {
        return None;
    }
    bounded(format!("this.{name}"))
}

pub(super) fn evaluation_evaluate_name(expression: &str) -> Option<String> {
    is_safe_text(expression).then(|| expression.to_string())
}

pub(super) fn simple_binding_identifier(expression: &str) -> Option<String> {
    (is_safe_text(expression) && is_binding_identifier(expression) && expression != "this")
        .then(|| expression.to_string())
}

pub(super) fn evaluation_parent_accessor(expression: &str) -> Option<String> {
    let expression = evaluation_evaluate_name(expression)?;
    if is_binding_identifier(&expression) {
        return Some(expression);
    }
    bounded(format!("({expression})"))
}

fn bounded(value: String) -> Option<String> {
    (value.len() <= MAX_EVALUATE_NAME_BYTES).then_some(value)
}

fn is_safe_text(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_EVALUATE_NAME_BYTES
        && has_valid_expression_characters(value)
}

fn has_valid_expression_characters(value: &str) -> bool {
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\t' | '\n' => {}
            '\r' if characters.peek() == Some(&'\n') => {}
            _ if character.is_control() => return false,
            _ => {}
        }
    }
    true
}

fn is_internal_name(name: &str) -> bool {
    name.starts_with("[[") && name.ends_with("]]")
}

fn is_binding_identifier(value: &str) -> bool {
    is_identifier_name(value) && (!is_reserved_word(value) || value == "this")
}

fn is_identifier_name(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    is_identifier_start(first) && characters.all(is_identifier_continue)
}

pub(super) fn is_reserved_binding_word(value: &str) -> bool {
    is_reserved_word(value)
}

fn is_identifier_start(character: char) -> bool {
    character == '$' || character == '_' || character.is_alphabetic()
}

fn is_identifier_continue(character: char) -> bool {
    is_identifier_start(character)
        || character.is_ascii_digit()
        || character == '\u{200c}'
        || character == '\u{200d}'
}

fn is_canonical_array_index(value: &str) -> bool {
    if value == "0" {
        return true;
    }
    value.starts_with(|character: char| ('1'..='9').contains(&character))
        && value.chars().all(|character| character.is_ascii_digit())
        && value
            .parse::<u64>()
            .is_ok_and(|index| index <= MAX_SAFE_JAVASCRIPT_INTEGER)
}

fn is_reserved_word(value: &str) -> bool {
    matches!(
        value,
        "await"
            | "break"
            | "case"
            | "catch"
            | "class"
            | "const"
            | "continue"
            | "debugger"
            | "default"
            | "delete"
            | "do"
            | "else"
            | "enum"
            | "export"
            | "extends"
            | "false"
            | "finally"
            | "for"
            | "function"
            | "if"
            | "import"
            | "in"
            | "instanceof"
            | "let"
            | "new"
            | "null"
            | "return"
            | "static"
            | "super"
            | "switch"
            | "throw"
            | "true"
            | "try"
            | "typeof"
            | "var"
            | "void"
            | "while"
            | "with"
            | "yield"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_children_are_only_emitted_for_safe_binding_identifiers() {
        for accepted in ["user", "$value", "_value2", "Žofia", "this"] {
            assert_eq!(
                scope_child_evaluate_name(accepted, false).as_deref(),
                Some(accepted)
            );
        }
        for rejected in [
            "",
            "   ",
            "line\nbreak",
            "user name",
            "default",
            "[[Scopes]]",
        ] {
            assert_eq!(scope_child_evaluate_name(rejected, false), None);
        }
        assert_eq!(scope_child_evaluate_name("synthetic", true), None);
    }

    #[test]
    fn nested_children_use_member_numeric_or_json_escaped_accessors() {
        assert_eq!(
            nested_evaluate_name(Some("user"), "name", false).as_deref(),
            Some("user.name")
        );
        assert_eq!(
            nested_evaluate_name(Some("items"), "0", false).as_deref(),
            Some("items[0]")
        );
        assert_eq!(
            nested_evaluate_name(Some("items"), "01", false).as_deref(),
            Some("items[\"01\"]")
        );
        assert_eq!(
            nested_evaluate_name(Some("items"), "9007199254740991", false).as_deref(),
            Some("items[9007199254740991]")
        );
        assert_eq!(
            nested_evaluate_name(Some("items"), "9007199254740992", false).as_deref(),
            Some("items[\"9007199254740992\"]")
        );
        assert_eq!(
            nested_evaluate_name(Some("user"), "full name", false).as_deref(),
            Some("user[\"full name\"]")
        );
        assert_eq!(
            nested_evaluate_name(Some("user"), "a\"b\\c", false).as_deref(),
            Some("user[\"a\\\"b\\\\c\"]")
        );
        assert_eq!(
            nested_evaluate_name(Some("user"), "default", false).as_deref(),
            Some("user.default")
        );
    }

    #[test]
    fn nested_children_propagate_missing_parents_and_reject_synthetic_names() {
        assert_eq!(nested_evaluate_name(None, "name", false), None);
        assert_eq!(
            nested_evaluate_name(Some("parent"), "[[Prototype]]", false),
            None
        );
        assert_eq!(nested_evaluate_name(Some("parent"), "name", true), None);
        assert_eq!(
            nested_evaluate_name(Some("(\nparent\n)"), "name", false).as_deref(),
            Some("(\nparent\n).name")
        );
        assert_eq!(
            nested_evaluate_name(Some("parent\rpath"), "name", false),
            None
        );
    }

    #[test]
    fn private_names_are_only_emitted_from_this() {
        assert_eq!(
            private_evaluate_name(Some("this"), "#secret", false).as_deref(),
            Some("this.#secret")
        );
        assert_eq!(private_evaluate_name(Some("other"), "#secret", false), None);
        assert_eq!(
            private_evaluate_name(Some("this"), "#bad name", false),
            None
        );
        assert_eq!(
            private_evaluate_name(Some("this"), "#constructor", false),
            None
        );
        assert_eq!(private_evaluate_name(Some("this"), "#secret", true), None);
        assert_eq!(
            nested_evaluate_name(Some("this"), "#secret", false).as_deref(),
            Some("this[\"#secret\"]")
        );
    }

    #[test]
    fn every_result_has_bounded_expression_controls() {
        assert_eq!(
            evaluation_evaluate_name("count + 1").as_deref(),
            Some("count + 1")
        );
        assert_eq!(
            evaluation_evaluate_name("(\ncount\t+ 1\r\n)").as_deref(),
            Some("(\ncount\t+ 1\r\n)")
        );
        assert_eq!(evaluation_evaluate_name("count\revil"), None);
        assert_eq!(evaluation_evaluate_name("count\u{000b}evil"), None);
        assert_eq!(evaluation_evaluate_name("   "), None);
        assert!(evaluation_evaluate_name(&"é".repeat(2048)).is_some());
        assert!(evaluation_evaluate_name(&"é".repeat(2049)).is_none());
        assert_eq!(evaluation_parent_accessor("user").as_deref(), Some("user"));
        assert_eq!(
            evaluation_parent_accessor("left + right").as_deref(),
            Some("(left + right)")
        );

        let parent = "a".repeat(MAX_EVALUATE_NAME_BYTES - 3);
        assert!(nested_evaluate_name(Some(&parent), "b", false).is_some());
        assert!(nested_evaluate_name(Some(&format!("{parent}aa")), "b", false).is_none());
    }
}
