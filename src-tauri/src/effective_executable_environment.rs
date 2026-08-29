const MAX_EFFECTIVE_PATH_BYTES: usize = 64 * 1024;

pub(crate) trait EffectiveExecutableEnvironmentSource {
    fn effective_path(&self) -> &str;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct EffectiveExecutablePath<'a> {
    value: &'a str,
}

impl<'a> EffectiveExecutablePath<'a> {
    pub(crate) fn from_source(
        source: &'a dyn EffectiveExecutableEnvironmentSource,
    ) -> Result<Self, String> {
        Self::new(source.effective_path())
    }

    pub(crate) fn new(value: &'a str) -> Result<Self, String> {
        if value.is_empty() {
            return Err("The effective executable PATH must not be empty.".to_string());
        }
        if value.len() > MAX_EFFECTIVE_PATH_BYTES {
            return Err("The effective executable PATH exceeds the supported length.".to_string());
        }
        if value.contains('\0') {
            return Err("The effective executable PATH contains an invalid byte.".to_string());
        }
        Ok(Self { value })
    }

    pub(crate) fn as_str(self) -> &'a str {
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeEnvironment(&'static str);

    impl EffectiveExecutableEnvironmentSource for FakeEnvironment {
        fn effective_path(&self) -> &str {
            self.0
        }
    }

    #[test]
    fn adapter_exposes_only_the_source_path() {
        let source = FakeEnvironment("/opt/codevo/bin:/usr/bin");

        assert_eq!(
            EffectiveExecutablePath::from_source(&source)
                .expect("effective path")
                .as_str(),
            "/opt/codevo/bin:/usr/bin"
        );
    }

    #[test]
    fn rejects_invalid_effective_paths_fail_closed() {
        assert!(EffectiveExecutablePath::new("").is_err());
        assert!(EffectiveExecutablePath::new("/bin\0/usr/bin").is_err());
        assert!(EffectiveExecutablePath::new(&"a".repeat(MAX_EFFECTIVE_PATH_BYTES + 1)).is_err());
    }
}
