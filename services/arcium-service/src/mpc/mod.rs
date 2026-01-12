mod client;
mod encryption;

pub use client::MpcClient;
pub use encryption::{encrypt_amount, decrypt_amount, generate_commitment, EncryptionResult};
