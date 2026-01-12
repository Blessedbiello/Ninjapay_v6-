use actix_web::web;

use crate::handlers;

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api")
            // Health check
            .route("/health", web::get().to(handlers::health_check))
            // Encryption endpoints
            .route("/v1/encrypt", web::post().to(handlers::encrypt_amount))
            .route("/v1/decrypt", web::post().to(handlers::decrypt_amount))
            // MPC computation endpoints
            .route("/v1/computations/payment", web::post().to(handlers::queue_payment_settlement))
            .route("/v1/computations/payroll", web::post().to(handlers::queue_payroll_settlement))
            .route("/v1/computations/{id}", web::get().to(handlers::get_computation_status))
            // Commitment verification
            .route("/v1/verify-commitment", web::post().to(handlers::verify_commitment)),
    );
}
