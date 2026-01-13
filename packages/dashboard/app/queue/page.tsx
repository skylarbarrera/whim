'use client';

import { useEffect, useState } from 'react';
import { DataTable, StatusCard } from '@/components';
import type { WorkItem, QueueStatsResponse } from '@factory/shared';

interface QueueResponse {
  items: WorkItem[];
  stats: QueueStatsResponse;
}

export default function QueuePage() {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        setQueue(await res.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue');
    }
  }

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleCancel(id: string) {
    if (!confirm('Are you sure you want to cancel this work item?')) return;

    setCancelling(id);
    try {
      const res = await fetch(`/api/work/${id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel');
      }
      await fetchQueue();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setCancelling(null);
    }
  }

  const statusColors: Record<string, string> = {
    queued: '#fef3c7',
    assigned: '#dbeafe',
    in_progress: '#dcfce7',
    completed: '#e0e7ff',
    failed: '#fee2e2',
    cancelled: '#f3f4f6',
  };

  const priorityColors: Record<string, string> = {
    critical: '#fee2e2',
    high: '#fef3c7',
    medium: '#dbeafe',
    low: '#f3f4f6',
  };

  if (error) {
    return (
      <div>
        <h1>Queue</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Work Queue</h1>

      {queue?.stats && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <StatusCard title="Total" value={queue.stats.total} />
          <StatusCard title="Queued" value={queue.stats.byStatus.queued ?? 0} status="warning" />
          <StatusCard title="In Progress" value={queue.stats.byStatus.in_progress ?? 0} status="success" />
          <StatusCard title="Completed" value={queue.stats.byStatus.completed ?? 0} status="neutral" />
          <StatusCard title="Failed" value={queue.stats.byStatus.failed ?? 0} status="error" />
        </div>
      )}

      <DataTable<WorkItem>
        columns={[
          { key: 'id', header: 'ID', render: (w: WorkItem) => w.id.slice(0, 8) },
          { key: 'repo', header: 'Repository' },
          { key: 'branch', header: 'Branch' },
          {
            key: 'priority',
            header: 'Priority',
            render: (w: WorkItem) => (
              <span
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  backgroundColor: priorityColors[w.priority] || '#f3f4f6',
                  fontSize: '0.875rem',
                }}
              >
                {w.priority}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (w: WorkItem) => (
              <span
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  backgroundColor: statusColors[w.status] || '#f3f4f6',
                  fontSize: '0.875rem',
                }}
              >
                {w.status}
              </span>
            ),
          },
          {
            key: 'iteration',
            header: 'Progress',
            render: (w: WorkItem) => `${w.iteration} / ${w.maxIterations}`,
          },
          {
            key: 'createdAt',
            header: 'Created',
            render: (w: WorkItem) => new Date(w.createdAt).toLocaleString(),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (w: WorkItem) =>
              ['queued', 'assigned'].includes(w.status) ? (
                <button
                  onClick={() => handleCancel(w.id)}
                  disabled={cancelling === w.id}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: '#6b7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: cancelling === w.id ? 'not-allowed' : 'pointer',
                    opacity: cancelling === w.id ? 0.5 : 1,
                  }}
                >
                  {cancelling === w.id ? 'Cancelling...' : 'Cancel'}
                </button>
              ) : null,
          },
        ]}
        data={queue?.items ?? []}
        emptyMessage="Queue is empty"
      />
    </div>
  );
}
