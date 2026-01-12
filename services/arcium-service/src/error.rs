use actix_web::{HttpResponse, ResponseError};
use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum ServiceError {
    EncryptionError(String),
    DecryptionError(String),
    MpcError(String),
    InvalidInput(String),
    InternalError(String),
    ConfigError(String),
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServiceError::EncryptionError(msg) => write!(f, "Encryption error: {}", msg),
            ServiceError::DecryptionError(msg) => write!(f, "Decryption error: {}", msg),
            ServiceError::MpcError(msg) => write!(f, "MPC error: {}", msg),
            ServiceError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            ServiceError::InternalError(msg) => write!(f, "Internal error: {}", msg),
            ServiceError::ConfigError(msg) => write!(f, "Config error: {}", msg),
        }
    }
}

impl std::error::Error for ServiceError {}

#[derive(Serialize)]
struct ErrorResponse {
    success: bool,
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: String,
    message: String,
}

impl ResponseError for ServiceError {
    fn error_response(&self) -> HttpResponse {
        let (status, code, message) = match self {
            ServiceError::EncryptionError(msg) => {
                (actix_web::http::StatusCode::INTERNAL_SERVER_ERROR, "ENCRYPTION_ERROR", msg.clone())
            }
            ServiceError::DecryptionError(msg) => {
                (actix_web::http::StatusCode::BAD_REQUEST, "DECRYPTION_ERROR", msg.clone())
            }
            ServiceError::MpcError(msg) => {
                (actix_web::http::StatusCode::SERVICE_UNAVAILABLE, "MPC_ERROR", msg.clone())
            }
            ServiceError::InvalidInput(msg) => {
                (actix_web::http::StatusCode::BAD_REQUEST, "INVALID_INPUT", msg.clone())
            }
            ServiceError::InternalError(msg) => {
                (actix_web::http::StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", msg.clone())
            }
            ServiceError::ConfigError(msg) => {
                (actix_web::http::StatusCode::INTERNAL_SERVER_ERROR, "CONFIG_ERROR", msg.clone())
            }
        };

        HttpResponse::build(status).json(ErrorResponse {
            success: false,
            error: ErrorDetail {
                code: code.to_string(),
                message,
            },
        })
    }
}
