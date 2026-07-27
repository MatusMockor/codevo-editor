use super::*;

pub(crate) struct JavaScriptTypeScriptStartCleanupLease<'a> {
    registry: &'a JavaScriptTypeScriptLanguageServerRegistry,
    lease: LanguageServerStartCleanupLease<'a>,
    _cleanup_gate: std::sync::MutexGuard<'a, ()>,
}

struct LanguageServerStartCleanupLease<'a> {
    registry: &'a LanguageServerRegistry,
    root_path: String,
    runtime_id: String,
    supervisor: Arc<LanguageServerSupervisor>,
    armed: bool,
}

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub(crate) fn reserve_start_cleanup(
        &self,
        root_path: &str,
    ) -> Result<JavaScriptTypeScriptStartCleanupLease<'_>, String> {
        let cleanup_gate = self
            .cleanup_gate
            .lock()
            .map_err(|error| error.to_string())?;
        Ok(JavaScriptTypeScriptStartCleanupLease {
            registry: self,
            lease: self.registry.reserve_start_cleanup(root_path)?,
            _cleanup_gate: cleanup_gate,
        })
    }
}

impl JavaScriptTypeScriptStartCleanupLease<'_> {
    pub(crate) fn running_roots(&self) -> Result<Vec<String>, String> {
        self.lease.running_roots()
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn start_with_auto_restart(
        self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        status_sink: Arc<dyn StatusSink>,
        diagnostics_sink: Arc<dyn DiagnosticsSink>,
        workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
        refresh_sink: Arc<dyn RefreshSink>,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let root_path = self.lease.root_path.clone();
        let status = self.lease.start_with_auto_restart(
            command,
            initialize_request,
            spawner,
            LanguageServerEventSinks::new(
                status_sink,
                diagnostics_sink,
                workspace_edit_sink,
                refresh_sink,
            ),
            restart_controller,
        )?;
        self.registry.store_launch_context_if_active(
            &root_path,
            command,
            initialize_request,
            &status,
        );
        Ok(status)
    }
}

impl LanguageServerRegistry {
    fn reserve_start_cleanup(
        &self,
        root_path: &str,
    ) -> Result<LanguageServerStartCleanupLease<'_>, String> {
        let runtime_id = workspace_runtime_id(root_path);
        let supervisor = Arc::new(LanguageServerSupervisor::new_with_label(self.server_label));
        supervisor.reserve_start_cleanup()?;
        let replaced = {
            let mut supervisors = self.supervisors.lock().map_err(|error| error.to_string())?;
            if supervisors
                .get(&runtime_id)
                .is_some_and(|existing| is_active_status(&existing.status()))
            {
                return Err("Language server already running.".to_string());
            }
            supervisors.insert(runtime_id.clone(), Arc::clone(&supervisor))
        };
        let lease = LanguageServerStartCleanupLease {
            registry: self,
            root_path: root_path.to_string(),
            runtime_id,
            supervisor,
            armed: true,
        };
        if let Some(replaced) = replaced {
            replaced.stop();
        }
        Ok(lease)
    }
}

impl LanguageServerStartCleanupLease<'_> {
    fn is_current(&self) -> Result<bool, String> {
        let supervisors = self
            .registry
            .supervisors
            .lock()
            .map_err(|error| error.to_string())?;
        Ok(supervisors
            .get(&self.runtime_id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.supervisor)))
    }

    fn running_roots(&self) -> Result<Vec<String>, String> {
        let supervisors = self
            .registry
            .supervisors
            .lock()
            .map_err(|error| error.to_string())?;
        if !supervisors
            .get(&self.runtime_id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.supervisor))
        {
            return Err("Language server start reservation is no longer current.".to_string());
        }
        let mut roots = supervisors
            .iter()
            .filter(|&(_root_path, supervisor)| is_active_status(&supervisor.status()))
            .map(|(root_path, _supervisor)| root_path.clone())
            .collect::<Vec<_>>();
        roots.sort();
        Ok(roots)
    }

    fn start_with_auto_restart(
        mut self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        event_sinks: LanguageServerEventSinks,
        restart_controller: Arc<RestartController>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        if !self.is_current()? {
            return Err("Language server start reservation is no longer current.".to_string());
        }
        let status = self.supervisor.start_with_auto_restart_kind(
            command,
            initialize_request,
            spawner,
            event_sinks,
            restart_controller,
            StartKind::ReservedFresh,
        )?;
        self.armed = false;
        Ok(status)
    }
}

impl Drop for LanguageServerStartCleanupLease<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let mut supervisors = self
            .registry
            .supervisors
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(current) = supervisors.get(&self.runtime_id) else {
            return;
        };
        if !Arc::ptr_eq(current, &self.supervisor) {
            return;
        }
        let removed = supervisors.remove(&self.runtime_id);
        drop(supervisors);
        if let Some(supervisor) = removed {
            supervisor.stop();
        }
    }
}

impl LanguageServerSupervisor {
    pub(super) fn start_with_auto_restart_kind(
        self: &Arc<Self>,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
        event_sinks: LanguageServerEventSinks,
        restart_controller: Arc<RestartController>,
        start_kind: StartKind,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let LanguageServerEventSinks {
            status,
            diagnostics,
            workspace_edit,
            refresh,
        } = event_sinks;
        let restart_context = RestartContext {
            supervisor: Arc::downgrade(self),
            command: clone_command(command),
            initialize_request: clone_initialize_request(initialize_request),
            spawner: Arc::clone(&spawner),
            status_sink: Arc::clone(&status),
            diagnostics_sink: Arc::clone(&diagnostics),
            workspace_edit_sink: Arc::clone(&workspace_edit),
            refresh_sink: Arc::clone(&refresh),
            controller: restart_controller,
        };

        self.start_core(
            command,
            initialize_request,
            spawner.as_ref(),
            status,
            diagnostics,
            workspace_edit,
            refresh,
            Some(Arc::new(restart_context)),
            start_kind,
        )
    }

    fn reserve_start_cleanup(&self) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;
        if is_active_status(&status) {
            return Err("Language server already running.".to_string());
        }
        *status = LanguageServerRuntimeStatus::Starting { session_id: 0 };
        Ok(())
    }
}
