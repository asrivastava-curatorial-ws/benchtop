// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The same executable runs the AI models in a separate process (see ai/worker.rs).
    if std::env::args().nth(1).as_deref() == Some("--ai-worker") {
        benchtop_lib::ai_worker_main();
        return;
    }
    // `benchtop convert …`, `benchtop transcribe …` and the other commands (see cli.rs).
    let args: Vec<String> = std::env::args().collect();
    if benchtop_lib::wants_cli(&args) {
        std::process::exit(benchtop_lib::cli_main(args));
    }
    benchtop_lib::run()
}
