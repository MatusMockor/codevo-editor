use super::registry::MAX_LANGUAGE_SERVER_WORKSPACES;
use super::*;

pub(crate) struct JavaScriptTypeScriptStartCleanupLease<'a> {
    registry: &'a JavaScriptTypeScriptLanguageServerRegistry,
    lease: LanguageServerStartCleanupLease<'a>,
    cleanup_reservation: Option<CleanupReservation<'a>>,
}

pub(super) struct CleanupReservation<'a> {
    registry: &'a JavaScriptTypeScriptLanguageServerRegistry,
    armed: bool,
}

pub(super) struct LanguageServerStartCleanupLease<'a> {
    registry: &'a LanguageServerRegistry,
    root_path: String,
    runtime_id: String,
    supervisor: Arc<LanguageServerSupervisor>,
    armed: bool,
}

struct StartReplacementMarker<'a> {
    registry: &'a JavaScriptTypeScriptLanguageServerRegistry,
    runtime_id: String,
    armed: bool,
}

impl JavaScriptTypeScriptLanguageServerRegistry {
    pub(crate) fn reserve_start_cleanup(
        &self,
        root_path: &str,
        status_sink: &dyn StatusSink,
    ) -> Result<JavaScriptTypeScriptStartCleanupLease<'_>, String> {
        let runtime_id = workspace_runtime_id(root_path);
        let mut marker = {
            if is_active_status(&self.registry.status(root_path)) {
                return Err("Language server already running.".to_string());
            }
            let mut replacements = self
                .start_replacements
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if replacements.contains(&runtime_id) {
                return Err("Language server start replacement is already reserved.".to_string());
            }
            if replacements.len() >= MAX_LANGUAGE_SERVER_WORKSPACES {
                return Err(format!(
                    "Language server start replacement capacity ({MAX_LANGUAGE_SERVER_WORKSPACES}) was reached."
                ));
            }
            replacements.insert(runtime_id.clone());
            drop(replacements);
            StartReplacementMarker {
                registry: self,
                runtime_id,
                armed: true,
            }
        };
        status_sink.begin_document_session_replacement()?;
        let cleanup_reservation = self.reserve_cleanup();
        if is_active_status(&self.registry.status(root_path)) {
            return Err("Language server start reservation was superseded.".to_string());
        }
        marker.complete()?;
        let lease = self.registry.reserve_start_cleanup(root_path)?;
        Ok(JavaScriptTypeScriptStartCleanupLease {
            registry: self,
            lease,
            cleanup_reservation: Some(cleanup_reservation),
        })
    }

    pub(super) fn reserve_cleanup(&self) -> CleanupReservation<'_> {
        let mut active = self
            .cleanup_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *active {
            active = self
                .cleanup_ready
                .wait(active)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        *active = true;
        CleanupReservation {
            registry: self,
            armed: true,
        }
    }

    pub(super) fn try_reserve_cleanup(&self) -> Option<CleanupReservation<'_>> {
        let mut active = self
            .cleanup_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active {
            return None;
        }
        *active = true;
        Some(CleanupReservation {
            registry: self,
            armed: true,
        })
    }
}

impl CleanupReservation<'_> {
    pub(super) fn release(&mut self) {
        if !self.armed {
            return;
        }
        let mut active = self
            .registry
            .cleanup_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *active = false;
        self.armed = false;
        drop(active);
        self.registry.cleanup_ready.notify_all();
    }
}

impl Drop for CleanupReservation<'_> {
    fn drop(&mut self) {
        self.release();
    }
}

impl StartReplacementMarker<'_> {
    fn complete(&mut self) -> Result<(), String> {
        let mut replacements = self
            .registry
            .start_replacements
            .lock()
            .map_err(|error| error.to_string())?;
        if !replacements.remove(&self.runtime_id) {
            return Err("Language server start replacement marker was lost.".to_string());
        }
        self.armed = false;
        Ok(())
    }
}

impl Drop for StartReplacementMarker<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        self.registry
            .start_replacements
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.runtime_id);
    }
}

impl JavaScriptTypeScriptStartCleanupLease<'_> {
    pub(crate) fn running_roots(&self) -> Result<Vec<String>, String> {
        self.lease.running_roots()
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn start_with_auto_restart(
        mut self,
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
        if let Some(mut cleanup_reservation) = self.cleanup_reservation.take() {
            cleanup_reservation.release();
        }
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
        if let Err(error) = self.registry.store_launch_context_if_active(
            &root_path,
            command,
            initialize_request,
            &status,
        ) {
            self.registry.registry.stop_if_status(&root_path, &status);
            return Err(error);
        }
        Ok(status)
    }
}

impl LanguageServerRegistry {
    pub(super) fn reserve_start_cleanup(
        &self,
        root_path: &str,
    ) -> Result<LanguageServerStartCleanupLease<'_>, String> {
        let (lease, replaced) = self.reserve_start_cleanup_parts(root_path)?;
        if let Some(replaced) = replaced {
            replaced.stop();
        }
        Ok(lease)
    }

    pub(super) fn reserve_start_cleanup_parts(
        &self,
        root_path: &str,
    ) -> Result<
        (
            LanguageServerStartCleanupLease<'_>,
            Option<Arc<LanguageServerSupervisor>>,
        ),
        String,
    > {
        let runtime_id = workspace_runtime_id(root_path);
        let supervisor = Arc::new(LanguageServerSupervisor::new_with_session_id_source(
            self.server_label,
            Arc::clone(&self.next_session_id),
        ));
        supervisor.reserve_start_cleanup()?;
        let replaced = {
            let mut supervisors = self.supervisors.lock().map_err(|error| error.to_string())?;
            if supervisors
                .get(&runtime_id)
                .is_some_and(|existing| is_active_status(&existing.status()))
            {
                return Err("Language server already running.".to_string());
            }
            if !supervisors.contains_key(&runtime_id)
                && supervisors.len() >= MAX_LANGUAGE_SERVER_WORKSPACES
            {
                return Err("Language server workspace capacity (64) was reached.".to_string());
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
        Ok((lease, replaced))
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

    pub(super) fn start_with_auto_restart(
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
