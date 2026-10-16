use crate::{
    trust::{WorkspaceTrustService, WorkspaceTrustSnapshot},
    workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceRegistry},
};
use std::{
    fs::File,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_ROOT_PATH_BYTES: usize = 4096;

pub(super) struct AuthorityMessages {
    pub(super) invalid_root: &'static str,
    pub(super) not_registered: &'static str,
    pub(super) invalid_path: &'static str,
    pub(super) trust_unavailable: &'static str,
    pub(super) untrusted: &'static str,
    pub(super) identity_changed: &'static str,
    pub(super) no_longer_registered: &'static str,
    pub(super) changed: &'static str,
    pub(super) unavailable: &'static str,
    pub(super) path_changed: &'static str,
    pub(super) trust_changed: &'static str,
}

pub(super) struct WorkspaceAuthority<'a> {
    registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
    messages: &'static AuthorityMessages,
    path: PathBuf,
    canonical: String,
    descriptor: ManagedWorkspaceDescriptor,
    expected_trust: WorkspaceTrustSnapshot,
    root: File,
}

pub(super) fn is_bounded_root_path(root_path: &str) -> bool {
    !root_path.is_empty() && root_path.len() <= MAX_ROOT_PATH_BYTES && !root_path.contains('\0')
}

impl<'a> WorkspaceAuthority<'a> {
    pub(super) fn capture(
        registry: &'a WorkspaceRegistry,
        trust: &'a Mutex<WorkspaceTrustService>,
        root_path: &str,
        messages: &'static AuthorityMessages,
    ) -> Result<Self, String> {
        if !is_bounded_root_path(root_path) {
            return Err(messages.invalid_root.into());
        }
        let path = PathBuf::from(root_path);
        let descriptor = registry
            .descriptor_for_registered_path(&path)
            .map_err(|_| messages.not_registered)?;
        let canonical = descriptor
            .canonical_root_path
            .to_str()
            .ok_or(messages.invalid_path)?
            .to_owned();
        let expected_trust = trust
            .lock()
            .map_err(|_| messages.trust_unavailable)?
            .snapshot(&canonical);
        if !expected_trust.trusted {
            return Err(messages.untrusted.into());
        }
        let root = registry
            .clone_root_for_path(&path)
            .map_err(|_| messages.identity_changed)?;
        Ok(Self {
            registry,
            trust,
            messages,
            path,
            canonical,
            descriptor,
            expected_trust,
            root,
        })
    }

    pub(super) fn root(&self) -> &File {
        &self.root
    }

    pub(super) fn canonical_root(&self) -> &str {
        &self.canonical
    }

    pub(super) fn confirm(&self) -> Result<(), String> {
        let messages = self.messages;
        let current = self
            .registry
            .descriptor_for_registered_path(&self.path)
            .map_err(|_| messages.no_longer_registered)?;
        if current != self.descriptor {
            return Err(messages.changed.into());
        }
        let current_root = self
            .registry
            .clone_root_for_path(&self.path)
            .map_err(|_| messages.identity_changed)?;
        let original = self.root.metadata().map_err(|_| messages.unavailable)?;
        let current = current_root.metadata().map_err(|_| messages.unavailable)?;
        let visible = std::fs::metadata(Path::new(&self.descriptor.canonical_root_path))
            .map_err(|_| messages.path_changed)?;
        if [current, visible]
            .iter()
            .any(|metadata| metadata.dev() != original.dev() || metadata.ino() != original.ino())
        {
            return Err(messages.identity_changed.into());
        }
        if self
            .trust
            .lock()
            .map_err(|_| messages.trust_unavailable)?
            .snapshot(&self.canonical)
            != self.expected_trust
        {
            return Err(messages.trust_changed.into());
        }
        Ok(())
    }
}
