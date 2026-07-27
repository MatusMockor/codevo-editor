// This file is included by `debug_source_map_registry.rs` so the descriptor
// implementation can share its private authority types without widening the API.

impl SourceMapLoader {
    fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|error| format!("Unable to resolve debugger workspace root: {error}"))?;
        let root_directory = File::open(&root)
            .map_err(|error| format!("Unable to retain debugger workspace root: {error}"))?;
        let transport_id = NEXT_SOURCE_MAP_TRANSPORT_ID
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map_err(|_| "Source-map transport identity is exhausted.".to_string())?;
        Ok(Self {
            inner: Arc::new(SourceMapLoaderInner {
                root,
                root_directory,
                transport_id,
                next_generation: AtomicU64::new(1),
            }),
        })
    }

    pub(crate) fn prepare_script(
        &self,
        script_id: &str,
        generated_url: &str,
        source_map_url: &str,
    ) -> Result<PreparedSourceMap, String> {
        self.reserve_script(script_id, generated_url, source_map_url)?
            .prepare()
    }

    pub(crate) fn reserve_script(
        &self,
        script_id: &str,
        generated_url: &str,
        source_map_url: &str,
    ) -> Result<SourceMapPreparation, String> {
        validate_identity_component(script_id, MAX_SCRIPT_ID_BYTES, "script id")?;
        validate_identity_component(generated_url, MAX_GENERATED_URL_BYTES, "generated URL")?;
        if source_map_url.is_empty() || source_map_url.len() > MAX_SOURCE_MAP_URL_BYTES {
            return Err("Source-map URL is empty or exceeds the session limit.".to_string());
        }
        let generation = self
            .inner
            .next_generation
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map_err(|_| "Source-map registration generation is exhausted.".to_string())?;
        let generated_path = path_from_file_url(generated_url)
            .map(PathBuf::from)
            .ok_or_else(|| "Source-map generated URL is not a workspace file URL.".to_string())?;
        let generated = self.retain_existing_workspace_file(&generated_path)?;
        let generated_base = generated
            .display_path
            .parent()
            .unwrap_or(&self.inner.root)
            .to_path_buf();
        let source_map = if let Some(encoded) = inline_base64_payload(source_map_url) {
            let maximum_encoded = MAX_SOURCE_MAP_BYTES.saturating_mul(4).div_ceil(3) + 4;
            if encoded.len() > maximum_encoded {
                return Err(format!(
                    "Inline source map exceeds the {MAX_SOURCE_MAP_BYTES}-byte limit."
                ));
            }
            ReservedSourceMap::Inline {
                encoded: encoded.to_string(),
                source_base: generated_base,
            }
        } else {
            let raw_map_path = path_from_file_url(source_map_url)
                .map(PathBuf::from)
                .unwrap_or_else(|| generated_base.join(source_map_url));
            let authority = self.retain_existing_workspace_file(&raw_map_path)?;
            let source_base = authority
                .display_path
                .parent()
                .unwrap_or(&self.inner.root)
                .to_path_buf();
            ReservedSourceMap::External {
                authority,
                source_base,
            }
        };
        Ok(SourceMapPreparation {
            generated,
            identity: SourceMapScriptIdentity {
                transport_id: self.inner.transport_id,
                generation,
                script_id: script_id.to_string(),
                generated_url: generated_url.to_string(),
            },
            loader: self.clone(),
            source_map,
            completion: Arc::new(SourceMapCompletion::new()),
        })
    }

    fn prepare_preloaded(
        &self,
        generated_url: &str,
        source_map_url: &str,
    ) -> Result<PreparedSourceMap, String> {
        let generation = self.inner.next_generation.load(Ordering::Relaxed);
        self.prepare_script(
            &format!("preloaded-source-map-{generation}"),
            generated_url,
            source_map_url,
        )
    }

    fn read_reserved_source_map(
        &self,
        source_map: ReservedSourceMap,
    ) -> Result<(Vec<u8>, PathBuf), String> {
        match source_map {
            ReservedSourceMap::Inline {
                encoded,
                source_base,
            } => {
                let bytes = STANDARD
                    .decode(&encoded)
                    .map_err(|error| format!("Unable to decode inline source map: {error}"))?;
                if bytes.len() > MAX_SOURCE_MAP_BYTES {
                    return Err(format!(
                        "Inline source map exceeds the {MAX_SOURCE_MAP_BYTES}-byte limit."
                    ));
                }
                Ok((bytes, source_base))
            }
            ReservedSourceMap::External {
                authority,
                source_base,
            } => {
                let mut file = authority.file.try_clone().map_err(|error| {
                    format!("Unable to duplicate retained source-map descriptor: {error}")
                })?;
                let bytes = read_bounded(&mut file, MAX_SOURCE_MAP_BYTES).map_err(|error| {
                    format!("Unable to read source map within the session limit: {error}")
                })?;
                Ok((bytes, source_base))
            }
        }
    }

    fn retain_existing_workspace_file(&self, path: &Path) -> Result<RetainedSourcePath, String> {
        let relative = self.workspace_relative(path)?;
        let file = self.open_relative_file(&relative)?;
        self.ensure_current_root_identity()?;
        Ok(RetainedSourcePath {
            display_path: self.inner.root.join(&relative),
            file: Arc::new(file),
            relative_path: relative,
        })
    }

    fn validate_source_authority(&self, authority: &RetainedSourcePath) -> bool {
        if self.ensure_current_root_identity().is_err() {
            return false;
        }
        let Ok(current) = self.open_relative_file(&authority.relative_path) else {
            return false;
        };
        #[cfg(unix)]
        {
            let Ok(retained) = authority.file.metadata() else {
                return false;
            };
            let Ok(current) = current.metadata() else {
                return false;
            };
            if retained.dev() != current.dev() || retained.ino() != current.ino() {
                return false;
            }
        }
        self.ensure_current_root_identity().is_ok()
    }

    fn workspace_relative(&self, path: &Path) -> Result<PathBuf, String> {
        self.ensure_current_root_identity()?;
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.inner.root.join(path)
        };
        let normalized = normalize_absolute_path(&absolute)
            .ok_or_else(|| "Debugger source path is invalid.".to_string())?;
        let relative = normalized
            .strip_prefix(&self.inner.root)
            .map_err(|_| "Debugger source is outside the workspace root.".to_string())?;
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("Debugger source path is invalid.".to_string());
        }
        Ok(relative.to_path_buf())
    }

    fn ensure_current_root_identity(&self) -> Result<(), String> {
        #[cfg(unix)]
        {
            let retained = self
                .inner
                .root_directory
                .metadata()
                .map_err(|_| "Debugger workspace authority is unavailable.".to_string())?;
            let current = std::fs::metadata(&self.inner.root)
                .map_err(|_| "Debugger workspace authority is unavailable.".to_string())?;
            if retained.dev() != current.dev() || retained.ino() != current.ino() {
                return Err("Debugger workspace authority changed.".to_string());
            }
        }
        Ok(())
    }

    #[cfg(unix)]
    fn open_relative_file(&self, relative: &Path) -> Result<File, String> {
        use std::ffi::CString;
        let mut current = self
            .inner
            .root_directory
            .try_clone()
            .map_err(|_| "Debugger workspace authority is unavailable.".to_string())?;
        let components = relative.components().collect::<Vec<_>>();
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                return Err("Debugger source path is invalid.".to_string());
            };
            let name = CString::new(name.as_encoded_bytes())
                .map_err(|_| "Debugger source path is invalid.".to_string())?;
            let last = index + 1 == components.len();
            let flags = if last {
                libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC
            } else {
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
            };
            let descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
            if descriptor < 0 {
                return Err(
                    "Debugger source is unavailable through retained workspace authority."
                        .to_string(),
                );
            }
            current = unsafe { File::from_raw_fd(descriptor) };
        }
        let metadata = current
            .metadata()
            .map_err(|_| "Debugger source metadata is unavailable.".to_string())?;
        if !metadata.is_file() {
            return Err("Debugger source is not a regular workspace file.".to_string());
        }
        Ok(current)
    }

    #[cfg(not(unix))]
    fn open_relative_file(&self, relative: &Path) -> Result<File, String> {
        let path = self.inner.root.join(relative);
        let canonical = path
            .canonicalize()
            .map_err(|_| "Debugger source is unavailable.".to_string())?;
        if !canonical.starts_with(&self.inner.root) {
            return Err("Debugger source is outside the workspace root.".to_string());
        }
        let file =
            File::open(canonical).map_err(|_| "Debugger source is unavailable.".to_string())?;
        if !file
            .metadata()
            .map_err(|_| "Debugger source metadata is unavailable.".to_string())?
            .is_file()
        {
            return Err("Debugger source is not a regular workspace file.".to_string());
        }
        Ok(file)
    }
}
