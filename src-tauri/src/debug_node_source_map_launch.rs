use crate::debug_adapter::DebugLaunchTarget;
use crate::debug_source_map::{
    emitted_type_script_path, source_map_url_from_generated, SourceMapRegistry,
};
use crate::debug_support::file_url_from_path;
use std::path::Path;

pub(crate) fn source_map_registry(
    root: &Path,
    launch_target: &DebugLaunchTarget,
) -> Result<SourceMapRegistry, String> {
    let mut registry = SourceMapRegistry::new(root)?;
    let script_path = match launch_target {
        DebugLaunchTarget::NodeScript { script_path, .. }
        | DebugLaunchTarget::NodeConfiguredScript { script_path, .. } => script_path,
        _ => return Ok(registry),
    };
    let source = Path::new(script_path);
    if !matches!(
        source.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "mts" | "cts")
    ) {
        return Ok(registry);
    }
    let emitted = emitted_type_script_path(root, source)?;
    let map_url = source_map_url_from_generated(&emitted).ok_or_else(|| {
        "Compile the TypeScript project with sourceMap enabled before debugging.".to_string()
    })?;
    registry.register_script(&file_url_from_path(&emitted.to_string_lossy()), &map_url)?;
    Ok(registry)
}
