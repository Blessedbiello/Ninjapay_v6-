use std::env;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub mpc_mode: MpcMode,
    pub arcium_cluster_address: String,
    pub arcium_program_id: String,
    pub encryption_master_key: Vec<u8>,
    pub callback_secret: String,
    pub solana_rpc_url: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MpcMode {
    Cluster,
}

impl std::fmt::Display for MpcMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MpcMode::Cluster => write!(f, "cluster"),
        }
    }
}

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Missing required environment variable: {0}")]
    MissingEnv(String),
    #[error("Invalid environment variable value: {0}")]
    InvalidValue(String),
    #[error("Invalid hex string: {0}")]
    InvalidHex(String),
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let host = env::var("SERVICE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("SERVICE_PORT")
            .unwrap_or_else(|_| "8002".to_string())
            .parse()
            .map_err(|_| ConfigError::InvalidValue("SERVICE_PORT must be a number".to_string()))?;

        // MPC mode is always cluster in v2
        let mpc_mode = MpcMode::Cluster;

        let arcium_cluster_address = env::var("ARCIUM_CLUSTER_ADDRESS")
            .unwrap_or_else(|_| "https://mpc.arcium.network".to_string());

        let arcium_program_id = env::var("ARCIUM_PROGRAM_ID")
            .map_err(|_| ConfigError::MissingEnv("ARCIUM_PROGRAM_ID".to_string()))?;

        let master_key_hex = env::var("ENCRYPTION_MASTER_KEY")
            .map_err(|_| ConfigError::MissingEnv("ENCRYPTION_MASTER_KEY".to_string()))?;

        if master_key_hex.len() != 64 {
            return Err(ConfigError::InvalidValue(
                "ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)".to_string(),
            ));
        }

        let encryption_master_key = hex::decode(&master_key_hex)
            .map_err(|_| ConfigError::InvalidHex("ENCRYPTION_MASTER_KEY".to_string()))?;

        let callback_secret = env::var("ARCIUM_CALLBACK_SECRET")
            .unwrap_or_else(|_| hex::encode(rand::random::<[u8; 32]>()));

        let solana_rpc_url = env::var("SOLANA_RPC_URL")
            .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());

        Ok(Config {
            host,
            port,
            mpc_mode,
            arcium_cluster_address,
            arcium_program_id,
            encryption_master_key,
            callback_secret,
            solana_rpc_url,
        })
    }
}
