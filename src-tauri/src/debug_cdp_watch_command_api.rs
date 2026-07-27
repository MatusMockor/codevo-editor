impl CdpClient {
    pub(crate) fn request_until(
        &self,
        method: &str,
        params: Value,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<Value, String> {
        ensure_watch_request_current(deadline, revoked)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let result = self.request_with_timeout(method, params, remaining.min(self.request_timeout));
        ensure_watch_request_current(deadline, revoked)?;
        result
    }

    pub(crate) fn shutdown_until(&mut self, deadline: Instant) {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        let Some(handle) = self.io_thread.take() else {
            return;
        };
        if handle.thread().id() == thread::current().id() {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if self.io_completed.recv_timeout(remaining).is_ok() {
            let _ = handle.join();
        }
    }
}

impl NodeCdpAdapter {
    pub(crate) fn watch_current_pause_generation_until(
        &self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<Option<u64>, String> {
        let shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
        let epoch = shared.pause.as_ref().map(|pause| pause.pause_generation);
        drop(shared);
        ensure_watch_request_current(deadline, revoked)?;
        Ok(epoch)
    }

    pub(crate) fn watch_stack_trace_with_until<T>(
        &self,
        deadline: Instant,
        revoked: &AtomicBool,
        inspect: impl FnOnce(&[DebugStackFrame]) -> Result<T, String>,
    ) -> Result<T, String> {
        let shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        let result = inspect(&pause.frames)?;
        drop(shared);
        ensure_watch_request_current(deadline, revoked)?;
        Ok(result)
    }

    pub(crate) fn watch_scopes_with_until<T>(
        &self,
        frame_id: u64,
        deadline: Instant,
        revoked: &AtomicBool,
        inspect: impl FnOnce(&[DebugScopeInfo]) -> Result<T, String>,
    ) -> Result<T, String> {
        let shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        let scopes = pause
            .scopes
            .get(&frame_id)
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))?;
        let result = inspect(scopes)?;
        drop(shared);
        ensure_watch_request_current(deadline, revoked)?;
        Ok(result)
    }

    pub(crate) fn watch_run_if_waiting_for_debugger_until(
        &mut self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<(), String> {
        ensure_watch_request_current(deadline, revoked)?;
        self.client.request_until(
            "Runtime.runIfWaitingForDebugger",
            json!({}),
            deadline,
            revoked,
        )?;
        Ok(())
    }

    pub(crate) fn watch_pause_until(
        &mut self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<(), String> {
        ensure_watch_request_current(deadline, revoked)?;
        let deferred_or_duplicate = {
            let mut shared = self.shared.lock().map_err(|error| error.to_string())?;
            mark_explicit_pause_requested(&mut shared)
        };
        if deferred_or_duplicate {
            return Ok(());
        }
        match self
            .client
            .request_until("Debugger.pause", json!({}), deadline, revoked)
        {
            Ok(_) => Ok(()),
            Err(error) => {
                if let Ok(mut shared) = self.shared.lock() {
                    shared.explicit_pause_requested = false;
                }
                Err(error)
            }
        }
    }

    pub(crate) fn watch_step_until(
        &mut self,
        kind: StepKind,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<(), String> {
        ensure_watch_request_current(deadline, revoked)?;
        let method = match kind {
            StepKind::Continue => "Debugger.resume",
            StepKind::StepOver => "Debugger.stepOver",
            StepKind::StepInto => "Debugger.stepInto",
            StepKind::StepOut => "Debugger.stepOut",
        };
        self.client
            .request_until(method, json!({}), deadline, revoked)?;
        Ok(())
    }

    pub(crate) fn watch_terminate_until(&mut self, deadline: Instant) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.pending_restart_frame = None;
            shared.invalidate_pause();
        }
        self.client.shutdown_until(deadline);
        if let DebuggeeOwnership::Spawned(process) =
            std::mem::replace(&mut self.ownership, DebuggeeOwnership::External)
        {
            process.terminate();
        }
    }
}

fn lock_watch_shared_until<'a>(
    shared: &'a Mutex<CdpShared>,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<std::sync::MutexGuard<'a, CdpShared>, String> {
    loop {
        ensure_watch_request_current(deadline, revoked)?;
        match shared.try_lock() {
            Ok(shared) => return Ok(shared),
            Err(std::sync::TryLockError::WouldBlock) => thread::yield_now(),
            Err(std::sync::TryLockError::Poisoned(error)) => return Err(error.to_string()),
        }
    }
}

fn ensure_watch_request_current(deadline: Instant, revoked: &AtomicBool) -> Result<(), String> {
    if revoked.load(Ordering::Acquire) {
        return Err("The watch debug command was revoked.".to_string());
    }
    if Instant::now() >= deadline {
        return Err("The watch debug command timed out.".to_string());
    }
    Ok(())
}
