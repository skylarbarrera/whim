'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../lib/api';
import { TriggerForm } from '../../components/TriggerForm';
import type { ReviewRecord } from '../../lib/api';

export default function TriggerPage() {
  const router = useRouter();
  const [result, setResult] = useState<ReviewRecord | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [cancelPoll, setCancelPoll] = useState<(() => void) | null>(null);

  const handleSubmit = async (request: Parameters<typeof apiClient.triggerReview>[0]) => {
    // Trigger the review
    const response = await apiClient.triggerReview(request);

    // Start polling for updates
    setIsPolling(true);
    const cancel = await apiClient.pollReviewStatus(
      response.reviewId,
      (review) => {
        setResult(review);

        // Stop polling when complete
        if (review.completedAt) {
          setIsPolling(false);
          setCancelPoll(null);
        }
      }
    );
    setCancelPoll(() => cancel);
  };

  const handleCancel = () => {
    if (cancelPoll) {
      cancelPoll();
      setIsPolling(false);
      setCancelPoll(null);
    }
  };

  const handleViewDetails = () => {
    if (result) {
      router.push(`/reviews/${result.id}`);
    }
  };

  // Available workflows (in real app, fetch from API)
  const workflows = ['default', 'lint-only', 'full-review'];

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Trigger Manual Review
      </h1>

      <div className="bg-white p-6 border border-gray-200 rounded-lg mb-6">
        <TriggerForm workflows={workflows} onSubmit={handleSubmit} />
      </div>

      {/* Status display */}
      {isPolling && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-blue-900 mb-1">
                Review in Progress
              </h3>
              <p className="text-sm text-blue-700">
                {result
                  ? `${result.result.results.length} step(s) completed...`
                  : 'Starting review...'}
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-sm text-blue-700 hover:text-blue-900"
            >
              Cancel
            </button>
          </div>

          {/* Progress indicator */}
          <div className="mt-3">
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full animate-pulse"
                style={{ width: '70%' }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Result display */}
      {result && result.completedAt && (
        <div
          className={`border rounded-lg p-4 ${
            result.result.status === 'PASS'
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3
                className={`text-sm font-semibold mb-1 ${
                  result.result.status === 'PASS'
                    ? 'text-green-900'
                    : 'text-red-900'
                }`}
              >
                Review Complete: {result.result.status}
              </h3>
              <p
                className={`text-sm ${
                  result.result.status === 'PASS'
                    ? 'text-green-700'
                    : 'text-red-700'
                }`}
              >
                {result.pullRequest.owner}/{result.pullRequest.repo}#
                {result.pullRequest.number}
              </p>
            </div>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                result.result.status === 'PASS'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {result.result.status}
            </span>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-xs text-gray-600">Steps</div>
              <div className="text-lg font-semibold text-gray-900">
                {result.result.results.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Errors</div>
              <div className="text-lg font-semibold text-red-600">
                {result.result.totalErrors}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Warnings</div>
              <div className="text-lg font-semibold text-yellow-600">
                {result.result.totalWarnings}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleViewDetails}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              View Details
            </button>
            <button
              onClick={() => setResult(null)}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Trigger Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
