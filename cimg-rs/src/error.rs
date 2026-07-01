use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("parse error: {0}")]
    ParseError(String),
    #[error("database error: {0}")]
    DbError(#[from] rusqlite::Error),
    #[error("webview error: {0}")]
    WryError(String),
}

pub type AppResult<T> = Result<T, AppError>;
