use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::ServiceError;
use crate::mpc::{self, MpcClient};

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    mpc_mode: String,
}

#[derive(Deserialize)]
pub struct EncryptRequest {
    amount: u64,
    user_pubkey: String,
}

#[derive(Serialize)]
struct EncryptResponse {
    success: bool,
    data: EncryptData,
}

#[derive(Serialize)]
struct EncryptData {
    ciphertext: String,
    nonce: String,
    commitment: String,
}

#[derive(Deserialize)]
pub struct DecryptRequest {
    ciphertext: String,
    nonce: String,
    user_pubkey: String,
}

#[derive(Serialize)]
struct DecryptResponse {
    success: bool,
    data: DecryptData,
}

#[derive(Serialize)]
struct DecryptData {
    amount: u64,
}

#[derive(Deserialize)]
pub struct PaymentSettlementRequest {
    payment_intent_id: String,
    merchant_wallet: String,
    amount: u64,
    recipient: String,
    currency: String,
    callback_url: String,
}

#[derive(Deserialize)]
pub struct PayrollSettlementRequest {
    batch_id: String,
    company_wallet: String,
    payments: Vec<PayrollPaymentInput>,
    currency: String,
    callback_url: String,
}

#[derive(Deserialize)]
pub struct PayrollPaymentInput {
    employee_id: String,
    employee_wallet: String,
    amount: u64,
}

#[derive(Serialize)]
struct ComputationQueuedResponse {
    success: bool,
    data: ComputationData,
}

#[derive(Serialize)]
struct ComputationData {
    computation_id: String,
    status: String,
}

#[derive(Deserialize)]
pub struct VerifyCommitmentRequest {
    amount: u64,
    nonce: String,
    commitment: String,
}

#[derive(Serialize)]
struct VerifyCommitmentResponse {
    success: bool,
    data: VerifyData,
}

#[derive(Serialize)]
struct VerifyData {
    valid: bool,
}

/// Health check endpoint
pub async fn health_check(config: web::Data<Config>) -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "healthy".to_string(),
        service: "arcium-service".to_string(),
        version: "2.0.0".to_string(),
        mpc_mode: config.mpc_mode.to_string(),
    })
}

/// Encrypt an amount
pub async fn encrypt_amount(
    mpc_client: web::Data<MpcClient>,
    body: web::Json<EncryptRequest>,
) -> Result<HttpResponse, ServiceError> {
    let result = mpc::encrypt_amount(body.amount, mpc_client.master_key(), &body.user_pubkey)?;

    Ok(HttpResponse::Ok().json(EncryptResponse {
        success: true,
        data: EncryptData {
            ciphertext: base64::encode(&result.ciphertext),
            nonce: hex::encode(&result.nonce),
            commitment: result.commitment,
        },
    }))
}

/// Decrypt an amount
pub async fn decrypt_amount(
    mpc_client: web::Data<MpcClient>,
    body: web::Json<DecryptRequest>,
) -> Result<HttpResponse, ServiceError> {
    let ciphertext = base64::decode(&body.ciphertext)
        .map_err(|_| ServiceError::InvalidInput("Invalid base64 ciphertext".to_string()))?;

    let nonce = hex::decode(&body.nonce)
        .map_err(|_| ServiceError::InvalidInput("Invalid hex nonce".to_string()))?;

    let amount = mpc::decrypt_amount(&ciphertext, &nonce, mpc_client.master_key(), &body.user_pubkey)?;

    Ok(HttpResponse::Ok().json(DecryptResponse {
        success: true,
        data: DecryptData { amount },
    }))
}

/// Queue a payment settlement
pub async fn queue_payment_settlement(
    mpc_client: web::Data<MpcClient>,
    body: web::Json<PaymentSettlementRequest>,
) -> Result<HttpResponse, ServiceError> {
    let params = crate::mpc::client::PaymentSettlementParams {
        payment_intent_id: body.payment_intent_id.clone(),
        merchant_wallet: body.merchant_wallet.clone(),
        amount: body.amount,
        recipient: body.recipient.clone(),
        currency: body.currency.clone(),
    };

    let result = mpc_client
        .queue_payment_settlement(params, &body.callback_url)
        .await?;

    Ok(HttpResponse::Ok().json(ComputationQueuedResponse {
        success: true,
        data: ComputationData {
            computation_id: result.computation_id,
            status: result.status,
        },
    }))
}

/// Queue a payroll settlement
pub async fn queue_payroll_settlement(
    mpc_client: web::Data<MpcClient>,
    body: web::Json<PayrollSettlementRequest>,
) -> Result<HttpResponse, ServiceError> {
    let payments = body
        .payments
        .iter()
        .map(|p| crate::mpc::client::PayrollPayment {
            employee_id: p.employee_id.clone(),
            employee_wallet: p.employee_wallet.clone(),
            amount: p.amount,
        })
        .collect();

    let params = crate::mpc::client::PayrollSettlementParams {
        batch_id: body.batch_id.clone(),
        company_wallet: body.company_wallet.clone(),
        payments,
        currency: body.currency.clone(),
    };

    let result = mpc_client
        .queue_payroll_settlement(params, &body.callback_url)
        .await?;

    Ok(HttpResponse::Ok().json(ComputationQueuedResponse {
        success: true,
        data: ComputationData {
            computation_id: result.computation_id,
            status: result.status,
        },
    }))
}

/// Get computation status
pub async fn get_computation_status(
    mpc_client: web::Data<MpcClient>,
    path: web::Path<String>,
) -> Result<HttpResponse, ServiceError> {
    let computation_id = path.into_inner();
    let result = mpc_client.get_computation_status(&computation_id).await?;

    Ok(HttpResponse::Ok().json(ComputationQueuedResponse {
        success: true,
        data: ComputationData {
            computation_id: result.computation_id,
            status: result.status,
        },
    }))
}

/// Verify a commitment
pub async fn verify_commitment(
    body: web::Json<VerifyCommitmentRequest>,
) -> Result<HttpResponse, ServiceError> {
    let nonce = hex::decode(&body.nonce)
        .map_err(|_| ServiceError::InvalidInput("Invalid hex nonce".to_string()))?;

    let valid = mpc::generate_commitment(body.amount, &nonce) == body.commitment;

    Ok(HttpResponse::Ok().json(VerifyCommitmentResponse {
        success: true,
        data: VerifyData { valid },
    }))
}
