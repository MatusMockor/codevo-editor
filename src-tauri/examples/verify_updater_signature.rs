use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<String> = env::args().collect();
    if arguments.len() != 4 {
        return Err("usage: verify_updater_signature <archive> <signature> <tauri-config>".into());
    }

    let archive = fs::read(Path::new(&arguments[1]))?;
    let signature = decode_base64_text(&fs::read_to_string(Path::new(&arguments[2]))?)?;
    let config: Value = serde_json::from_str(&fs::read_to_string(Path::new(&arguments[3]))?)?;
    let encoded_public_key = config
        .pointer("/plugins/updater/pubkey")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or("tauri updater public key is missing")?;
    let public_key = PublicKey::decode(&decode_base64_text(encoded_public_key)?)?;
    let signature = Signature::decode(&signature)?;

    public_key.verify(&archive, &signature, true)?;
    Ok(())
}

fn decode_base64_text(value: &str) -> Result<String, Box<dyn std::error::Error>> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(value.trim())?;
    Ok(String::from_utf8(bytes)?)
}
