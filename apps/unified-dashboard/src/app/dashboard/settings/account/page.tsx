'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useAuthStore } from '@/stores/auth';
import { shortenAddress } from '@/lib/utils';

export default function AccountSettingsPage() {
  const { publicKey, disconnect } = useWallet();
  const { entityId, entityType, clearAuth } = useAuthStore();

  const handleDisconnect = () => {
    disconnect();
    clearAuth();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Account Settings</h1>
        <p className="text-muted-foreground">Manage your account and connection</p>
      </div>

      {/* Wallet Info */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Wallet Connection</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Connected Wallet</label>
            <p className="font-mono text-sm mt-1">
              {publicKey ? publicKey.toBase58() : 'Not connected'}
            </p>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Account Type</label>
            <p className="capitalize mt-1">{entityType || 'Unknown'}</p>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Account ID</label>
            <p className="font-mono text-sm mt-1">{entityId || 'Unknown'}</p>
          </div>
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 border border-destructive text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
          >
            Disconnect Wallet
          </button>
        </div>
      </div>

      {/* Business Info */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Business Information</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Update your business details for receipts and compliance.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Business Name</label>
            <input
              type="text"
              placeholder="Your Business Name"
              className="w-full px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              placeholder="business@example.com"
              className="w-full px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            Save Changes
          </button>
        </div>
      </div>

      {/* Webhook Settings */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Webhook Settings</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Configure your default webhook endpoint for all events.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Default Webhook URL</label>
            <input
              type="url"
              placeholder="https://your-server.com/webhook"
              className="w-full px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            Save Webhook URL
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-destructive/50 bg-card p-6">
        <h2 className="text-lg font-semibold mb-4 text-destructive">Danger Zone</h2>
        <p className="text-sm text-muted-foreground mb-4">
          These actions are irreversible. Please be certain.
        </p>
        <div className="space-y-4">
          <button className="px-4 py-2 border border-destructive text-destructive rounded-lg hover:bg-destructive/10 transition-colors">
            Revoke All API Keys
          </button>
          <button className="px-4 py-2 border border-destructive text-destructive rounded-lg hover:bg-destructive/10 transition-colors ml-4">
            Delete All Webhooks
          </button>
        </div>
      </div>
    </div>
  );
}
