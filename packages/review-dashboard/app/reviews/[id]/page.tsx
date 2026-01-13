'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient, type ReviewRecord } from '../../../lib/api';
import { ReviewTimeline } from '../../../components/ReviewTimeline';
import { ReviewMessages } from '../../../components/ReviewMessages';
import { FileAnnotations } from '../../../components/FileAnnotations';

export default function ReviewDetailsPage() {
  const params = useParams();
  const reviewId = params.id as string;

  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'timeline' | 'messages' | 'files'>('timeline');

  useEffect(() => {
    loadReview();
  }, [reviewId]);

  const loadReview = async () => {
    try {
      const data = await apiClient.fetchReviewById(reviewId);
      if (!data) {
        setError('Review not found');
      } else {
        setReview(data);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading review...</div>;
  }

  if (error || !review) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error: {error || 'Review not found'}
      </div>
    );
  }

  const allMessages = review.result.results.flatMap((r) => r.messages);
  const duration = review.completedAt
    ? Math.round(
        (new Date(review.completedAt).getTime() -
          new Date(review.triggeredAt).getTime()) /
          1000
      )
    : null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PASS':
        return 'text-green-700 bg-green-100';
      case 'FAIL':
        return 'text-red-700 bg-red-100';
      case 'ERROR':
        return 'text-orange-700 bg-orange-100';
      case 'PENDING':
        return 'text-blue-700 bg-blue-100';
      default:
        return 'text-gray-700 bg-gray-100';
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-block"
        >
          ← Back to Reviews
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Review #{review.id.substring(0, 8)}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {review.pullRequest.owner}/{review.pullRequest.repo}#
              {review.pullRequest.number} - {review.pullRequest.title}
            </p>
          </div>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
              review.result.status
            )}`}
          >
            {review.result.status}
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 border border-gray-200 rounded-lg">
          <div className="text-sm font-medium text-gray-500">Workflow</div>
          <div className="text-lg font-semibold text-gray-900 mt-1">
            {review.workflow}
          </div>
        </div>
        <div className="bg-white p-4 border border-gray-200 rounded-lg">
          <div className="text-sm font-medium text-gray-500">Steps</div>
          <div className="text-lg font-semibold text-gray-900 mt-1">
            {review.result.results.length}
          </div>
        </div>
        <div className="bg-white p-4 border border-gray-200 rounded-lg">
          <div className="text-sm font-medium text-gray-500">Issues</div>
          <div className="text-lg font-semibold text-gray-900 mt-1">
            {review.result.totalErrors} errors, {review.result.totalWarnings}{' '}
            warnings
          </div>
        </div>
        <div className="bg-white p-4 border border-gray-200 rounded-lg">
          <div className="text-sm font-medium text-gray-500">Duration</div>
          <div className="text-lg font-semibold text-gray-900 mt-1">
            {duration !== null ? `${duration}s` : 'In progress...'}
          </div>
        </div>
      </div>

      {/* View tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setView('timeline')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              view === 'timeline'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setView('messages')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              view === 'messages'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Messages ({allMessages.length})
          </button>
          <button
            onClick={() => setView('files')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              view === 'files'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Files
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="bg-white p-6 border border-gray-200 rounded-lg">
        {view === 'timeline' && (
          <ReviewTimeline
            results={review.result.results}
            mode="sequential"
          />
        )}
        {view === 'messages' && (
          <ReviewMessages messages={allMessages} groupBy="severity" />
        )}
        {view === 'files' && <FileAnnotations messages={allMessages} />}
      </div>

      {/* PR Info */}
      {review.pullRequest.aiGenerated && (
        <div className="mt-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-purple-900 mb-2">
            AI-Generated PR
          </h3>
          <div className="text-sm text-purple-700">
            This pull request was automatically generated by AI.
            {review.pullRequest.aiContext?.prompt && (
              <div className="mt-2">
                <strong>Prompt:</strong> {review.pullRequest.aiContext.prompt}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
