'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const WEBHOOK_EVENTS = [
  { value: 'payment_intent.created', label: 'Payment Created' },
  { value: 'payment_intent.confirmed', label: 'Payment Confirmed' },
  { value: 'payment_intent.failed', label: 'Payment Failed' },
  { value: 'payment_intent.cancelled', label: 'Payment Cancelled' },
  { value: 'payment_link.payment_completed', label: 'Payment Link Completed' },
];

export default function WebhooksPage() {
  const { token } = useAuthStore();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/webhooks`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch webhooks');
      return res.json();
    },
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { url: string; events: string[] }) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/webhooks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error('Failed to create webhook');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setShowCreateModal(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (webhookId: string) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/webhooks/${webhookId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to delete webhook');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-muted-foreground">Receive real-time notifications for payment events</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          Add Webhook
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-4 font-medium text-muted-foreground">URL</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Events</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : !data?.data?.length ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No webhooks configured. Add a webhook to receive notifications.
                </td>
              </tr>
            ) : (
              data.data.map((webhook: any) => (
                <tr key={webhook.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="p-4 font-mono text-sm max-w-xs truncate">
                    {webhook.url}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {webhook.events.slice(0, 2).map((event: string) => (
                        <span
                          key={event}
                          className="px-2 py-0.5 rounded text-xs bg-secondary"
                        >
                          {event.split('.')[1]}
                        </span>
                      ))}
                      {webhook.events.length > 2 && (
                        <span className="px-2 py-0.5 rounded text-xs bg-secondary">
                          +{webhook.events.length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span
                      className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        webhook.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {webhook.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {formatDate(webhook.created_at)}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this webhook?')) {
                          deleteMutation.mutate(webhook.id);
                        }
                      }}
                      className="text-sm text-destructive hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateWebhookModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateWebhookModal({
  onClose,
  onCreate,
  isLoading,
}: {
  onClose: () => void;
  onCreate: (data: { url: string; events: string[] }) => void;
  isLoading: boolean;
}) {
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({ url, events: selectedEvents });
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Add Webhook</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Endpoint URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Events</label>
            <div className="space-y-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label
                  key={event.value}
                  className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event.value)}
                    onChange={() => toggleEvent(event.value)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <div>
                    <p className="font-medium text-sm">{event.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {event.value}
                    </p>
                  </div>
                </label>
              ))}
            </div>
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
              disabled={isLoading || !url || selectedEvents.length === 0}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Add Webhook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
