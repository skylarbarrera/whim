'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient, type ReviewRecord } from '../lib/api';

export default function ReviewListPage() {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<{
    status?: string;
    aiOnly?: boolean;
  }>({});

  useEffect(() => {
    loadReviews();
    const interval = setInterval(loadReviews, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [filter]);

  const loadReviews = async () => {
    try {
      const data = await apiClient.fetchReviews({
        status: filter.status,
        aiGeneratedOnly: filter.aiOnly,
        limit: 50,
      });
      setReviews(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

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

  if (loading) {
    return <div className="text-center py-12">Loading reviews...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error: {error}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          PR Review Results
        </h1>

        {/* Filters */}
        <div className="flex gap-4 items-center">
          <div>
            <label htmlFor="status" className="text-sm font-medium text-gray-700 mr-2">
              Status:
            </label>
            <select
              id="status"
              value={filter.status || ''}
              onChange={(e) =>
                setFilter({ ...filter, status: e.target.value || undefined })
              }
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value="">All</option>
              <option value="PASS">Pass</option>
              <option value="FAIL">Fail</option>
              <option value="ERROR">Error</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="aiOnly"
              checked={filter.aiOnly || false}
              onChange={(e) =>
                setFilter({ ...filter, aiOnly: e.target.checked })
              }
              className="rounded border-gray-300"
            />
            <label htmlFor="aiOnly" className="text-sm font-medium text-gray-700">
              AI-generated only
            </label>
          </div>
        </div>
      </div>

      {/* Reviews table */}
      {reviews.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No reviews found matching your filters
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  PR
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Workflow
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Triggered
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reviews.map((review) => {
                const duration = review.completedAt
                  ? Math.round(
                      (new Date(review.completedAt).getTime() -
                        new Date(review.triggeredAt).getTime()) /
                        1000
                    )
                  : null;

                return (
                  <tr key={review.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link
                        href={`/reviews/${review.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        {review.pullRequest.owner}/{review.pullRequest.repo}#
                        {review.pullRequest.number}
                      </Link>
                      {review.pullRequest.aiGenerated && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          AI
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {review.workflow}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                          review.result.status
                        )}`}
                      >
                        {review.result.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(review.triggeredAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {duration !== null ? `${duration}s` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
