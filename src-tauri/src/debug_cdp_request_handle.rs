pub(super) struct CdpClientStartOptions {
    pub(super) disconnected: Option<mpsc::Sender<()>>,
    pub(super) function_breakpoints:
        Arc<crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState>,
    pub(super) mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    pub(super) request_timeout: Duration,
}

#[derive(Clone)]
pub(super) struct CdpRequestHandle {
    pub(super) disconnect_notifier: DisconnectNotifier,
    pub(super) next_request_id: Arc<AtomicU64>,
    pub(super) outgoing: mpsc::SyncSender<String>,
    pub(super) pending: PendingCdpRequests,
    pub(super) request_timeout: Duration,
    pub(super) shutdown_requested: Arc<AtomicBool>,
}

impl CdpRequestHandle {
    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, self.request_timeout)
    }

    pub(super) fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::sync_channel(1);
        {
            let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
            pending.insert(id, tx);
        }
        let payload = json!({"id": id, "method": method, "params": params}).to_string();
        match self.outgoing.try_send(payload) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                remove_pending_cdp_request(&self.pending, id);
                fail_closed_transport(
                    &self.pending,
                    &self.shutdown_requested,
                    &self.disconnect_notifier,
                );
                return Err(format!(
                    "Debugger transport queue overflowed while sending `{method}`; connection closed."
                ));
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                remove_pending_cdp_request(&self.pending, id);
                fail_closed_transport(
                    &self.pending,
                    &self.shutdown_requested,
                    &self.disconnect_notifier,
                );
                return Err(format!(
                    "Debugger connection is closed; unable to send `{method}`."
                ));
            }
        }
        match rx.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => {
                remove_pending_cdp_request(&self.pending, id);
                Err(format!("Debugger request `{method}` timed out."))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(format!("Debugger connection closed during `{method}`."))
            }
        }
    }
}

impl crate::debug_cdp_function_breakpoints::FunctionBreakpointCdp for CdpRequestHandle {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        CdpRequestHandle::request(self, method, params)
    }
}
