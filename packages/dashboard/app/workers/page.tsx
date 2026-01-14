'use client';

import { useEffect, useState } from 'react';
import { DataTable } from '@/components';
import type { Worker } from '@whim/shared';

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<string | null>(null);

  async function fetchWorkers() {
    try {
      const res = await fetch('/api/workers');
      if (res.ok) {
        setWorkers(await res.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch workers');
    }
  }

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleKill(workerId: string) {
    if (!confirm('Are you sure you want to kill this worker?')) return;

    setKilling(workerId);
    try {
      const res = await fetch(`/api/workers/${workerId}/kill`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to kill worker');
      }
      await fetchWorkers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to kill worker');
    } finally {
      setKilling(null);
    }
  }

  const statusColors: Record<string, string> = {
    starting: '#fef3c7',
    running: '#dcfce7',
    completed: '#e0e7ff',
    failed: '#fee2e2',
    stuck: '#fef3c7',
    killed: '#f3f4f6',
  };

  if (error) {
    return (
      <div>
        <h1>Workers</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Workers</h1>

      <DataTable<Worker>
        columns={[
          { key: 'id', header: 'ID', render: (w: Worker) => w.id.slice(0, 8) },
          { key: 'workItemId', header: 'Work Item', render: (w: Worker) => w.workItemId.slice(0, 8) },
          {
            key: 'status',
            header: 'Status',
            render: (w: Worker) => (
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
          { key: 'iteration', header: 'Iteration' },
          {
            key: 'startedAt',
            header: 'Started',
            render: (w: Worker) => new Date(w.startedAt).toLocaleString(),
          },
          {
            key: 'lastHeartbeat',
            header: 'Last Heartbeat',
            render: (w: Worker) => new Date(w.lastHeartbeat).toLocaleString(),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (w: Worker) =>
              ['starting', 'running', 'stuck'].includes(w.status) ? (
                <button
                  onClick={() => handleKill(w.id)}
                  disabled={killing === w.id}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: killing === w.id ? 'not-allowed' : 'pointer',
                    opacity: killing === w.id ? 0.5 : 1,
                  }}
                >
                  {killing === w.id ? 'Killing...' : 'Kill'}
                </button>
              ) : null,
          },
        ]}
        data={workers}
        emptyMessage="No workers found"
      />
    </div>
  );
}
