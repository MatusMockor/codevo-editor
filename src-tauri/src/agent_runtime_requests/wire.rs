use super::model::{
    CloseReason, JournalState, RequestBody, RequestError, RequestLifecycle, RequestParts,
    RequestProvider, RequestResolution, RequestStatus, RuntimeRequest, ThreadRequests,
    ThreadRequestsParts,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Copy, Debug, Default)]
enum CapabilityReason {
    #[default]
    Absent,
    Present(Option<CloseReason>),
}

impl CapabilityReason {
    fn is_absent(&self) -> bool {
        matches!(self, Self::Absent)
    }
}

impl<'de> Deserialize<'de> for CapabilityReason {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Option::<CloseReason>::deserialize(deserializer).map(Self::Present)
    }
}

impl Serialize for CapabilityReason {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Present(Some(reason)) => reason.serialize(serializer),
            Self::Absent | Self::Present(None) => serializer.serialize_none(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CapabilityKind {
    Live,
    NotResumable,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CapabilityWire {
    kind: CapabilityKind,
    #[serde(default, skip_serializing_if = "CapabilityReason::is_absent")]
    reason: CapabilityReason,
}

impl CapabilityWire {
    fn live(self) -> Result<(), RequestError> {
        if self.kind != CapabilityKind::Live || !self.reason.is_absent() {
            return Err(RequestError::Capability);
        }
        Ok(())
    }

    fn not_resumable(self) -> Result<CloseReason, RequestError> {
        match (self.kind, self.reason) {
            (CapabilityKind::NotResumable, CapabilityReason::Present(Some(reason))) => Ok(reason),
            _ => Err(RequestError::Capability),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestWire {
    id: String,
    turn_id: String,
    provider: RequestProvider,
    created_at_epoch_ms: u64,
    #[serde(deserialize_with = "required_nullable")]
    resolved_at_epoch_ms: Option<u64>,
    order: u64,
    version: u64,
    #[serde(deserialize_with = "required_nullable")]
    anchor_tool_id: Option<String>,
    body: RequestBody,
    status: RequestStatus,
    response_capability: CapabilityWire,
    #[serde(deserialize_with = "required_nullable")]
    resolution: Option<RequestResolution>,
}

fn lifecycle(
    status: RequestStatus,
    capability: CapabilityWire,
    resolved_at: Option<u64>,
    resolution: Option<RequestResolution>,
) -> Result<RequestLifecycle, RequestError> {
    if status == RequestStatus::Pending {
        capability.live()?;
        if resolved_at.is_some() || resolution.is_some() {
            return Err(RequestError::Lifecycle);
        }
        return Ok(RequestLifecycle::Pending);
    }
    let reason = capability.not_resumable()?;
    if status == RequestStatus::Submitting {
        if resolved_at.is_some() {
            return Err(RequestError::Lifecycle);
        }
        return Ok(RequestLifecycle::Submitting { reason, resolution });
    }
    let resolved_at_epoch_ms = resolved_at.ok_or(RequestError::Lifecycle)?;
    match (status, resolution) {
        (RequestStatus::Resolved, Some(resolution)) => Ok(RequestLifecycle::Resolved {
            reason,
            resolved_at_epoch_ms,
            resolution,
        }),
        (RequestStatus::Expired, resolution) => Ok(RequestLifecycle::Expired {
            reason,
            resolved_at_epoch_ms,
            resolution,
        }),
        (RequestStatus::Cancelled, None) => Ok(RequestLifecycle::Cancelled {
            reason,
            resolved_at_epoch_ms,
        }),
        (RequestStatus::TimedOut, None) => Ok(RequestLifecycle::TimedOut {
            reason,
            resolved_at_epoch_ms,
        }),
        _ => Err(RequestError::Lifecycle),
    }
}

impl TryFrom<RequestWire> for RuntimeRequest {
    type Error = RequestError;

    fn try_from(wire: RequestWire) -> Result<Self, Self::Error> {
        let lifecycle = lifecycle(
            wire.status,
            wire.response_capability,
            wire.resolved_at_epoch_ms,
            wire.resolution,
        )?;
        Self::new(RequestParts {
            id: wire.id,
            turn_id: wire.turn_id,
            provider: wire.provider,
            created_at_epoch_ms: wire.created_at_epoch_ms,
            order: wire.order,
            version: wire.version,
            anchor_tool_id: wire.anchor_tool_id,
            body: wire.body,
            lifecycle,
        })
    }
}

impl From<RuntimeRequest> for RequestWire {
    fn from(request: RuntimeRequest) -> Self {
        let parts = request.into_parts();
        let status = parts.lifecycle.status();
        let resolved_at_epoch_ms = parts.lifecycle.resolved_at_epoch_ms();
        let response_capability = match parts.lifecycle.reason() {
            None => CapabilityWire {
                kind: CapabilityKind::Live,
                reason: CapabilityReason::Absent,
            },
            Some(reason) => CapabilityWire {
                kind: CapabilityKind::NotResumable,
                reason: CapabilityReason::Present(Some(reason)),
            },
        };
        let resolution = match parts.lifecycle {
            RequestLifecycle::Submitting { resolution, .. }
            | RequestLifecycle::Expired { resolution, .. } => resolution,
            RequestLifecycle::Resolved { resolution, .. } => Some(resolution),
            RequestLifecycle::Pending
            | RequestLifecycle::Cancelled { .. }
            | RequestLifecycle::TimedOut { .. } => None,
        };
        Self {
            id: parts.id,
            turn_id: parts.turn_id,
            provider: parts.provider,
            created_at_epoch_ms: parts.created_at_epoch_ms,
            resolved_at_epoch_ms,
            order: parts.order,
            version: parts.version,
            anchor_tool_id: parts.anchor_tool_id,
            body: parts.body,
            status,
            response_capability,
            resolution,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadRequestsWire {
    #[serde(deserialize_with = "required_nullable")]
    workspace_id: Option<String>,
    thread_id: String,
    epoch: String,
    journal: JournalState,
    requests: Vec<RuntimeRequest>,
    truncated: bool,
    unreadable: u64,
    reset: bool,
}

impl TryFrom<ThreadRequestsWire> for ThreadRequests {
    type Error = RequestError;

    fn try_from(wire: ThreadRequestsWire) -> Result<Self, Self::Error> {
        Self::new(ThreadRequestsParts {
            workspace_id: wire.workspace_id,
            thread_id: wire.thread_id,
            epoch: wire.epoch,
            journal: wire.journal,
            requests: wire.requests,
            truncated: wire.truncated,
            unreadable: wire.unreadable,
            reset: wire.reset,
        })
    }
}

impl From<ThreadRequests> for ThreadRequestsWire {
    fn from(requests: ThreadRequests) -> Self {
        let parts = requests.into_parts();
        Self {
            workspace_id: parts.workspace_id,
            thread_id: parts.thread_id,
            epoch: parts.epoch,
            journal: parts.journal,
            requests: parts.requests,
            truncated: parts.truncated,
            unreadable: parts.unreadable,
            reset: parts.reset,
        }
    }
}
