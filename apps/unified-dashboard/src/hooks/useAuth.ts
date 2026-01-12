'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/lib/api';
import bs58 from 'bs58';

export function useAuth() {
  const { publicKey, signMessage, connected, disconnect: walletDisconnect } = useWallet();
  const { token, entityId, entityType, setAuth, clearAuth } = useAuthStore();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Check if authenticated
  const isAuthenticated = !!token && !!entityId;

  // Authenticate with the API
  const authenticate = useCallback(async (type: 'merchant' | 'company' = 'merchant') => {
    if (!publicKey || !signMessage) {
      setAuthError('Wallet not connected');
      return false;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      // Request nonce
      const nonceResponse = await authApi.requestNonce(publicKey.toBase58(), type);
      const { message } = nonceResponse.data;

      // Sign the message
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = bs58.encode(signatureBytes);

      // Verify signature and get token
      const verifyResponse = await authApi.verify(publicKey.toBase58(), signature, type);
      const { token: newToken, entityId: newEntityId } = verifyResponse.data;

      // Store auth data
      setAuth({
        token: newToken,
        entityId: newEntityId,
        entityType: type,
        walletAddress: publicKey.toBase58(),
      });

      return true;
    } catch (error: any) {
      console.error('Authentication error:', error);
      setAuthError(error.message || 'Authentication failed');
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, [publicKey, signMessage, setAuth]);

  // Disconnect and clear auth
  const disconnect = useCallback(() => {
    clearAuth();
    walletDisconnect();
  }, [clearAuth, walletDisconnect]);

  // Auto-authenticate when wallet connects
  useEffect(() => {
    if (connected && publicKey && !isAuthenticated && !isAuthenticating) {
      // Check if we have stored auth for this wallet
      const storedWallet = useAuthStore.getState().walletAddress;
      if (storedWallet !== publicKey.toBase58()) {
        // Different wallet, clear and re-auth
        clearAuth();
      }
    }
  }, [connected, publicKey, isAuthenticated, isAuthenticating, clearAuth]);

  // Clear auth when wallet disconnects
  useEffect(() => {
    if (!connected && isAuthenticated) {
      clearAuth();
    }
  }, [connected, isAuthenticated, clearAuth]);

  return {
    isAuthenticated,
    isAuthenticating,
    authError,
    token,
    entityId,
    entityType,
    walletAddress: publicKey?.toBase58(),
    authenticate,
    disconnect,
  };
}
