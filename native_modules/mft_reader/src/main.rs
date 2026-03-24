use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;
use std::process::ExitCode;
use thiserror::Error;

#[derive(Debug, Parser)]
#[command(name = "mft_reader")]
#[command(about = "NTFS MFT scanner for Horus Engine")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Scan {
        #[arg(long, default_value = "C:\\")]
        root: String,

        #[arg(long, value_enum, default_value_t = OutputFormat::Json)]
        format: OutputFormat,
    },
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, ValueEnum)]
enum OutputFormat {
    Json,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanPayload {
    engine: &'static str,
    items: Vec<DiskItem>,
    extensions: Vec<ExtensionItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskItem {
    id: String,
    full_path: String,
    name: String,
    size_bytes: u64,
    percent: f64,
    is_dir: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionItem {
    ext: String,
    size_bytes: u64,
    percent: f64,
}

#[derive(Debug, Error)]
enum ScanError {
    #[error("MFT direct scanner is still being implemented")]
    NotImplemented,
    #[error("serialization error: {0}")]
    Serialization(String),
}

fn run_scan(_root: &str, _format: OutputFormat) -> Result<String, ScanError> {
    // Phase 1 integration stub:
    // Return an explicit error so Electron can fall back to WizTree/PowerShell.
    // This keeps the process contract stable while low-level NTFS code is added.
    Err(ScanError::NotImplemented)
}

fn print_error_json(message: &str) {
    let escaped = message.replace('"', "\\\"");
    println!("{{\"error\":\"{}\"}}", escaped);
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Scan { root, format } => run_scan(&root, format),
    };

    match result {
        Ok(stdout) => {
            println!("{}", stdout);
            ExitCode::SUCCESS
        }
        Err(err) => {
            print_error_json(&err.to_string());
            ExitCode::from(2)
        }
    }
}

#[allow(dead_code)]
fn _payload_example() -> Result<String, ScanError> {
    let payload = ScanPayload {
        engine: "mft",
        items: Vec::new(),
        extensions: Vec::new(),
    };

    serde_json::to_string(&payload).map_err(|e| ScanError::Serialization(e.to_string()))
}
