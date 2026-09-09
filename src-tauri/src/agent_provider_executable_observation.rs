use super::*;

#[derive(Clone, Debug)]
pub(super) struct ExecutableObservation {
    #[cfg(unix)]
    fields: [u64; 10],
}

impl ExecutableObservation {
    pub(super) fn capture(metadata: &fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Self {
                fields: [
                    metadata.dev(),
                    metadata.ino(),
                    metadata.len(),
                    u64::from(metadata.mode()),
                    u64::from(metadata.uid()),
                    u64::from(metadata.gid()),
                    metadata.mtime() as u64,
                    metadata.mtime_nsec() as u64,
                    metadata.ctime() as u64,
                    metadata.ctime_nsec() as u64,
                ],
            }
        }
        #[cfg(not(unix))]
        {
            let _ = metadata;
            Self {}
        }
    }

    pub(super) fn matches(&self, metadata: &fs::Metadata) -> bool {
        #[cfg(unix)]
        {
            self.fields == Self::capture(metadata).fields
        }
        #[cfg(not(unix))]
        {
            let _ = metadata;
            true
        }
    }
}

impl ExecutableIdentity {
    pub fn is_reusable_for_discovery(&self) -> bool {
        matches!(self.launch, ExecutableLaunch::Native) && self.is_current_for_observation()
    }

    pub fn is_current_for_observation(&self) -> bool {
        #[cfg(unix)]
        {
            if self.open_observed_path().is_none() {
                return false;
            }
            match &self.launch {
                ExecutableLaunch::Native => true,
                ExecutableLaunch::Script { interpreter } => {
                    interpreter.is_current_for_observation()
                }
            }
        }
        #[cfg(not(unix))]
        {
            self.is_current_for_spawn()
        }
    }

    #[cfg(unix)]
    fn open_observed_path(&self) -> Option<fs::File> {
        if fs::canonicalize(&self.canonical_path).ok()? != self.canonical_path {
            return None;
        }
        let descriptor = open_executable(&self.canonical_path).ok()?;
        if !self.observation.matches(&descriptor.metadata().ok()?)
            || !self.observation.matches(&self.descriptor.metadata().ok()?)
        {
            return None;
        }
        Some(descriptor)
    }

    pub(super) fn exact_shallow_is_current_with(&self, cancelled: impl Fn() -> bool) -> bool {
        #[cfg(unix)]
        {
            let Some(path_descriptor) = self.open_observed_path() else {
                return false;
            };
            if executable_digest_cancellable(&self.descriptor, self.size_bytes, &cancelled)
                .ok()
                .as_ref()
                != Some(&self.digest)
            {
                return false;
            }
            !cancelled()
                && path_descriptor
                    .metadata()
                    .is_ok_and(|metadata| self.observation.matches(&metadata))
                && self.open_observed_path().is_some()
        }
        #[cfg(not(unix))]
        {
            self.retained_shallow_is_current_with(&cancelled)
                && self.path_is_current_shallow_with(cancelled)
        }
    }
}

#[cfg(all(test, unix))]
#[path = "agent_provider_executable_observation_tests.rs"]
mod tests;
