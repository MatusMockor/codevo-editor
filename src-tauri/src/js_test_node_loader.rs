use base64::{engine::general_purpose::STANDARD, Engine as _};

#[derive(Clone, Copy)]
pub(super) enum RetainedNodeModuleKind {
    CommonJs,
    EsModule,
}

pub(super) fn retained_node_loader_registration(
    entry_path: &str,
    descriptor: std::os::fd::RawFd,
    module_kind: RetainedNodeModuleKind,
) -> String {
    let entry_path = serde_json::to_string(entry_path).expect("entry path is serializable");
    let format = match module_kind {
        RetainedNodeModuleKind::CommonJs => "commonjs",
        RetainedNodeModuleKind::EsModule => "module",
    };
    let loader = format!(
        "import fs from 'node:fs';\
         import {{pathToFileURL}} from 'node:url';\
         const targetPath={entry_path};\
         const targetUrl=pathToFileURL(targetPath).href;\
         export async function resolve(specifier,context,nextResolve){{\
           if(specifier===targetPath||specifier===targetUrl)\
             return {{url:targetUrl,shortCircuit:true}};\
           return nextResolve(specifier,context);\
         }}\
         export async function load(url,context,nextLoad){{\
           if(url===targetUrl)\
             return {{format:'{format}',source:fs.readFileSync({descriptor}),shortCircuit:true}};\
           return nextLoad(url,context);\
         }}"
    );
    let loader_url = format!(
        "data:text/javascript;base64,{}",
        STANDARD.encode(loader.as_bytes())
    );
    let registration = format!(
        "import {{register}} from 'node:module';\
         register({},import.meta.url);",
        serde_json::to_string(&loader_url).expect("loader URL is serializable")
    );
    format!(
        "data:text/javascript;base64,{}",
        STANDARD.encode(registration.as_bytes())
    )
}
