use serde::Serialize;
use serde_json::Value;
use std::{fs, process::Command};

const MAX_ROUTES: usize = 2_000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtisanRoute {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub methods: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub middleware: Option<Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ArtisanRoutesResponse {
    Ok {
        routes: Vec<ArtisanRoute>,
        total: usize,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

pub async fn run_artisan_route_list(root_path: String) -> Result<ArtisanRoutesResponse, String> {
    crate::run_blocking_command(move || Ok(run_artisan_route_list_blocking(&root_path))).await
}

fn run_artisan_route_list_blocking(root_path: &str) -> ArtisanRoutesResponse {
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return ArtisanRoutesResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };

    if !root.join("artisan").is_file() {
        return ArtisanRoutesResponse::Unavailable {
            message: "Artisan is not available in this workspace.".to_string(),
        };
    }

    let output = match Command::new("php")
        .args(["artisan", "route:list", "--json", "--no-interaction"])
        .env("LC_ALL", "C")
        .current_dir(&root)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return ArtisanRoutesResponse::Error {
                message: format!("Failed to run Artisan route:list: {error}"),
            };
        }
    };

    if output.status.success() {
        return match parse_artisan_routes(&output.stdout) {
            Ok(response) => response,
            Err(_) => ArtisanRoutesResponse::Error {
                message: command_error_tail(&output.stderr, &output.stdout),
            },
        };
    }

    ArtisanRoutesResponse::Error {
        message: command_error_tail(&output.stderr, &output.stdout),
    }
}

fn parse_artisan_routes(stdout: &[u8]) -> Result<ArtisanRoutesResponse, String> {
    let mut parsed = None;

    for (offset, byte) in stdout.iter().enumerate() {
        if *byte != b'[' {
            continue;
        }

        let routes = match serde_json::from_slice::<Vec<Value>>(&stdout[offset..]) {
            Ok(routes) => routes,
            Err(_) => continue,
        };

        if !routes.iter().all(Value::is_object) {
            continue;
        }

        parsed = Some(routes);
        break;
    }

    let values = parsed.ok_or_else(|| "Artisan did not return a route array.".to_string())?;
    let total = values.len();
    let routes = values
        .into_iter()
        .take(MAX_ROUTES)
        .map(route_from_value)
        .collect();

    Ok(ArtisanRoutesResponse::Ok { routes, total })
}

fn route_from_value(value: Value) -> ArtisanRoute {
    let methods = value.get("method").or_else(|| value.get("methods"));

    ArtisanRoute {
        methods: methods.and_then(string_list).map(split_methods),
        uri: optional_string(value.get("uri")),
        name: optional_string(value.get("name")),
        action: optional_string(value.get("action")),
        middleware: value.get("middleware").and_then(string_list),
    }
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToString::to_string)
}

fn string_list(value: &Value) -> Option<Vec<String>> {
    if let Some(value) = value.as_str() {
        return Some(vec![value.to_string()]);
    }

    let values = value.as_array()?;
    Some(
        values
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect(),
    )
}

fn split_methods(methods: Vec<String>) -> Vec<String> {
    methods
        .into_iter()
        .flat_map(|method| {
            method
                .split('|')
                .map(str::trim)
                .filter(|method| !method.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn command_error_tail(stderr: &[u8], stdout: &[u8]) -> String {
    let mut source = stderr;

    if source.is_empty() {
        source = stdout;
    }
    let text = String::from_utf8_lossy(source);
    let tail: String = text.chars().rev().take(2_000).collect();
    let tail: String = tail.chars().rev().collect();

    if !tail.trim().is_empty() {
        return tail;
    }

    "Artisan route:list failed without an error message.".to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        parse_artisan_routes, run_artisan_route_list_blocking, ArtisanRoutesResponse, MAX_ROUTES,
    };
    use serde_json::json;
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn parses_junk_before_json_and_splits_multi_methods() {
        let output = concat!(
            "PHP Deprecated: warning [1]\n",
            r#"[{"method":"GET|HEAD","uri":"users","name":"users.index","action":"App\\Http\\Controllers\\UserController@index","middleware":["web","auth"]}]"#,
        );
        let response = parse_artisan_routes(output.as_bytes()).expect("parse routes");
        let (routes, total) = ok_parts(response);

        assert_eq!(total, 1);
        assert_eq!(
            routes[0].methods.as_deref(),
            Some(["GET".to_string(), "HEAD".to_string()].as_slice())
        );
        assert_eq!(routes[0].uri.as_deref(), Some("users"));
        assert_eq!(
            routes[0].middleware.as_deref(),
            Some(["web".to_string(), "auth".to_string()].as_slice())
        );
    }

    #[test]
    fn accepts_routes_with_missing_fields() {
        let response = parse_artisan_routes(br#"[{}]"#).expect("parse routes");
        let (routes, total) = ok_parts(response);

        assert_eq!(total, 1);
        assert_eq!(routes[0].methods, None);
        assert_eq!(routes[0].uri, None);
        assert_eq!(routes[0].name, None);
        assert_eq!(routes[0].action, None);
        assert_eq!(routes[0].middleware, None);
    }

    #[test]
    fn caps_routes_without_hiding_the_truthful_total() {
        let fixture = ValueFixture::routes(MAX_ROUTES + 7);
        let response = parse_artisan_routes(&fixture).expect("parse routes");
        let (routes, total) = ok_parts(response);

        assert_eq!(routes.len(), MAX_ROUTES);
        assert_eq!(total, MAX_ROUTES + 7);
    }

    #[test]
    fn missing_artisan_file_is_unavailable() {
        let root = temp_workspace("artisan-missing");
        let response = run_artisan_route_list_blocking(&root.to_string_lossy());

        assert_eq!(
            response,
            ArtisanRoutesResponse::Unavailable {
                message: "Artisan is not available in this workspace.".to_string(),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn ok_parts(response: ArtisanRoutesResponse) -> (Vec<super::ArtisanRoute>, usize) {
        match response {
            ArtisanRoutesResponse::Ok { routes, total } => (routes, total),
            response => panic!("expected ok response, got {response:?}"),
        }
    }

    struct ValueFixture;

    impl ValueFixture {
        fn routes(count: usize) -> Vec<u8> {
            serde_json::to_vec(&vec![json!({ "method": "GET" }); count]).expect("fixture")
        }
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("mockor-{label}-{unique}"));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }
}
