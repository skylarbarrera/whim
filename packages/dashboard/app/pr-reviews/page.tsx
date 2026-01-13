'use client';

import { useEffect, useState } from 'react';
import { StatusCard } from '@/components';
import type { PRReview, ReviewStatus } from '@factory/shared';

interface ListReviewsResponse {
  reviews: PRReview[];
  total: number;
  hasMore: boolean;
}

export default function PRReviewsPage() {
  const [reviews, setReviews] = useState<PRReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewStatus | 'all'>('all');

  useEffect(() => {
    async function fetchReviews() {
      try {
        setLoading(true);
        const url = filter === 'all'
          ? '/api/pr-reviews'
          : `/api/pr-reviews?status=${filter}`;

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch reviews: ${res.statusText}`);
        }

        const data: ListReviewsResponse = await res.json();
        setReviews(data.reviews);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
      } finally {
        setLoading(false);
      }
    }

    fetchReviews();
  }, [filter]);

  const getStatusColor = (status: ReviewStatus): 'success' | 'warning' | 'error' | 'neutral' => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'running':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'neutral';
    }
  };

  if (loading) {
    return (
      <div>
        <h1>PR Reviews</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1>PR Reviews</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>PR Reviews</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setFilter('all')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: filter === 'all' ? '2px solid #2563eb' : '1px solid #d1d5db',
              backgroundColor: filter === 'all' ? '#eff6ff' : 'white',
              color: filter === 'all' ? '#2563eb' : '#374151',
              cursor: 'pointer',
            }}
          >
            All
          </button>
          <button
            onClick={() => setFilter('pending')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: filter === 'pending' ? '2px solid #2563eb' : '1px solid #d1d5db',
              backgroundColor: filter === 'pending' ? '#eff6ff' : 'white',
              color: filter === 'pending' ? '#2563eb' : '#374151',
              cursor: 'pointer',
            }}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter('running')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: filter === 'running' ? '2px solid #2563eb' : '1px solid #d1d5db',
              backgroundColor: filter === 'running' ? '#eff6ff' : 'white',
              color: filter === 'running' ? '#2563eb' : '#374151',
              cursor: 'pointer',
            }}
          >
            Running
          </button>
          <button
            onClick={() => setFilter('completed')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: filter === 'completed' ? '2px solid #2563eb' : '1px solid #d1d5db',
              backgroundColor: filter === 'completed' ? '#eff6ff' : 'white',
              color: filter === 'completed' ? '#2563eb' : '#374151',
              cursor: 'pointer',
            }}
          >
            Completed
          </button>
          <button
            onClick={() => setFilter('failed')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: filter === 'failed' ? '2px solid #2563eb' : '1px solid #d1d5db',
              backgroundColor: filter === 'failed' ? '#eff6ff' : 'white',
              color: filter === 'failed' ? '#2563eb' : '#374151',
              cursor: 'pointer',
            }}
          >
            Failed
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <StatusCard title="Total Reviews" value={total} status="neutral" />
        <StatusCard
          title="AI-Generated"
          value={reviews.filter(r => r.isAIGenerated).length}
          status="neutral"
        />
        <StatusCard
          title="Merge Blocked"
          value={reviews.filter(r => r.mergeBlocked).length}
          status={reviews.filter(r => r.mergeBlocked).length > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {reviews.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
          No reviews found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {reviews.map((review) => (
            <a
              key={review.id}
              href={`/pr-reviews/${review.id}`}
              style={{
                display: 'block',
                padding: '1.5rem',
                borderRadius: '0.5rem',
                border: '1px solid #e5e7eb',
                backgroundColor: 'white',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '1.125rem', marginBottom: '0.25rem' }}>
                    {review.repoOwner}/{review.repoName} #{review.prNumber}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    {review.isAIGenerated && (
                      <span style={{
                        display: 'inline-block',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: '#dbeafe',
                        color: '#1e40af',
                        marginRight: '0.5rem',
                      }}>
                        AI-Generated
                      </span>
                    )}
                    Started {new Date(review.startedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{
                  padding: '0.25rem 0.75rem',
                  borderRadius: '0.25rem',
                  backgroundColor: getStatusColor(review.status) === 'success' ? '#dcfce7' :
                    getStatusColor(review.status) === 'warning' ? '#fef3c7' :
                    getStatusColor(review.status) === 'error' ? '#fee2e2' : '#f3f4f6',
                  color: getStatusColor(review.status) === 'success' ? '#166534' :
                    getStatusColor(review.status) === 'warning' ? '#92400e' :
                    getStatusColor(review.status) === 'error' ? '#991b1b' : '#374151',
                  fontWeight: '500',
                  fontSize: '0.875rem',
                }}>
                  {review.status}
                </div>
              </div>

              {review.mergeBlocked && (
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '0.25rem',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  fontSize: '0.875rem',
                  marginBottom: '0.75rem',
                }}>
                  Merge blocked - review must pass before merging
                </div>
              )}

              {review.overrideUser && (
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '0.25rem',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  fontSize: '0.875rem',
                }}>
                  Override by {review.overrideUser}: {review.overrideReason}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
