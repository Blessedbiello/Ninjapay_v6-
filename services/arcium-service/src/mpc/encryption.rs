use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use hkdf::Hkdf;
use rand::Rng;
use sha2::{Digest, Sha256};

use crate::error::ServiceError;

const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;
const TAG_SIZE: usize = 16;

#[derive(Debug, Clone)]
pub struct EncryptionResult {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub commitment: String,
}

/// Derive a user-specific encryption key using HKDF
pub fn derive_user_key(master_key: &[u8], user_pubkey: &str) -> Result<Vec<u8>, ServiceError> {
    let salt = Sha256::digest(b"ninjapay-v2");
    let info = format!("user:{}", user_pubkey);

    let hkdf = Hkdf::<Sha256>::new(Some(&salt), master_key);
    let mut okm = vec![0u8; KEY_SIZE];
    hkdf.expand(info.as_bytes(), &mut okm)
        .map_err(|e| ServiceError::EncryptionError(format!("HKDF expansion failed: {}", e)))?;

    Ok(okm)
}

/// Encrypt an amount using ChaCha20-Poly1305
pub fn encrypt_amount(
    amount: u64,
    master_key: &[u8],
    user_pubkey: &str,
) -> Result<EncryptionResult, ServiceError> {
    // Derive user-specific key
    let user_key = derive_user_key(master_key, user_pubkey)?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill(&mut nonce_bytes);

    // Create cipher
    let cipher = ChaCha20Poly1305::new_from_slice(&user_key)
        .map_err(|e| ServiceError::EncryptionError(format!("Failed to create cipher: {}", e)))?;

    // Convert amount to bytes (little-endian)
    let amount_bytes = amount.to_le_bytes();

    // Encrypt
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, amount_bytes.as_ref())
        .map_err(|e| ServiceError::EncryptionError(format!("Encryption failed: {}", e)))?;

    // Generate commitment
    let commitment = generate_commitment(amount, &nonce_bytes);

    Ok(EncryptionResult {
        ciphertext,
        nonce: nonce_bytes.to_vec(),
        commitment,
    })
}

/// Decrypt an amount using ChaCha20-Poly1305
pub fn decrypt_amount(
    ciphertext: &[u8],
    nonce: &[u8],
    master_key: &[u8],
    user_pubkey: &str,
) -> Result<u64, ServiceError> {
    if nonce.len() != NONCE_SIZE {
        return Err(ServiceError::DecryptionError(format!(
            "Invalid nonce size: expected {}, got {}",
            NONCE_SIZE,
            nonce.len()
        )));
    }

    // Derive user-specific key
    let user_key = derive_user_key(master_key, user_pubkey)?;

    // Create cipher
    let cipher = ChaCha20Poly1305::new_from_slice(&user_key)
        .map_err(|e| ServiceError::DecryptionError(format!("Failed to create cipher: {}", e)))?;

    // Decrypt
    let nonce = Nonce::from_slice(nonce);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| ServiceError::DecryptionError(format!("Decryption failed: {}", e)))?;

    // Convert bytes to amount
    if plaintext.len() != 8 {
        return Err(ServiceError::DecryptionError(
            "Invalid plaintext length".to_string(),
        ));
    }

    let mut amount_bytes = [0u8; 8];
    amount_bytes.copy_from_slice(&plaintext);
    Ok(u64::from_le_bytes(amount_bytes))
}

/// Generate a Pedersen-style commitment: H(amount || blinding_factor)
pub fn generate_commitment(amount: u64, blinding_factor: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(amount.to_le_bytes());
    hasher.update(blinding_factor);
    hex::encode(hasher.finalize())
}

/// Verify a commitment matches the expected amount
pub fn verify_commitment(amount: u64, blinding_factor: &[u8], commitment: &str) -> bool {
    let expected = generate_commitment(amount, blinding_factor);
    expected == commitment
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let master_key = hex::decode("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
            .unwrap();
        let user_pubkey = "7xKXtg2CW8ukAp9rXKD2RQU3w5RJKPME6nXbvNfTQAaP";
        let amount = 1_000_000u64; // 1 USDC (6 decimals)

        let result = encrypt_amount(amount, &master_key, user_pubkey).unwrap();

        let decrypted = decrypt_amount(
            &result.ciphertext,
            &result.nonce,
            &master_key,
            user_pubkey,
        )
        .unwrap();

        assert_eq!(amount, decrypted);
    }

    #[test]
    fn test_commitment_verification() {
        let amount = 1_000_000u64;
        let blinding_factor = [0u8; 12];

        let commitment = generate_commitment(amount, &blinding_factor);
        assert!(verify_commitment(amount, &blinding_factor, &commitment));
        assert!(!verify_commitment(amount + 1, &blinding_factor, &commitment));
    }
}
