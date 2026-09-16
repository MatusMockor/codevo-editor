use super::*;
impl TransportShared {
    pub(super) fn dispatch_server_request(
        &self,
        id: Value,
        method: String,
        params: Value,
        bytes: usize,
    ) {
        let thread_id = frame_thread_id(&params);
        if method == "item/tool/requestUserInput" {
            let queue = thread_id.as_ref().and_then(|thread| {
                self.routes
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .routes
                    .get(thread)
                    .cloned()
            });
            if let Some(queue) = queue {
                queue.push(BufferedFrame {
                    frame: TurnFrame::UserInputRequested { id, params },
                    bytes,
                });
            } else {
                let _ = self.write_line(server_request_error(
                    &id,
                    -32600,
                    "Question has no active turn owner.",
                ));
            }
            return;
        }
        let Some(result) = self.handler.decline(method.as_str(), &params) else {
            self.unknown_frames.fetch_add(1, Ordering::Relaxed);
            let _ = self.write_line(server_request_error(
                &id,
                JSON_RPC_METHOD_NOT_FOUND,
                JSON_RPC_METHOD_NOT_FOUND_MESSAGE,
            ));
            self.route(thread_id, TurnFrame::UnknownFrame { method }, bytes);
            return;
        };
        let _ = self.write_line(server_request_result(&id, result));
        self.route(
            thread_id,
            TurnFrame::ServerRequestDeclined { method },
            bytes,
        );
    }
}

pub(super) fn server_request_result(id: &Value, result: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "result": result,
    }))
    .unwrap_or_default()
}

pub(super) fn server_request_error(id: &Value, code: i64, message: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "error": { "code": code, "message": message },
    }))
    .unwrap_or_default()
}
