// Pure, strict parser for future exact-owner static-member Watch mutation.

use super::is_reserved_target_root;
use crate::debug_adapter::variable_name::{
    is_valid_debug_variable_name, MAX_DEBUG_VARIABLE_NAME_BYTES,
};
use unicode_ident::{is_xid_continue, is_xid_start};

const MAX_TARGET_BYTES: usize = 4 * 1024;
const MAX_TARGET_DEPTH: usize = 8;
const MAX_SAFE_JAVASCRIPT_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) struct StaticMemberTarget {
    pub(in crate::debug_cdp) root: StaticMemberRoot,
    pub(in crate::debug_cdp) segments: Vec<StaticMemberSegment>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) enum StaticMemberRoot {
    Binding(String),
    This,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) enum StaticMemberSegment {
    Member(String),
    CanonicalNumericIndex(u64),
    StringKey(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) enum StaticMemberTargetError {
    Empty,
    TooLong,
    ControlCharacter,
    InvalidRoot,
    MissingSegment,
    UnexpectedSyntax,
    TooDeep,
    KeyTooLong,
    ForbiddenKey,
    InvalidStringKey,
    InvalidNumericIndex,
    EmptyKey,
}

pub(in crate::debug_cdp) fn parse_static_member_target(
    expression: &str,
) -> Result<StaticMemberTarget, StaticMemberTargetError> {
    if expression.is_empty() {
        return Err(StaticMemberTargetError::Empty);
    }
    if expression.len() > MAX_TARGET_BYTES {
        return Err(StaticMemberTargetError::TooLong);
    }
    if expression.chars().any(char::is_control) {
        return Err(StaticMemberTargetError::ControlCharacter);
    }

    let (root, mut cursor) =
        parse_identifier(expression, 0).ok_or(StaticMemberTargetError::InvalidRoot)?;
    let root = if root == "this" {
        StaticMemberRoot::This
    } else if is_reserved_target_root(root) {
        return Err(StaticMemberTargetError::InvalidRoot);
    } else {
        validate_key(root)?;
        StaticMemberRoot::Binding(root.to_string())
    };
    if cursor == expression.len() {
        return Err(StaticMemberTargetError::MissingSegment);
    }

    let mut segments = Vec::new();
    while cursor < expression.len() {
        if segments.len() == MAX_TARGET_DEPTH {
            return Err(StaticMemberTargetError::TooDeep);
        }
        let byte = expression.as_bytes()[cursor];
        let segment = match byte {
            b'.' => {
                cursor += 1;
                let (name, next) = parse_identifier(expression, cursor)
                    .ok_or(StaticMemberTargetError::UnexpectedSyntax)?;
                validate_key(name)?;
                cursor = next;
                StaticMemberSegment::Member(name.to_string())
            }
            b'[' => {
                cursor += 1;
                let (segment, next) = parse_bracket_segment(expression, cursor)?;
                cursor = next;
                segment
            }
            _ => return Err(StaticMemberTargetError::UnexpectedSyntax),
        };
        segments.push(segment);
    }

    Ok(StaticMemberTarget { root, segments })
}

fn parse_bracket_segment(
    expression: &str,
    cursor: usize,
) -> Result<(StaticMemberSegment, usize), StaticMemberTargetError> {
    match expression.as_bytes().get(cursor) {
        Some(b'"') => parse_string_key(expression, cursor),
        Some(b'0'..=b'9') => parse_numeric_index(expression, cursor),
        _ => Err(StaticMemberTargetError::UnexpectedSyntax),
    }
}

fn parse_numeric_index(
    expression: &str,
    start: usize,
) -> Result<(StaticMemberSegment, usize), StaticMemberTargetError> {
    let mut cursor = start;
    while expression
        .as_bytes()
        .get(cursor)
        .is_some_and(u8::is_ascii_digit)
    {
        cursor += 1;
    }
    if expression.as_bytes().get(cursor) != Some(&b']') {
        return Err(StaticMemberTargetError::InvalidNumericIndex);
    }
    let literal = &expression[start..cursor];
    if (literal.len() > 1 && literal.starts_with('0'))
        || literal
            .parse::<u64>()
            .ok()
            .filter(|value| *value <= MAX_SAFE_JAVASCRIPT_INTEGER)
            .is_none()
    {
        return Err(StaticMemberTargetError::InvalidNumericIndex);
    }
    Ok((
        StaticMemberSegment::CanonicalNumericIndex(
            literal
                .parse::<u64>()
                .expect("validated canonical numeric index"),
        ),
        cursor + 1,
    ))
}

fn parse_string_key(
    expression: &str,
    start: usize,
) -> Result<(StaticMemberSegment, usize), StaticMemberTargetError> {
    let mut escaped = false;
    let mut closing = None;
    for (offset, character) in expression[start + 1..].char_indices() {
        let index = start + 1 + offset;
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            closing = Some(index);
            break;
        }
    }
    let closing = closing.ok_or(StaticMemberTargetError::InvalidStringKey)?;
    if expression.as_bytes().get(closing + 1) != Some(&b']') {
        return Err(StaticMemberTargetError::UnexpectedSyntax);
    }
    let literal = &expression[start..=closing];
    let key = serde_json::from_str::<String>(literal)
        .map_err(|_| StaticMemberTargetError::InvalidStringKey)?;
    validate_key(&key)?;
    Ok((StaticMemberSegment::StringKey(key), closing + 2))
}

fn parse_identifier(expression: &str, start: usize) -> Option<(&str, usize)> {
    let mut characters = expression.get(start..)?.char_indices();
    let (_, first) = characters.next()?;
    if !is_identifier_start(first) {
        return None;
    }
    let mut end = start + first.len_utf8();
    for (offset, character) in characters {
        if !is_identifier_continue(character) {
            break;
        }
        end = start + offset + character.len_utf8();
    }
    Some((&expression[start..end], end))
}

fn is_identifier_start(character: char) -> bool {
    character == '$' || character == '_' || is_xid_start(character)
}

fn is_identifier_continue(character: char) -> bool {
    is_identifier_start(character)
        || is_xid_continue(character)
        || character == '\u{200c}'
        || character == '\u{200d}'
}

fn validate_key(key: &str) -> Result<(), StaticMemberTargetError> {
    if !is_valid_debug_variable_name(key) {
        if key.is_empty() {
            return Err(StaticMemberTargetError::EmptyKey);
        }
        if key.len() > MAX_DEBUG_VARIABLE_NAME_BYTES {
            return Err(StaticMemberTargetError::KeyTooLong);
        }
        return Err(StaticMemberTargetError::ControlCharacter);
    }
    // Root names are included deliberately: no future resolver may reinterpret
    // these prototype-sensitive names as ordinary lexical authority.
    if matches!(key, "__proto__" | "prototype" | "constructor") {
        return Err(StaticMemberTargetError::ForbiddenKey);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_root_members_numeric_indices_json_keys_and_chains() {
        assert_eq!(
            parse_static_member_target("obj.prop").expect("member"),
            StaticMemberTarget {
                root: StaticMemberRoot::Binding("obj".to_string()),
                segments: vec![StaticMemberSegment::Member("prop".to_string())],
            }
        );
        assert!(parse_static_member_target("A\u{0301}.value").is_ok());
        assert_eq!(
            parse_static_member_target("\u{0345}root.value"),
            Err(StaticMemberTargetError::InvalidRoot)
        );
        assert_eq!(
            parse_static_member_target("items[0]")
                .expect("index")
                .segments,
            vec![StaticMemberSegment::CanonicalNumericIndex(0)]
        );
        assert_eq!(
            parse_static_member_target("obj[\"a-b\"]")
                .expect("string key")
                .segments,
            vec![StaticMemberSegment::StringKey("a-b".to_string())]
        );
        assert_eq!(
            parse_static_member_target("Žofia.users[12][\"full name\"].default")
                .expect("unicode chain"),
            StaticMemberTarget {
                root: StaticMemberRoot::Binding("Žofia".to_string()),
                segments: vec![
                    StaticMemberSegment::Member("users".to_string()),
                    StaticMemberSegment::CanonicalNumericIndex(12),
                    StaticMemberSegment::StringKey("full name".to_string()),
                    StaticMemberSegment::Member("default".to_string()),
                ],
            }
        );
    }

    #[test]
    fn parses_this_as_a_distinct_authoritative_root() {
        for (expression, first) in [
            ("this.prop", StaticMemberSegment::Member("prop".to_string())),
            ("this[0]", StaticMemberSegment::CanonicalNumericIndex(0)),
            (
                "this[\"a-b\"]",
                StaticMemberSegment::StringKey("a-b".to_string()),
            ),
            (
                "this.nested.leaf",
                StaticMemberSegment::Member("nested".to_string()),
            ),
        ] {
            let parsed = parse_static_member_target(expression).expect(expression);
            assert_eq!(parsed.root, StaticMemberRoot::This);
            assert_eq!(parsed.segments[0], first);
        }
    }

    #[test]
    fn enforces_strict_eof_and_rejects_dynamic_or_executable_syntax() {
        for expression in [
            "obj",
            "this",
            "this?.x",
            "this[key]",
            "this.#x",
            "this.x()",
            "obj?.x",
            "obj.x()",
            "obj[key]",
            "obj['x']",
            "obj[`x`]",
            "obj.#x",
            "obj + x",
            "obj.x = 1",
            "obj[0].x;evil",
            "obj .x",
            "obj. x",
            "obj[-1]",
            "obj[1.0]",
            "obj[1e2]",
            "obj[01]",
            "obj[]",
            "obj[",
            "obj.",
            "obj.x ",
            "obj.x//comment",
            "obj.x/*comment*/",
        ] {
            assert!(
                parse_static_member_target(expression).is_err(),
                "must reject {expression:?}"
            );
        }
    }

    #[test]
    fn rejects_forbidden_meta_keys_in_every_static_form() {
        for expression in [
            "__proto__.x",
            "prototype.x",
            "constructor.x",
            "obj.__proto__",
            "obj.prototype",
            "obj.constructor",
            "obj[\"__proto__\"]",
            "obj[\"prototype\"]",
            "obj[\"constructor\"]",
            "obj[\"__pro\\u0074o__\"]",
            "obj[\"protot\\u0079pe\"]",
            "obj[\"constr\\u0075ctor\"]",
        ] {
            assert_eq!(
                parse_static_member_target(expression),
                Err(StaticMemberTargetError::ForbiddenKey),
                "meta key {expression:?}"
            );
        }
    }

    #[test]
    fn bounds_expression_depth_keys_and_uses_the_repo_js_safe_numeric_policy() {
        assert_eq!(
            parse_static_member_target(""),
            Err(StaticMemberTargetError::Empty)
        );
        assert_eq!(
            parse_static_member_target("root"),
            Err(StaticMemberTargetError::MissingSegment)
        );
        assert_eq!(
            parse_static_member_target(&"x".repeat(MAX_TARGET_BYTES + 1)),
            Err(StaticMemberTargetError::TooLong)
        );
        assert!(parse_static_member_target("root.a.b.c.d.e.f.g.h").is_ok());
        assert_eq!(
            parse_static_member_target("root.a.b.c.d.e.f.g.h.i"),
            Err(StaticMemberTargetError::TooDeep)
        );
        assert_eq!(
            parse_static_member_target("root[9007199254740991]")
                .expect("safe integer")
                .segments,
            vec![StaticMemberSegment::CanonicalNumericIndex(
                MAX_SAFE_JAVASCRIPT_INTEGER
            )]
        );
        assert_eq!(
            parse_static_member_target("root[9007199254740992]"),
            Err(StaticMemberTargetError::InvalidNumericIndex)
        );
        for index in [4_294_967_294_u64, 4_294_967_295] {
            assert_eq!(
                parse_static_member_target(&format!("root[{index}]"))
                    .expect("repo policy intentionally exceeds array-index range")
                    .segments,
                vec![StaticMemberSegment::CanonicalNumericIndex(index)]
            );
        }

        let exact_raw = format!("root[\"{}aa\"]", "\\u0061".repeat(681));
        assert_eq!(exact_raw.len(), MAX_TARGET_BYTES);
        assert!(parse_static_member_target(&exact_raw).is_ok());
        let over_raw = format!("{}x]", &exact_raw[..exact_raw.len() - 1]);
        assert_eq!(over_raw.len(), MAX_TARGET_BYTES + 1);
        assert_eq!(
            parse_static_member_target(&over_raw),
            Err(StaticMemberTargetError::TooLong)
        );
    }

    #[test]
    fn decodes_json_unicode_and_applies_utf8_byte_and_control_bounds_after_decode() {
        assert_eq!(
            parse_static_member_target("root[\"\\uD83D\\uDE00\"]")
                .expect("surrogate pair")
                .segments,
            vec![StaticMemberSegment::StringKey("😀".to_string())]
        );
        let boundary = "é".repeat(MAX_DEBUG_VARIABLE_NAME_BYTES / 2);
        assert!(parse_static_member_target(&format!(
            "root[{}]",
            serde_json::to_string(&boundary).expect("json")
        ))
        .is_ok());
        let over = format!("{boundary}x");
        assert_eq!(
            parse_static_member_target(&format!(
                "root[{}]",
                serde_json::to_string(&over).expect("json")
            )),
            Err(StaticMemberTargetError::KeyTooLong)
        );
        for expression in ["root[\"\\u0000\"]", "root[\"\\u001f\"]", "root.\nkey"] {
            assert_eq!(
                parse_static_member_target(expression),
                Err(StaticMemberTargetError::ControlCharacter)
            );
        }
        assert_eq!(
            parse_static_member_target("root[\"\\uD800\"]"),
            Err(StaticMemberTargetError::InvalidStringKey)
        );
        assert_eq!(
            parse_static_member_target("root[\"\\uDC00\"]"),
            Err(StaticMemberTargetError::InvalidStringKey)
        );
        assert_eq!(
            parse_static_member_target("root[\"\"]"),
            Err(StaticMemberTargetError::EmptyKey)
        );
        assert!(parse_static_member_target("root[\"   \"]").is_ok());
        assert_eq!(
            parse_static_member_target("root[\"\\u007f\"]"),
            Err(StaticMemberTargetError::ControlCharacter)
        );
    }

    #[test]
    fn json_quote_scanning_distinguishes_odd_and_even_backslash_runs() {
        for key in ["a\"b", "a\\", "a\\\\b"] {
            let expression = format!("root[{}]", serde_json::to_string(key).expect("encode key"));
            assert_eq!(
                parse_static_member_target(&expression)
                    .expect("valid escaped key")
                    .segments,
                vec![StaticMemberSegment::StringKey(key.to_string())]
            );
        }
        assert_eq!(
            parse_static_member_target("root[\"odd\\\"]"),
            Err(StaticMemberTargetError::InvalidStringKey)
        );
    }
}
