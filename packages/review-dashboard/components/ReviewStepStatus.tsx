import type { ReviewStatus } from '@factory/review-system';

interface ReviewStepStatusProps {
  status: ReviewStatus;
  name: string;
  durationMs?: number;
}

const statusConfig: Record<
  ReviewStatus,
  { label: string; color: string; bgColor: string }
> = {
  PASS: { label: 'Pass', color: 'text-green-700', bgColor: 'bg-green-100' },
  FAIL: { label: 'Fail', color: 'text-red-700', bgColor: 'bg-red-100' },
  ERROR: { label: 'Error', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  PENDING: {
    label: 'Pending',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
  SKIPPED: {
    label: 'Skipped',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
};

export function ReviewStepStatus({
  status,
  name,
  durationMs,
}: ReviewStepStatusProps) {
  const config = statusConfig[status];
  const duration = durationMs
    ? durationMs < 1000
      ? `${durationMs}ms`
      : `${(durationMs / 1000).toFixed(1)}s`
    : undefined;

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color} ${config.bgColor}`}
      >
        {config.label}
      </span>
      <span className="text-sm font-medium text-gray-900">{name}</span>
      {duration && <span className="text-xs text-gray-500">{duration}</span>}
    </div>
  );
}
