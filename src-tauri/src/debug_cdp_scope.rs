pub(super) fn display_name(scope_type: &str) -> String {
    let mut characters = scope_type.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => "Scope".to_string(),
    }
}
