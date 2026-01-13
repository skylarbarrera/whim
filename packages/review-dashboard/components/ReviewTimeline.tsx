import type { ReviewStepResult } from '@factory/review-system';
import { ReviewStepStatus } from './ReviewStepStatus';

interface ReviewTimelineProps {
  results: ReviewStepResult[];
  mode: 'sequential' | 'parallel';
}

export function ReviewTimeline({ results, mode }: ReviewTimelineProps) {
  if (results.length === 0) {
    return (
      <div className="text-sm text-gray-500">No review steps executed</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-gray-700">
        Execution Mode: {mode === 'sequential' ? 'Sequential' : 'Parallel'}
      </div>

      <div className="space-y-2">
        {results.map((result, index) => (
          <div
            key={`${result.stepName}-${index}`}
            className="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg"
          >
            {/* Step number or parallel indicator */}
            <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-700">
              {mode === 'sequential' ? index + 1 : '•'}
            </div>

            {/* Step status and details */}
            <div className="flex-1 min-w-0">
              <ReviewStepStatus
                status={result.status}
                name={result.stepName}
                durationMs={result.durationMs}
              />

              {/* Timestamps */}
              {result.startedAt && (
                <div className="mt-1 text-xs text-gray-500">
                  Started: {new Date(result.startedAt).toLocaleString()}
                  {result.completedAt && (
                    <> • Completed: {new Date(result.completedAt).toLocaleString()}</>
                  )}
                </div>
              )}

              {/* Error message */}
              {result.error && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  <strong>Error:</strong> {result.error.message}
                </div>
              )}

              {/* Message count */}
              {result.messages.length > 0 && (
                <div className="mt-2 text-xs text-gray-600">
                  {result.messages.length} message
                  {result.messages.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
