use tauri::{AppHandle, Manager};
use url::Url;
use webkit2gtk::{
    glib::{prelude::*, translate::ToGlibPtr},
    PermissionRequest, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
    UserMediaPermissionRequestExt, WebView, WebViewExt,
};

use super::startup_window_reveal::MAIN_WINDOW_LABEL;

const PACKAGED_APP_URL: &str = "tauri://localhost";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RequestedCaptureDevices {
    audio: bool,
    video: bool,
    display: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DocumentOrigin {
    scheme: String,
    host: String,
    port: Option<u16>,
}

impl DocumentOrigin {
    fn parse(uri: &str) -> Option<Self> {
        let url = Url::parse(uri).ok()?;
        let host = url.host_str()?.to_owned();
        Some(Self {
            scheme: url.scheme().to_owned(),
            host,
            port: url.port_or_known_default(),
        })
    }
}

pub(crate) fn enable_main_webview_microphone(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Some(app_origin) = app_origin(app.config().build.dev_url.as_ref(), tauri::is_dev()) else {
        return;
    };
    let configured = window.with_webview(move |webview| {
        allow_microphone_capture(&webview.inner(), app_origin);
    });
    if let Err(error) = configured {
        eprintln!("Microphone capture stays disabled for the main webview: {error}");
    }
}

fn app_origin(dev_url: Option<&Url>, dev: bool) -> Option<DocumentOrigin> {
    match (dev, dev_url) {
        (true, Some(url)) => DocumentOrigin::parse(url.as_str()),
        _ => DocumentOrigin::parse(PACKAGED_APP_URL),
    }
}

fn allow_microphone_capture(webview: &WebView, app_origin: DocumentOrigin) {
    let Some(settings) = WebViewExt::settings(webview) else {
        return;
    };
    settings.set_enable_media_stream(true);
    webview.connect_permission_request(move |webview, request| {
        answer_permission_request(webview, request, &app_origin)
    });
}

fn answer_permission_request(
    webview: &WebView,
    request: &PermissionRequest,
    app_origin: &DocumentOrigin,
) -> bool {
    let Some(user_media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
        return false;
    };
    if !is_microphone_only(requested_devices(user_media)) {
        return false;
    }
    if !is_app_document(webview.uri().as_deref(), app_origin) {
        return false;
    }
    user_media.allow();
    true
}

fn requested_devices(request: &UserMediaPermissionRequest) -> RequestedCaptureDevices {
    let display = unsafe {
        webkit2gtk::ffi::webkit_user_media_permission_is_for_display_device(
            request.to_glib_none().0,
        )
    };
    RequestedCaptureDevices {
        audio: request.is_for_audio_device(),
        video: request.is_for_video_device(),
        display: display != 0,
    }
}

fn is_microphone_only(devices: RequestedCaptureDevices) -> bool {
    devices.audio && !devices.video && !devices.display
}

fn is_app_document(document_uri: Option<&str>, app_origin: &DocumentOrigin) -> bool {
    let Some(uri) = document_uri else {
        return false;
    };
    DocumentOrigin::parse(uri).is_some_and(|origin| origin == *app_origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packaged_origin() -> DocumentOrigin {
        app_origin(None, false).expect("packaged origin")
    }

    fn dev_origin() -> DocumentOrigin {
        let dev_url = Url::parse("http://localhost:1420").expect("dev url");
        app_origin(Some(&dev_url), true).expect("dev origin")
    }

    #[test]
    fn only_a_microphone_without_camera_or_screen_is_allowed() {
        for audio in [false, true] {
            for video in [false, true] {
                for display in [false, true] {
                    let devices = RequestedCaptureDevices {
                        audio,
                        video,
                        display,
                    };
                    assert_eq!(
                        is_microphone_only(devices),
                        audio && !video && !display,
                        "{devices:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_packaged_app_document_is_the_only_trusted_origin() {
        let origin = packaged_origin();
        for uri in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html?thread=1#composer",
        ] {
            assert!(is_app_document(Some(uri), &origin), "{uri}");
        }
        for uri in [
            "tauri://evil/",
            "tauri://localhost.evil/",
            "tauri://localhost:8080/",
            "https://localhost/",
            "http://localhost:1420/",
            "https://example.com/",
            "codevo-artifact-preview://localhost/aaaa",
            "http://codevo-artifact-preview.localhost/aaaa",
            "about:blank",
            "data:text/html,<p>x</p>",
            "blob:tauri://localhost/1",
            "",
            "not a uri",
        ] {
            assert!(!is_app_document(Some(uri), &origin), "{uri}");
        }
        assert!(!is_app_document(None, &origin));
    }

    #[test]
    fn the_dev_server_origin_replaces_the_packaged_origin_only_in_dev_builds() {
        let origin = dev_origin();
        assert!(is_app_document(Some("http://localhost:1420/"), &origin));
        assert!(is_app_document(
            Some("http://localhost:1420/src/main.tsx"),
            &origin
        ));
        for uri in [
            "http://localhost:1421/",
            "https://localhost:1420/",
            "http://localhost.evil:1420/",
            "http://127.0.0.1:1420/",
            "tauri://localhost/",
        ] {
            assert!(!is_app_document(Some(uri), &origin), "{uri}");
        }

        let dev_url = Url::parse("http://localhost:1420").expect("dev url");
        assert_eq!(app_origin(Some(&dev_url), false), Some(packaged_origin()));
        assert_eq!(app_origin(None, true), Some(packaged_origin()));
    }
}
