import type { ReviewMessage, ReviewSeverity } from '@factory/review-system';

interface ReviewMessagesProps {
  messages: ReviewMessage[];
  groupBy?: 'severity' | 'file';
}

const severityConfig: Record<
  ReviewSeverity,
  { label: string; color: string; bgColor: string; borderColor: string }
> = {
  ERROR: {
    label: 'Error',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  WARNING: {
    label: 'Warning',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  INFO: {
    label: 'Info',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
};

function MessageItem({ message }: { message: ReviewMessage }) {
  const config = severityConfig[message.severity];

  return (
    <div
      className={`p-3 border rounded-lg ${config.bgColor} ${config.borderColor}`}
    >
      {/* Header with severity and location */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={`text-xs font-semibold ${config.color}`}>
          {config.label.toUpperCase()}
        </span>
        {message.file && (
          <span className="text-xs text-gray-600 font-mono">
            {message.file}
            {message.line !== undefined && `:${message.line}`}
            {message.column !== undefined && `:${message.column}`}
          </span>
        )}
      </div>

      {/* Message text */}
      <div className={`text-sm ${config.color}`}>{message.message}</div>

      {/* Suggestion */}
      {message.suggestion && (
        <div className="mt-2 p-2 bg-white border border-gray-200 rounded text-xs">
          <strong>Suggestion:</strong> {message.suggestion}
        </div>
      )}
    </div>
  );
}

export function ReviewMessages({
  messages,
  groupBy = 'severity',
}: ReviewMessagesProps) {
  if (messages.length === 0) {
    return (
      <div className="text-sm text-gray-500">No messages to display</div>
    );
  }

  if (groupBy === 'severity') {
    const grouped: Record<ReviewSeverity, ReviewMessage[]> = {
      ERROR: [],
      WARNING: [],
      INFO: [],
    };

    messages.forEach((msg) => {
      grouped[msg.severity].push(msg);
    });

    return (
      <div className="space-y-4">
        {(['ERROR', 'WARNING', 'INFO'] as ReviewSeverity[]).map(
          (severity) => {
            const severityMessages = grouped[severity];
            if (severityMessages.length === 0) return null;

            return (
              <div key={severity}>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  {severityConfig[severity].label}s ({severityMessages.length})
                </h4>
                <div className="space-y-2">
                  {severityMessages.map((msg, idx) => (
                    <MessageItem key={idx} message={msg} />
                  ))}
                </div>
              </div>
            );
          }
        )}
      </div>
    );
  }

  // Group by file
  const fileMap = new Map<string, ReviewMessage[]>();
  messages.forEach((msg) => {
    const file = msg.file || 'General';
    if (!fileMap.has(file)) {
      fileMap.set(file, []);
    }
    fileMap.get(file)!.push(msg);
  });

  return (
    <div className="space-y-4">
      {Array.from(fileMap.entries()).map(([file, fileMessages]) => (
        <div key={file}>
          <h4 className="text-sm font-semibold text-gray-900 mb-2 font-mono">
            {file} ({fileMessages.length})
          </h4>
          <div className="space-y-2">
            {fileMessages.map((msg, idx) => (
              <MessageItem key={idx} message={msg} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
