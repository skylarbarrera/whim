'use client';

import { useEffect, useState } from 'react';
import { StatusCard } from '@/components';
import type { WhimMetrics, StatusResponse } from '@whim/shared';

export default function HomePage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [metrics, setMetrics] = useState<WhimMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statusRes, metricsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/metrics'),
        ]);

        if (statusRes.ok) {
          setStatus(await statusRes.json());
        }
        if (metricsRes.ok) {
          setMetrics(await metricsRes.json());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div>
        <h1>Overview</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Whim Overview</h1>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <StatusCard
          title="Status"
          value={status?.status ?? 'Loading...'}
          status={status?.status === 'healthy' ? 'success' : status?.status === 'degraded' ? 'warning' : 'neutral'}
        />
        <StatusCard
          title="Active Workers"
          value={`${status?.workers.active ?? 0} / ${status?.workers.maxWorkers ?? 0}`}
          status={status?.workers.active === status?.workers.maxWorkers ? 'warning' : 'success'}
        />
        <StatusCard
          title="Queue Size"
          value={status?.queue.size ?? 0}
          status={(status?.queue.size ?? 0) > 10 ? 'warning' : 'neutral'}
        />
        <StatusCard
          title="Daily Budget"
          value={`${status?.rateLimits.iterationsToday ?? 0} / ${status?.rateLimits.dailyBudget ?? 0}`}
          subtitle="iterations used"
          status={(status?.rateLimits.iterationsToday ?? 0) >= (status?.rateLimits.dailyBudget ?? 1) ? 'error' : 'neutral'}
        />
      </div>

      {metrics && (
        <>
          <h2 style={{ marginBottom: '1rem' }}>Today&apos;s Metrics</h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <StatusCard
              title="Completed"
              value={metrics.completedToday}
              status="success"
            />
            <StatusCard
              title="Failed"
              value={metrics.failedToday}
              status={metrics.failedToday > 0 ? 'error' : 'neutral'}
            />
            <StatusCard
              title="Success Rate"
              value={`${(metrics.successRate * 100).toFixed(1)}%`}
              status={metrics.successRate >= 0.8 ? 'success' : metrics.successRate >= 0.5 ? 'warning' : 'error'}
            />
            <StatusCard
              title="Avg Completion"
              value={`${Math.round(metrics.avgCompletionTime / 60)}m`}
              subtitle="minutes"
              status="neutral"
            />
          </div>
        </>
      )}
    </div>
  );
}
