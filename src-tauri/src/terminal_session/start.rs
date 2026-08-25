use super::*;

impl TerminalSupervisor {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn start(
        &self,
        cwd: PathBuf,
        size: TerminalSize,
        profile: TerminalProfile,
        shell_integration_base_dir: Option<PathBuf>,
        spawner: &dyn TerminalPtySpawner,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalRuntimeStatus, String> {
        self.start_with_options(
            TerminalLaunchRoots::workspace_root(cwd),
            None,
            None,
            TerminalStartOptions {
                #[cfg(test)]
                fault: None,
                profile,
                shell_integration_base_dir,
                size,
            },
            spawner,
            sink,
        )
    }

    #[cfg(unix)]
    pub(crate) fn start_descriptor_bound(
        &self,
        roots: TerminalLaunchRoots,
        cwd_directory: fs::File,
        workspace_authority: DebugWorkspaceAuthority,
        options: TerminalStartOptions,
        spawner: &dyn TerminalPtySpawner,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalRuntimeStatus, String> {
        self.start_with_options(
            roots,
            Some(Arc::new(cwd_directory)),
            Some(workspace_authority),
            options,
            spawner,
            sink,
        )
    }

    #[cfg(not(unix))]
    /// Preserve pathname-based terminal startup on platforms without `fchdir`,
    /// but never publish retained workspace authority for that weaker launch.
    pub(crate) fn start_descriptor_bound(
        &self,
        roots: TerminalLaunchRoots,
        _cwd_directory: fs::File,
        _workspace_authority: DebugWorkspaceAuthority,
        options: TerminalStartOptions,
        spawner: &dyn TerminalPtySpawner,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalRuntimeStatus, String> {
        self.start_with_options(roots, None, None, options, spawner, sink)
    }

    pub(super) fn start_with_options(
        &self,
        roots: TerminalLaunchRoots,
        cwd_directory: Option<Arc<fs::File>>,
        workspace_authority: Option<DebugWorkspaceAuthority>,
        options: TerminalStartOptions,
        spawner: &dyn TerminalPtySpawner,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalRuntimeStatus, String> {
        let TerminalLaunchRoots {
            cwd,
            workspace_root,
        } = roots;
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        #[cfg(test)]
        let fault = options.fault;
        #[cfg(not(unix))]
        drop(cwd_directory);
        let request = TerminalLaunchRequest {
            cwd: cwd.clone(),
            #[cfg(unix)]
            cwd_directory,
            profile: options.profile,
            shell_integration_base_dir: options.shell_integration_base_dir,
            size: options.size.normalized(),
        };
        let spawned = spawner.spawn(&request)?;
        let child = UnpublishedTerminalChild::new(spawned.child);
        #[cfg(test)]
        if fault == Some(TerminalStartFault::ReaderSpawn) {
            return Err("Injected terminal reader spawn failure.".to_string());
        }
        let stop_requested = Arc::new(AtomicBool::new(false));
        let start_gate = Arc::new(TerminalStartGate::new());
        let writer = Arc::new(Mutex::new(spawned.writer));
        let process_id = child.child().process_id();
        let killer = child.child().clone_killer();
        let reader = spawn_terminal_reader(
            spawned.reader,
            Arc::clone(&sink),
            Arc::clone(&start_gate),
            Arc::clone(&stop_requested),
            session_id,
        )?;
        #[cfg(test)]
        if fault == Some(TerminalStartFault::AfterReaderSpawn) {
            abort_unpublished_start(child, reader, None, &start_gate, &stop_requested);
            return Err("Injected failure after terminal reader spawn.".to_string());
        }
        let status = TerminalRuntimeStatus::Running {
            cols: request.size.cols,
            cwd: cwd.to_string_lossy().to_string(),
            rows: request.size.rows,
            session_id,
        };
        #[cfg(test)]
        if fault == Some(TerminalStartFault::WaiterSpawn) {
            abort_unpublished_start(child, reader, None, &start_gate, &stop_requested);
            return Err("Injected terminal waiter spawn failure.".to_string());
        }
        let TerminalWaiterLaunch {
            handle: waiter,
            child_sender: child_tx,
        } = match spawn_waiter(
            Arc::clone(&sink),
            Arc::clone(&start_gate),
            Arc::clone(&stop_requested),
            session_id,
            Arc::clone(&self.sessions),
        ) {
            Ok(waiter) => waiter,
            Err(error) => {
                abort_unpublished_start(child, reader, None, &start_gate, &stop_requested);
                return Err(error);
            }
        };
        #[cfg(test)]
        if fault == Some(TerminalStartFault::BeforeCommit) {
            drop(child_tx);
            abort_unpublished_start(child, reader, Some(waiter), &start_gate, &stop_requested);
            return Err("Injected terminal session commit failure.".to_string());
        }
        let mut sessions = match self.sessions.lock() {
            Ok(sessions) => sessions,
            Err(error) => {
                drop(child_tx);
                abort_unpublished_start(child, reader, Some(waiter), &start_gate, &stop_requested);
                return Err(error.to_string());
            }
        };
        let child = child.take();
        if let Err(error) = child_tx.send(child) {
            abort_unpublished_start(
                UnpublishedTerminalChild::new(error.0),
                reader,
                Some(waiter),
                &start_gate,
                &stop_requested,
            );
            return Err("Terminal waiter stopped before accepting the child.".to_string());
        }
        let session = RunningTerminalSession {
            cwd,
            workspace_root,
            start_gate: Arc::clone(&start_gate),
            process_tree_terminator: ProcessTreeTerminator::new(process_id, killer),
            reader: Some(reader),
            resizer: spawned.resizer,
            sink: Arc::clone(&sink),
            stop_requested: Arc::clone(&stop_requested),
            task_process_groups: HashMap::new(),
            waiter: Some(waiter),
            writer,
            workspace_authority,
        };
        #[cfg(test)]
        if fault == Some(TerminalStartFault::AfterWaiterAcceptance) {
            drop(sessions);
            terminate_session(session);
            return Err("Injected failure after terminal waiter acceptance.".to_string());
        }
        sessions.insert(session_id, session);
        drop(sessions);
        sink.emit_status(TerminalRuntimeStatus::Starting { session_id });
        sink.emit_status(status.clone());
        Ok(status)
    }
}

fn abort_unpublished_start(
    child: UnpublishedTerminalChild,
    reader: JoinHandle<()>,
    mut waiter: Option<JoinHandle<()>>,
    start_gate: &TerminalStartGate,
    stop_requested: &AtomicBool,
) {
    stop_requested.store(true, Ordering::SeqCst);
    start_gate.release();
    drop(child);
    if wait_for_thread(Some(&reader), TERMINAL_THREAD_JOIN_TIMEOUT) {
        let _ = reader.join();
    }
    if let Some(handle) = waiter.take() {
        if wait_for_thread(Some(&handle), TERMINAL_THREAD_JOIN_TIMEOUT) {
            let _ = handle.join();
        }
    }
}
