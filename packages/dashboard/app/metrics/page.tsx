'use client';

import { useEffect, useState } from 'react';
import { StatusCard } from '@/components';
import type { FactoryMetrics, WorkerMetrics } from '@factory/shared';

export default function MetricsPage() {
  const [summary, setSummary] = useState<FactoryMetrics | null>(null);
  const [recentMetrics, setRecentMetrics] = useState<WorkerMetrics[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, metricsRes] = await Promise.all([
          fetch('/api/metrics'),
          fetch('/api/metrics?all=true'),
        ]);

        if (summaryRes.ok) {
          setSummary(await summaryRes.json());
        }
        // Note: /api/metrics doesn't support all param, but we'll show summary only for now
        if (metricsRes.ok) {
          const data = await metricsRes.json();
          // If it's an array, it's the detailed metrics
          if (Array.isArray(data)) {
            setRecentMetrics(data.slice(0, 20));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div>
        <h1>Metrics</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Metrics</h1>

      {summary && (
        <>
          <h2 style={{ marginBottom: '1rem' }}>Factory Summary</h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
            <StatusCard title="Active Workers" value={summary.activeWorkers} status="success" />
            <StatusCard title="Queued Items" value={summary.queuedItems} status="warning" />
            <StatusCard title="Completed Today" value={summary.completedToday} status="success" />
            <StatusCard title="Failed Today" value={summary.failedToday} status={summary.failedToday > 0 ? 'error' : 'neutral'} />
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
            <StatusCard title="Iterations Today" value={`${summary.iterationsToday} / ${summary.dailyBudget}`} subtitle="budget used" />
            <StatusCard
              title="Success Rate"
              value={`${(summary.successRate * 100).toFixed(1)}%`}
              status={summary.successRate >= 0.8 ? 'success' : summary.successRate >= 0.5 ? 'warning' : 'error'}
            />
            <StatusCard
              title="Avg Completion Time"
              value={`${Math.round(summary.avgCompletionTime / 60)}m`}
              subtitle="minutes"
            />
          </div>
        </>
      )}

      {recentMetrics.length > 0 && (
        <>
          <h2 style={{ marginBottom: '1rem' }}>Recent Worker Metrics</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Worker ID</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Iteration</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Tokens In</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Tokens Out</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Duration</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Files</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Tests</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', backgroundColor: '#f9fafb' }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {recentMetrics.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>{m.workerId.slice(0, 8)}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{m.iteration}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{m.tokensIn.toLocaleString()}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{m.tokensOut.toLocaleString()}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{Math.round(m.duration / 1000)}s</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{m.filesModified}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {m.testsPassed}/{m.testsRun}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>{new Date(m.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
