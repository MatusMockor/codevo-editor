pub(super) struct CdpClientStartOptions {
    pub(super) disconnected: Option<mpsc::Sender<()>>,
    pub(super) function_breakpoints:
        Arc<crate::debug_cdp_function_breakpoints::FunctionBreakpointSessionState>,
    pub(super) mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    pub(super) request_timeout: Duration,
}

pub(super) enum CdpRequestFailure {
    Rejected(String),
    Uncertain(String),
}

impl CdpRequestFailure {
    pub(super) fn into_message(self) -> String {
        match self {
            Self::Rejected(message) | Self::Uncertain(message) => message,
        }
    }
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
        self.request_with_timeout_classified(method, params, timeout)
            .map_err(CdpRequestFailure::into_message)
    }

    pub(super) fn request_with_timeout_classified(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CdpRequestFailure> {
        self.request_with_timeout_classified_and_reserved(method, params, timeout, |_| Ok(()))
    }

    pub(super) fn request_with_timeout_classified_and_reserved(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
        reserve: impl FnOnce(u64) -> Result<(), String>,
    ) -> Result<Value, CdpRequestFailure> {
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::sync_channel(1);
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|error| CdpRequestFailure::Uncertain(error.to_string()))?;
            pending.insert(id, tx);
        }
        if let Err(message) = reserve(id) {
            remove_pending_cdp_request(&self.pending, id);
            return Err(CdpRequestFailure::Rejected(message));
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
                return Err(CdpRequestFailure::Uncertain(format!(
                    "Debugger transport queue overflowed while sending `{method}`; connection closed."
                )));
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                remove_pending_cdp_request(&self.pending, id);
                fail_closed_transport(
                    &self.pending,
                    &self.shutdown_requested,
                    &self.disconnect_notifier,
                );
                return Err(CdpRequestFailure::Uncertain(format!(
                    "Debugger connection is closed; unable to send `{method}`."
                )));
            }
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(message)) => Err(CdpRequestFailure::Rejected(message)),
            Err(RecvTimeoutError::Timeout) => {
                remove_pending_cdp_request(&self.pending, id);
                Err(CdpRequestFailure::Uncertain(format!(
                    "Debugger request `{method}` timed out."
                )))
            }
            Err(RecvTimeoutError::Disconnected) => Err(CdpRequestFailure::Uncertain(format!(
                "Debugger connection closed during `{method}`."
            ))),
        }
    }
}

impl crate::debug_cdp_function_breakpoints::FunctionBreakpointCdp for CdpRequestHandle {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        CdpRequestHandle::request(self, method, params)
    }

    fn request_classified(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<Value, crate::debug_cdp_function_breakpoints::FunctionBreakpointRequestFailure>
    {
        self.request_with_timeout_classified(method, params, self.request_timeout)
            .map_err(|failure| match failure {
                CdpRequestFailure::Rejected(message) => {
                    crate::debug_cdp_function_breakpoints::FunctionBreakpointRequestFailure::Rejected(message)
                }
                CdpRequestFailure::Uncertain(message) => {
                    crate::debug_cdp_function_breakpoints::FunctionBreakpointRequestFailure::Uncertain(message)
                }
            })
    }
}
