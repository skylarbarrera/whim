'use client';

import { useEffect, useState } from 'react';
import type { Learning } from '@whim/shared';

export default function LearningsPage() {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [specFilter, setSpecFilter] = useState('');

  async function fetchLearnings() {
    try {
      const params = new URLSearchParams();
      if (repoFilter) params.set('repo', repoFilter);
      if (specFilter) params.set('spec', specFilter);

      const url = `/api/learnings${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        setLearnings(await res.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch learnings');
    }
  }

  useEffect(() => {
    fetchLearnings();
  }, [repoFilter, specFilter]);

  if (error) {
    return (
      <div>
        <h1>Learnings</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Learnings</h1>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Filter by repo..."
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          style={{
            padding: '0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.25rem',
            fontSize: '0.875rem',
          }}
        />
        <input
          type="text"
          placeholder="Filter by spec..."
          value={specFilter}
          onChange={(e) => setSpecFilter(e.target.value)}
          style={{
            padding: '0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.25rem',
            fontSize: '0.875rem',
          }}
        />
        <button
          onClick={fetchLearnings}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.25rem',
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </div>

      {learnings.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#6b7280',
            backgroundColor: '#f9fafb',
            borderRadius: '0.5rem',
          }}
        >
          No learnings found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {learnings.map((learning) => (
            <div
              key={learning.id}
              style={{
                padding: '1rem',
                border: '1px solid #e5e7eb',
                borderRadius: '0.5rem',
                backgroundColor: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                <span>
                  <strong>Repo:</strong> {learning.repo}
                </span>
                <span>
                  <strong>Spec:</strong> {learning.spec.slice(0, 50)}...
                </span>
                <span>
                  <strong>Created:</strong> {new Date(learning.createdAt).toLocaleString()}
                </span>
              </div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  backgroundColor: '#f9fafb',
                  padding: '0.75rem',
                  borderRadius: '0.25rem',
                  overflow: 'auto',
                }}
              >
                {learning.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
