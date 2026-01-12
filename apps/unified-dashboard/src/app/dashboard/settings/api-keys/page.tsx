'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export default function ApiKeysPage() {
  const { token } = useAuthStore();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/api_keys`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch API keys');
      return res.json();
    },
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/api_keys`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error('Failed to create API key');
      return res.json();
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setNewKey(response.data.key);
      setShowCreateModal(false);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/api_keys/${keyId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to revoke API key');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-muted-foreground">Manage your API keys for integrations</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          Create Key
        </button>
      </div>

      {/* New Key Alert */}
      {newKey && (
        <div className="p-4 rounded-xl border border-yellow-500 bg-yellow-50 dark:bg-yellow-500/10">
          <div className="flex items-start gap-4">
            <svg className="w-6 h-6 text-yellow-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">
                Save your API key now
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-2">
                This key will only be shown once. Store it securely.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-white dark:bg-black/20 rounded font-mono text-sm break-all">
                  {newKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newKey);
                  }}
                  className="px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors text-sm"
                >
                  Copy
                </button>
              </div>
              <button
                onClick={() => setNewKey(null)}
                className="mt-2 text-sm text-yellow-600 dark:text-yellow-400 hover:underline"
              >
                I&apos;ve saved it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-4 font-medium text-muted-foreground">Name</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Key</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Last Used</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : !data?.data?.length ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No API keys found. Create your first key to get started.
                </td>
              </tr>
            ) : (
              data.data.map((key: any) => (
                <tr key={key.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="p-4 font-medium">{key.name}</td>
                  <td className="p-4 font-mono text-sm">
                    {key.key_prefix}...
                  </td>
                  <td className="p-4">
                    <span
                      className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        key.active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {key.active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {key.last_used_at ? formatDate(key.last_used_at) : 'Never'}
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {formatDate(key.created_at)}
                  </td>
                  <td className="p-4">
                    {key.active && (
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to revoke this key?')) {
                            revokeMutation.mutate(key.id);
                          }
                        }}
                        className="text-sm text-destructive hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateKeyModal({
  onClose,
  onCreate,
  isLoading,
}: {
  onClose: () => void;
  onCreate: (data: { name: string }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({ name });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create API Key</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Key Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Production Backend"
              className="w-full px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
            <p className="text-sm text-muted-foreground mt-1">
              Give your key a descriptive name to identify it later
            </p>
          </div>
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Create Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
