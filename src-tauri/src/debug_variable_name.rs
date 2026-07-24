pub(crate) const MAX_DEBUG_VARIABLE_NAME_BYTES: usize = 1_024;

pub(crate) fn is_valid_debug_variable_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_DEBUG_VARIABLE_NAME_BYTES
        && !name.chars().any(char::is_control)
}

/// Exact ECMAScript IdentifierName character policy used by the Debug Console
/// completion wire. Reserved words are valid labels; parsing context decides
/// whether a label can be inserted at a particular source position.
pub(crate) fn is_ecmascript_identifier_name(name: &str) -> bool {
    let mut characters = name.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (matches!(first, '$' | '_') || unicode_id_start::is_id_start(first))
        && characters.all(|character| {
            matches!(character, '$' | '_' | '\u{200c}' | '\u{200d}')
                || unicode_id_start::is_id_continue(character)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn predicate_uses_utf8_bytes_and_exact_closed_boundaries() {
        assert!(!is_valid_debug_variable_name(""));
        assert!(!is_valid_debug_variable_name("line\nbreak"));
        assert!(is_valid_debug_variable_name(&"x".repeat(1_024)));
        assert!(!is_valid_debug_variable_name(&"x".repeat(1_025)));
        assert!(is_valid_debug_variable_name(&"é".repeat(512)));
        assert!(!is_valid_debug_variable_name(&format!(
            "{}x",
            "é".repeat(512)
        )));
    }

    #[test]
    fn ecmascript_identifier_policy_matches_id_start_and_continue_boundaries() {
        for accepted in [
            "value",
            "$value",
            "_value",
            "δelta",
            "\u{2118}oot",
            "a\u{200c}b",
        ] {
            assert!(is_ecmascript_identifier_name(accepted), "{accepted:?}");
        }
        for rejected in ["", "0", "foo-bar", "two words", "🙂", "\u{200c}value"] {
            assert!(!is_ecmascript_identifier_name(rejected), "{rejected:?}");
        }
    }
}
