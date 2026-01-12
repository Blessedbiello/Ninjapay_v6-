import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  entityId: string | null;
  entityType: 'merchant' | 'company' | null;
  walletAddress: string | null;
  setAuth: (data: {
    token: string;
    entityId: string;
    entityType: 'merchant' | 'company';
    walletAddress: string;
  }) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      entityId: null,
      entityType: null,
      walletAddress: null,
      setAuth: (data) =>
        set({
          token: data.token,
          entityId: data.entityId,
          entityType: data.entityType,
          walletAddress: data.walletAddress,
        }),
      clearAuth: () =>
        set({
          token: null,
          entityId: null,
          entityType: null,
          walletAddress: null,
        }),
    }),
    {
      name: 'ninjapay-auth',
    }
  )
);
