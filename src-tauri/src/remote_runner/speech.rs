use super::{
    commands::blocking, project_management::call_lease, service::RemoteRunnerState, types::id,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const INVALID_REQUEST: &str = "Invalid speech transcription request";
const INVALID_RESPONSE: &str = "Invalid runner speech transcription";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeechTranscriptionRequest {
    server_id: String,
    language: Language,
    base64: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Language {
    Auto,
    Sk,
    En,
    Cs,
}
impl Language {
    fn path(self) -> &'static str {
        match self {
            Self::Auto => "/v1/speech/transcriptions?language=auto",
            Self::Sk => "/v1/speech/transcriptions?language=sk",
            Self::En => "/v1/speech/transcriptions?language=en",
            Self::Cs => "/v1/speech/transcriptions?language=cs",
        }
    }
}

pub(super) fn is_route(method: &str, path: &str) -> bool {
    method == "POST"
        && matches!(
            path,
            "/v1/speech/transcriptions?language=auto"
                | "/v1/speech/transcriptions?language=sk"
                | "/v1/speech/transcriptions?language=en"
                | "/v1/speech/transcriptions?language=cs"
        )
}

impl SpeechTranscriptionRequest {
    fn validate(&self) -> Result<(), String> {
        id(&self.server_id).map_err(|_| INVALID_REQUEST)?;
        if self.base64.len() > 1_280_000 {
            return Err(INVALID_REQUEST.into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&self.base64)
            .map_err(|_| INVALID_REQUEST)?;
        if !(640..=960_000).contains(&bytes.len()) || bytes.len() % 2 != 0 {
            return Err(INVALID_REQUEST.into());
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpeechTranscription {
    text: String,
}
fn validate_response(value: Value) -> Result<SpeechTranscription, String> {
    let response: SpeechTranscription =
        serde_json::from_value(value).map_err(|_| INVALID_RESPONSE)?;
    if response.text.chars().count() > 4000 {
        return Err(INVALID_RESPONSE.into());
    }
    Ok(response)
}
fn admit_descriptor(descriptor: Value, expected_runner: &str) -> Result<(), String> {
    if super::descriptor::validate(descriptor.clone())? != expected_runner {
        return Err("Server connection changed during request".into());
    }
    if descriptor
        .get("capabilities")
        .and_then(|caps| caps.get("speechTranscription"))
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err("The server runner does not support speech transcription. Update the runner on the server.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_runner_transcribe_speech(
    state: tauri::State<'_, RemoteRunnerState>,
    request: SpeechTranscriptionRequest,
) -> Result<SpeechTranscription, String> {
    request.validate()?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || {
        let descriptor = call_lease(lease.clone(), "GET", "/v1/runner", None)?;
        admit_descriptor(descriptor, lease.runner_id())?;
        let session = lease.session()?;
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        let result = session.request(
            lease.server(),
            "POST",
            request.language.path(),
            Some(json!({"base64": request.base64})),
            vec![("content-type".into(), "application/octet-stream".into())],
        );
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        validate_response(result?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(bytes: usize) -> SpeechTranscriptionRequest {
        SpeechTranscriptionRequest {
            server_id: "server".into(),
            language: Language::Sk,
            base64: base64::engine::general_purpose::STANDARD.encode(vec![0; bytes]),
        }
    }
    #[test]
    fn requests_are_closed_and_languages_have_exact_routes() {
        for (language, path) in [
            ("auto", Language::Auto.path()),
            ("sk", Language::Sk.path()),
            ("en", Language::En.path()),
            ("cs", Language::Cs.path()),
        ] {
            let parsed: SpeechTranscriptionRequest = serde_json::from_value(json!({
                "serverId":"server", "language":language, "base64":request(640).base64
            }))
            .unwrap();
            assert_eq!(
                parsed.language.path(),
                format!("/v1/speech/transcriptions?language={language}")
            );
            assert!(is_route("POST", path));
            assert!(!is_route("GET", path));
        }
        for value in [
            json!({"serverId":"server","language":"de","base64":""}),
            json!({"serverId":"server","language":"SK","base64":""}),
            json!({"serverId":"server","language":"AUTO","base64":""}),
            json!({"serverId":"server","language":"sk","base64":"","extra":true}),
            json!({"serverId":"server","language":"sk"}),
        ] {
            assert!(serde_json::from_value::<SpeechTranscriptionRequest>(value).is_err());
        }
        assert!(!is_route(
            "POST",
            "/v1/speech/transcriptions?language=sk&extra=true"
        ));
        for path in [
            "/v1/speech/transcriptions?language=AUTO",
            "/v1/speech/transcriptions?language=auto&language=sk",
            "/v1/speech/transcriptions?language=auto&extra=true",
        ] {
            assert!(!is_route("POST", path));
        }
    }
    #[test]
    fn validates_identifier_encoding_and_audio_bounds_before_connection() {
        for bytes in [640, 642, 960_000] {
            assert!(request(bytes).validate().is_ok());
        }
        for bytes in [0, 638, 639, 641, 959_999, 960_001, 960_002] {
            assert_eq!(request(bytes).validate().unwrap_err(), INVALID_REQUEST);
        }
        for encoded in [
            "!".into(),
            "AA-_".into(),
            "A".repeat(1_280_001),
            "AA==\n".into(),
        ] {
            let mut input = request(640);
            input.base64 = encoded;
            assert_eq!(input.validate().unwrap_err(), INVALID_REQUEST);
        }
        for server_id in ["", "../server", "server\n", "server space"] {
            let mut input = request(640);
            input.server_id = server_id.into();
            assert_eq!(input.validate().unwrap_err(), INVALID_REQUEST);
        }
    }
    #[test]
    fn responses_are_strict_and_bounded_by_characters() {
        assert_eq!(
            serde_json::to_value(validate_response(json!({"text":"dictation"})).unwrap()).unwrap(),
            json!({"text":"dictation"})
        );
        for text in ["".into(), "界".repeat(4000)] {
            assert_eq!(validate_response(json!({"text":text})).unwrap().text, text);
        }
        for value in [
            json!({}),
            json!({"text":null}),
            json!({"text":42}),
            json!({"text":"ok","extra":true}),
            json!({"text":"界".repeat(4001)}),
        ] {
            assert!(validate_response(value).is_err());
        }
    }
    #[test]
    fn capability_gate_requires_supported_exact_runner() {
        let base = json!({"protocolVersion":1,"runnerId":"expected","name":"Server","capabilities":{"taskExecution":true,"eventReplay":true,"speechTranscription":true}});
        assert!(admit_descriptor(base.clone(), "expected").is_ok());
        assert!(admit_descriptor(base.clone(), "foreign").is_err());
        let mut absent = base.clone();
        absent["capabilities"]
            .as_object_mut()
            .unwrap()
            .remove("speechTranscription");
        assert!(admit_descriptor(absent, "expected")
            .unwrap_err()
            .contains("does not support speech transcription"));
        for value in [Value::Bool(false), Value::Null, json!("true"), json!(1)] {
            let mut unsupported = base.clone();
            unsupported["capabilities"]["speechTranscription"] = value;
            assert!(admit_descriptor(unsupported, "expected").is_err());
        }
        let mut invalid = base;
        invalid["unknown"] = json!(true);
        assert!(admit_descriptor(invalid, "expected").is_err());
    }
}
