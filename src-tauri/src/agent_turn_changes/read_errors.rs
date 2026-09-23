pub(crate) const READ_BUSY: &str = "Too many turn changes reads. Try again shortly.";
pub(crate) const TRUST_CHANGED: &str = "Workspace trust changed while loading turn changes.";
pub(crate) const WORKSPACE_UNAVAILABLE: &str = "Turn changes workspace is unavailable.";
pub(crate) const RECORD_UNAVAILABLE: &str = "Saved turn changes are unavailable.";
pub(crate) const RECORD_READ_FAILED: &str = "Saved turn changes could not be read.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_read_errors_match_the_frontend_retry_whitelist() {
        assert_eq!(
            [
                READ_BUSY,
                TRUST_CHANGED,
                WORKSPACE_UNAVAILABLE,
                RECORD_UNAVAILABLE,
                RECORD_READ_FAILED,
            ],
            [
                "Too many turn changes reads. Try again shortly.",
                "Workspace trust changed while loading turn changes.",
                "Turn changes workspace is unavailable.",
                "Saved turn changes are unavailable.",
                "Saved turn changes could not be read.",
            ]
        );
    }
}
