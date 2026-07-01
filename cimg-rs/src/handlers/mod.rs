use tao::event::{Event, WindowEvent};
use tao::event_loop::ControlFlow;
use wry::WebView;

use crate::config::Config;
use crate::db::Database;
use crate::error::AppResult;
use crate::webview::intercept::InterceptedContext;

pub mod bucket_info;
pub mod detail_info;
pub mod file_list;

/// Custom event types sent from the IPC handler to the event loop.
#[derive(Debug)]
pub enum AppEvent {
    GetBucketInfoReceived(InterceptedContext),
    GetFileListReceived(InterceptedContext),
    GetDetailInfoReceived(InterceptedContext),
}

/// Context passed to every API handler's `handle()` call.
pub struct HandlerContext<'a> {
    pub db: &'a Database,
    pub intercepted: &'a InterceptedContext,
    pub webview: &'a WebView,
    pub config: &'a Config,
}

/// Shared behaviour for all API response handlers.
pub trait ApiHandler {
    fn handle(&self, ctx: &HandlerContext) -> AppResult<()>;
}

/// Route an `Event<AppEvent>` to the appropriate handler.
pub fn dispatch(
    event: Event<AppEvent>,
    control_flow: &mut ControlFlow,
    db: &Database,
    webview: &WebView,
    config: &Config,
) {
    match event {
        Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } => {
            *control_flow = ControlFlow::Exit;
        }
        Event::UserEvent(AppEvent::GetBucketInfoReceived(ctx)) => {
            let hctx = HandlerContext { db, intercepted: &ctx, webview, config };
            if let Err(e) = bucket_info::BucketInfoHandler.handle(&hctx) {
                eprintln!("[bucket_info] {e}");
            }
        }
        Event::UserEvent(AppEvent::GetFileListReceived(ctx)) => {
            let hctx = HandlerContext { db, intercepted: &ctx, webview, config };
            if let Err(e) = file_list::FileListHandler.handle(&hctx) {
                eprintln!("[file_list] {e}");
            }
        }
        Event::UserEvent(AppEvent::GetDetailInfoReceived(ctx)) => {
            let hctx = HandlerContext { db, intercepted: &ctx, webview, config };
            if let Err(e) = detail_info::DetailInfoHandler.handle(&hctx) {
                eprintln!("[detail_info] {e}");
            }
        }
        _ => {}
    }
}
