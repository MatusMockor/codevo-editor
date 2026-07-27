use crate::lsp_session::LanguageServerRuntimeStatus;

pub(crate) fn supports_code_action_resolve(status: &LanguageServerRuntimeStatus) -> bool {
    matches!(
        status,
        LanguageServerRuntimeStatus::Running { capabilities, .. }
            if capabilities.code_action_resolve
    )
}

pub(crate) fn supports_inlay_hint_resolve(status: &LanguageServerRuntimeStatus) -> bool {
    matches!(
        status,
        LanguageServerRuntimeStatus::Running { capabilities, .. }
            if capabilities.inlay_hint_resolve
    )
}
