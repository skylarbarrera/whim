'use client';

import { useEffect, useState } from 'react';
import type { PRReview } from '@whim/shared';

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<PRReview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchReviews() {
    try {
      setLoading(true);
      const res = await fetch('/api/reviews');
      if (res.ok) {
        setReviews(await res.json());
      } else {
        setError('Failed to fetch reviews');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReviews();
    const interval = setInterval(fetchReviews, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  function getScoreColor(score: string): string {
    if (score === 'aligned' || score === 'good') return '#10b981';
    if (score === 'partial' || score === 'acceptable') return '#f59e0b';
    return '#ef4444';
  }

  function getScoreEmoji(score: string): string {
    if (score === 'aligned' || score === 'good') return '✅';
    if (score === 'partial' || score === 'acceptable') return '⚠️';
    return '❌';
  }

  if (error) {
    return (
      <div>
        <h1>AI PR Reviews</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1>AI PR Reviews</h1>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
          Loading reviews...
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>AI PR Reviews</h1>

      {reviews.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#6b7280',
            backgroundColor: '#f9fafb',
            borderRadius: '0.5rem',
          }}
        >
          No reviews found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {reviews.map((review) => (
            <div
              key={review.id}
              style={{
                padding: '1.5rem',
                border: '1px solid #e5e7eb',
                borderRadius: '0.5rem',
                backgroundColor: '#ffffff',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <a
                    href={`https://github.com/pull/${review.prNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#2563eb', textDecoration: 'none' }}
                  >
                    PR #{review.prNumber}
                  </a>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    Work Item: {review.workItemId}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.875rem', color: '#6b7280' }}>
                  <div>{new Date(review.reviewTimestamp).toLocaleString()}</div>
                  <div>Model: {review.modelUsed}</div>
                </div>
              </div>

              {/* Spec Alignment */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>Spec Alignment:</span>
                  <span style={{ color: getScoreColor(review.findings.specAlignment.score) }}>
                    {getScoreEmoji(review.findings.specAlignment.score)} {review.findings.specAlignment.score}
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem' }}>
                  {review.findings.specAlignment.summary}
                </div>

                {review.findings.specAlignment.gaps.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>Gaps:</strong>
                    <ul style={{ marginTop: '0.25rem', marginBottom: 0, paddingLeft: '1.5rem', fontSize: '0.875rem' }}>
                      {review.findings.specAlignment.gaps.map((gap, i) => (
                        <li key={i} style={{ color: '#ef4444' }}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {review.findings.specAlignment.extras.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>Unexpected additions:</strong>
                    <ul style={{ marginTop: '0.25rem', marginBottom: 0, paddingLeft: '1.5rem', fontSize: '0.875rem' }}>
                      {review.findings.specAlignment.extras.map((extra, i) => (
                        <li key={i} style={{ color: '#f59e0b' }}>{extra}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Code Quality */}
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>Code Quality:</span>
                  <span style={{ color: getScoreColor(review.findings.codeQuality.score) }}>
                    {getScoreEmoji(review.findings.codeQuality.score)} {review.findings.codeQuality.score}
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem' }}>
                  {review.findings.codeQuality.summary}
                </div>

                {review.findings.codeQuality.concerns.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>Concerns:</strong>
                    <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {review.findings.codeQuality.concerns.map((concern, i) => (
                        <div key={i} style={{ fontSize: '0.875rem', padding: '0.5rem', backgroundColor: '#fef3c7', borderRadius: '0.25rem' }}>
                          <div style={{ fontWeight: 'bold', color: '#92400e' }}>
                            {concern.file}{concern.line ? `:${concern.line}` : ''}
                          </div>
                          <div style={{ color: '#78350f', marginTop: '0.25rem' }}>
                            <strong>Issue:</strong> {concern.issue}
                          </div>
                          <div style={{ color: '#78350f', marginTop: '0.25rem' }}>
                            <strong>Suggestion:</strong> {concern.suggestion}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Overall Summary */}
              {review.findings.overallSummary && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '0.25rem' }}>
                  <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>Overall Summary:</strong>
                  <div style={{ fontSize: '0.875rem', color: '#374151', marginTop: '0.25rem' }}>
                    {review.findings.overallSummary}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
