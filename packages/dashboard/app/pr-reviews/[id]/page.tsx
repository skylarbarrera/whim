'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StatusCard } from '@/components';
import type { PRReview, PRReviewCheck, CheckStatus } from '@factory/shared';

interface ReviewDetailResponse {
  review: PRReview;
  checks: PRReviewCheck[];
}

export default function PRReviewDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [review, setReview] = useState<PRReview | null>(null);
  const [checks, setChecks] = useState<PRReviewCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [showManualReview, setShowManualReview] = useState(false);

  const [overrideReason, setOverrideReason] = useState('');
  const [overrideUser, setOverrideUser] = useState('');
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewer, setReviewer] = useState('');

  useEffect(() => {
    async function fetchReview() {
      try {
        setLoading(true);
        const res = await fetch(`/api/pr-reviews/${id}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch review: ${res.statusText}`);
        }

        const data: ReviewDetailResponse = await res.json();
        setReview(data.review);
        setChecks(data.checks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch review');
      } finally {
        setLoading(false);
      }
    }

    fetchReview();
  }, [id]);

  const handleOverride = async () => {
    if (!overrideReason.trim() || !overrideUser.trim()) {
      alert('Please provide both user and reason for override');
      return;
    }

    try {
      const res = await fetch(`/api/pr-reviews/${id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: overrideReason, user: overrideUser }),
      });

      if (!res.ok) {
        throw new Error(`Failed to override: ${res.statusText}`);
      }

      const data = await res.json();
      setReview(data.review);
      setShowOverrideForm(false);
      setOverrideReason('');
      setOverrideUser('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to override review');
    }
  };

  const handleManualReview = async () => {
    if (!reviewComment.trim() || !reviewer.trim()) {
      alert('Please provide both reviewer name and comment');
      return;
    }

    try {
      const res = await fetch(`/api/pr-reviews/${id}/manual-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: reviewAction,
          comment: reviewComment,
          reviewer,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to submit review: ${res.statusText}`);
      }

      const data = await res.json();
      setReview(data.review);
      setChecks((prevChecks) => {
        const existingIndex = prevChecks.findIndex(c => c.checkName === 'manual-review');
        if (existingIndex >= 0) {
          const newChecks = [...prevChecks];
          newChecks[existingIndex] = data.check;
          return newChecks;
        }
        return [...prevChecks, data.check];
      });
      setShowManualReview(false);
      setReviewComment('');
      setReviewer('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to submit manual review');
    }
  };

  const getCheckStatusColor = (status: CheckStatus): 'success' | 'warning' | 'error' | 'neutral' => {
    switch (status) {
      case 'success':
        return 'success';
      case 'pending':
      case 'running':
        return 'warning';
      case 'failure':
      case 'error':
        return 'error';
      default:
        return 'neutral';
    }
  };

  const getCheckIcon = (status: CheckStatus): string => {
    switch (status) {
      case 'success':
        return '✓';
      case 'failure':
      case 'error':
        return '✗';
      case 'running':
        return '⟳';
      case 'skipped':
        return '○';
      default:
        return '○';
    }
  };

  if (loading) {
    return (
      <div>
        <h1>PR Review</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div>
        <h1>PR Review</h1>
        <div style={{ color: '#991b1b', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem' }}>
          Error: {error || 'Review not found'}
        </div>
      </div>
    );
  }

  const passedChecks = checks.filter(c => c.status === 'success').length;
  const failedChecks = checks.filter(c => c.status === 'failure' || c.status === 'error').length;
  const totalErrors = checks.reduce((sum, c) => sum + c.errorCount, 0);
  const totalWarnings = checks.reduce((sum, c) => sum + c.warningCount, 0);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/pr-reviews" style={{ color: '#2563eb', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to PR Reviews
        </a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>
            {review.repoOwner}/{review.repoName} #{review.prNumber}
          </h1>
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
                AI-Generated (Confidence: {(review.detectionConfidence * 100).toFixed(0)}%)
              </span>
            )}
            Started {new Date(review.startedAt).toLocaleString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!review.overrideUser && review.mergeBlocked && (
            <button
              onClick={() => setShowOverrideForm(true)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: '1px solid #dc2626',
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              Emergency Override
            </button>
          )}
          <button
            onClick={() => setShowManualReview(true)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: '1px solid #2563eb',
              backgroundColor: '#eff6ff',
              color: '#2563eb',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            Manual Review
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <StatusCard
          title="Status"
          value={review.status}
          status={review.status === 'completed' ? 'success' : review.status === 'failed' ? 'error' : 'warning'}
        />
        <StatusCard
          title="Passed Checks"
          value={`${passedChecks}/${checks.length}`}
          status={passedChecks === checks.length ? 'success' : 'neutral'}
        />
        <StatusCard
          title="Failed Checks"
          value={failedChecks}
          status={failedChecks > 0 ? 'error' : 'success'}
        />
        <StatusCard
          title="Errors"
          value={totalErrors}
          status={totalErrors > 0 ? 'error' : 'success'}
        />
        <StatusCard
          title="Warnings"
          value={totalWarnings}
          status={totalWarnings > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {review.mergeBlocked && (
        <div style={{
          padding: '1rem',
          borderRadius: '0.5rem',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          marginBottom: '2rem',
          fontWeight: '500',
        }}>
          🚫 Merge is blocked - review must pass before merging
        </div>
      )}

      {review.overrideUser && (
        <div style={{
          padding: '1rem',
          borderRadius: '0.5rem',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          marginBottom: '2rem',
        }}>
          <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>
            Override by {review.overrideUser} at {review.overrideAt && new Date(review.overrideAt).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.875rem' }}>
            Reason: {review.overrideReason}
          </div>
        </div>
      )}

      {showOverrideForm && (
        <div style={{
          padding: '1.5rem',
          borderRadius: '0.5rem',
          border: '2px solid #dc2626',
          backgroundColor: '#fef2f2',
          marginBottom: '2rem',
        }}>
          <h3 style={{ marginBottom: '1rem', color: '#dc2626' }}>Emergency Override</h3>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>
              Your Name
            </label>
            <input
              type="text"
              value={overrideUser}
              onChange={(e) => setOverrideUser(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.25rem',
                border: '1px solid #d1d5db',
              }}
              placeholder="Enter your name"
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>
              Override Reason
            </label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.25rem',
                border: '1px solid #d1d5db',
                fontFamily: 'inherit',
              }}
              placeholder="Explain why this override is necessary"
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleOverride}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: 'none',
                backgroundColor: '#dc2626',
                color: 'white',
                cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              Confirm Override
            </button>
            <button
              onClick={() => setShowOverrideForm(false)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showManualReview && (
        <div style={{
          padding: '1.5rem',
          borderRadius: '0.5rem',
          border: '2px solid #2563eb',
          backgroundColor: '#eff6ff',
          marginBottom: '2rem',
        }}>
          <h3 style={{ marginBottom: '1rem', color: '#2563eb' }}>Manual Review</h3>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              Decision
            </label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="radio"
                  name="action"
                  value="approve"
                  checked={reviewAction === 'approve'}
                  onChange={() => setReviewAction('approve')}
                />
                Approve
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="radio"
                  name="action"
                  value="reject"
                  checked={reviewAction === 'reject'}
                  onChange={() => setReviewAction('reject')}
                />
                Reject
              </label>
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>
              Reviewer Name
            </label>
            <input
              type="text"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.25rem',
                border: '1px solid #d1d5db',
              }}
              placeholder="Enter your name"
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500' }}>
              Comment
            </label>
            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.25rem',
                border: '1px solid #d1d5db',
                fontFamily: 'inherit',
              }}
              placeholder="Provide feedback on this PR"
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleManualReview}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: 'none',
                backgroundColor: '#2563eb',
                color: 'white',
                cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              Submit Review
            </button>
            <button
              onClick={() => setShowManualReview(false)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2 style={{ marginBottom: '1rem' }}>Checks</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {checks.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
            No checks have been run yet
          </div>
        ) : (
          checks.map((check) => (
            <div
              key={check.id}
              style={{
                padding: '1.5rem',
                borderRadius: '0.5rem',
                border: `2px solid ${
                  getCheckStatusColor(check.status) === 'success' ? '#dcfce7' :
                  getCheckStatusColor(check.status) === 'error' ? '#fee2e2' :
                  getCheckStatusColor(check.status) === 'warning' ? '#fef3c7' : '#f3f4f6'
                }`,
                backgroundColor: 'white',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{
                      fontSize: '1.25rem',
                      fontWeight: 'bold',
                      color: getCheckStatusColor(check.status) === 'success' ? '#16a34a' :
                        getCheckStatusColor(check.status) === 'error' ? '#dc2626' :
                        getCheckStatusColor(check.status) === 'warning' ? '#ca8a04' : '#6b7280',
                    }}>
                      {getCheckIcon(check.status)}
                    </span>
                    <span style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>
                      {check.checkName}
                    </span>
                    {check.required && (
                      <span style={{
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                      }}>
                        Required
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    {check.checkType} · {check.duration ? `${(check.duration / 1000).toFixed(1)}s` : 'In progress'}
                  </div>
                </div>
                <div style={{
                  padding: '0.25rem 0.75rem',
                  borderRadius: '0.25rem',
                  backgroundColor: getCheckStatusColor(check.status) === 'success' ? '#dcfce7' :
                    getCheckStatusColor(check.status) === 'error' ? '#fee2e2' :
                    getCheckStatusColor(check.status) === 'warning' ? '#fef3c7' : '#f3f4f6',
                  color: getCheckStatusColor(check.status) === 'success' ? '#166534' :
                    getCheckStatusColor(check.status) === 'error' ? '#991b1b' :
                    getCheckStatusColor(check.status) === 'warning' ? '#92400e' : '#374151',
                  fontWeight: '500',
                  fontSize: '0.875rem',
                }}>
                  {check.status}
                </div>
              </div>

              {check.summary && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                  {check.summary}
                </div>
              )}

              {(check.errorCount > 0 || check.warningCount > 0) && (
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                  {check.errorCount > 0 && (
                    <span style={{ color: '#dc2626', fontWeight: '500' }}>
                      {check.errorCount} error{check.errorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {check.warningCount > 0 && (
                    <span style={{ color: '#ca8a04', fontWeight: '500' }}>
                      {check.warningCount} warning{check.warningCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}

              {check.details && (
                <details style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: '500', marginBottom: '0.5rem' }}>
                    View Details
                  </summary>
                  <pre style={{
                    padding: '0.75rem',
                    borderRadius: '0.25rem',
                    backgroundColor: '#f9fafb',
                    overflowX: 'auto',
                    fontSize: '0.75rem',
                    margin: 0,
                  }}>
                    {check.details}
                  </pre>
                </details>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
