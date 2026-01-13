'use client';

import { useState } from 'react';
import type { TriggerReviewRequest } from '../lib/api';

interface TriggerFormProps {
  workflows: string[];
  onSubmit: (request: TriggerReviewRequest) => Promise<void>;
}

export function TriggerForm({ workflows, onSubmit }: TriggerFormProps) {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [pullNumber, setPullNumber] = useState('');
  const [workflow, setWorkflow] = useState(workflows[0] || '');
  const [sha, setSha] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!owner || !repo || !pullNumber || !workflow) {
      setError('Please fill in all required fields');
      return;
    }

    const pullNumberInt = parseInt(pullNumber, 10);
    if (isNaN(pullNumberInt) || pullNumberInt <= 0) {
      setError('Pull request number must be a positive integer');
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit({
        owner,
        repo,
        pullNumber: pullNumberInt,
        workflow,
        sha: sha || undefined,
      });

      // Reset form on success
      setOwner('');
      setRepo('');
      setPullNumber('');
      setSha('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger review');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="owner"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Repository Owner *
          </label>
          <input
            type="text"
            id="owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g., octocat"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label
            htmlFor="repo"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Repository Name *
          </label>
          <input
            type="text"
            id="repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="e.g., hello-world"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="pullNumber"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Pull Request Number *
          </label>
          <input
            type="number"
            id="pullNumber"
            value={pullNumber}
            onChange={(e) => setPullNumber(e.target.value)}
            placeholder="e.g., 42"
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label
            htmlFor="workflow"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Workflow *
          </label>
          <select
            id="workflow"
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isSubmitting}
          >
            {workflows.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="sha"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Commit SHA (optional)
        </label>
        <input
          type="text"
          id="sha"
          value={sha}
          onChange={(e) => setSha(e.target.value)}
          placeholder="e.g., abc123..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isSubmitting}
        />
        <p className="mt-1 text-xs text-gray-500">
          If not specified, the latest commit on the PR will be reviewed
        </p>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Triggering Review...' : 'Trigger Review'}
      </button>
    </form>
  );
}
