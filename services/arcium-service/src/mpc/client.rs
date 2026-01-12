use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info};

use crate::config::Config;
use crate::error::ServiceError;

pub struct MpcClient {
    http_client: Client,
    cluster_address: String,
    program_id: String,
    callback_secret: String,
    master_key: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct ComputationRequest {
    computation_id: String,
    computation_type: String,
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct ComputationResponse {
    pub computation_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct PaymentSettlementParams {
    pub payment_intent_id: String,
    pub merchant_wallet: String,
    pub amount: u64,
    pub recipient: String,
    pub currency: String,
}

#[derive(Debug, Serialize)]
pub struct PayrollPayment {
    pub employee_id: String,
    pub employee_wallet: String,
    pub amount: u64,
}

#[derive(Debug, Serialize)]
pub struct PayrollSettlementParams {
    pub batch_id: String,
    pub company_wallet: String,
    pub payments: Vec<PayrollPayment>,
    pub currency: String,
}

impl MpcClient {
    pub fn new(config: &Config) -> Result<Self, ServiceError> {
        let http_client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| ServiceError::ConfigError(format!("Failed to create HTTP client: {}", e)))?;

        info!("MPC client initialized for cluster: {}", config.arcium_cluster_address);

        Ok(Self {
            http_client,
            cluster_address: config.arcium_cluster_address.clone(),
            program_id: config.arcium_program_id.clone(),
            callback_secret: config.callback_secret.clone(),
            master_key: config.encryption_master_key.clone(),
        })
    }

    pub fn master_key(&self) -> &[u8] {
        &self.master_key
    }

    /// Queue a payment settlement computation
    pub async fn queue_payment_settlement(
        &self,
        params: PaymentSettlementParams,
        callback_url: &str,
    ) -> Result<ComputationResponse, ServiceError> {
        let computation_id = format!("pay_{}", hex::encode(rand::random::<[u8; 16]>()));

        let request = ComputationRequest {
            computation_id: computation_id.clone(),
            computation_type: "payment_settlement".to_string(),
            params: serde_json::to_value(&params).unwrap(),
        };

        debug!("Queuing payment settlement: {:?}", computation_id);

        self.send_computation_request(request, callback_url).await
    }

    /// Queue a payroll settlement computation
    pub async fn queue_payroll_settlement(
        &self,
        params: PayrollSettlementParams,
        callback_url: &str,
    ) -> Result<ComputationResponse, ServiceError> {
        let computation_id = format!("payroll_{}", hex::encode(rand::random::<[u8; 16]>()));

        let request = ComputationRequest {
            computation_id: computation_id.clone(),
            computation_type: "payroll_settlement".to_string(),
            params: serde_json::to_value(&params).unwrap(),
        };

        debug!("Queuing payroll settlement: {:?}", computation_id);

        self.send_computation_request(request, callback_url).await
    }

    /// Get computation status
    pub async fn get_computation_status(
        &self,
        computation_id: &str,
    ) -> Result<ComputationResponse, ServiceError> {
        let url = format!(
            "{}/api/v1/computations/{}",
            self.cluster_address, computation_id
        );

        let response = self
            .http_client
            .get(&url)
            .header("X-Program-ID", &self.program_id)
            .send()
            .await
            .map_err(|e| ServiceError::MpcError(format!("Failed to get status: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ServiceError::MpcError(format!(
                "Status check failed ({}): {}",
                status, body
            )));
        }

        response
            .json()
            .await
            .map_err(|e| ServiceError::MpcError(format!("Failed to parse response: {}", e)))
    }

    async fn send_computation_request(
        &self,
        request: ComputationRequest,
        callback_url: &str,
    ) -> Result<ComputationResponse, ServiceError> {
        let url = format!("{}/api/v1/computations", self.cluster_address);

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Program-ID", &self.program_id)
            .header("X-Callback-URL", callback_url)
            .header("X-Callback-Secret", &self.callback_secret)
            .json(&request)
            .send()
            .await
            .map_err(|e| ServiceError::MpcError(format!("Failed to send request: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("MPC request failed ({}): {}", status, body);
            return Err(ServiceError::MpcError(format!(
                "Computation request failed ({}): {}",
                status, body
            )));
        }

        let result: ComputationResponse = response
            .json()
            .await
            .map_err(|e| ServiceError::MpcError(format!("Failed to parse response: {}", e)))?;

        info!(
            "Computation queued: {} (status: {})",
            result.computation_id, result.status
        );

        Ok(result)
    }
}
