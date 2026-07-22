mod app;
mod config;
mod cookie;
mod db;
mod error;
mod handlers;
mod photo_bursts;
mod sync;
mod webview;

fn main() -> wry::Result<()> {
    app::run()
}