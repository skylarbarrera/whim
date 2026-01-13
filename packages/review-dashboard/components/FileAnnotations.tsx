import type { ReviewMessage } from '@factory/review-system';

interface FileAnnotationsProps {
  messages: ReviewMessage[];
}

interface FileGroup {
  file: string;
  messages: ReviewMessage[];
}

export function FileAnnotations({ messages }: FileAnnotationsProps) {
  // Group messages by file
  const fileMap = new Map<string, ReviewMessage[]>();
  messages.forEach((msg) => {
    if (!msg.file) return; // Skip messages without file info

    if (!fileMap.has(msg.file)) {
      fileMap.set(msg.file, []);
    }
    fileMap.get(msg.file)!.push(msg);
  });

  // Convert to array and sort by file name
  const fileGroups: FileGroup[] = Array.from(fileMap.entries())
    .map(([file, messages]) => ({ file, messages }))
    .sort((a, b) => a.file.localeCompare(b.file));

  if (fileGroups.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No file-specific annotations to display
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {fileGroups.map((group) => {
        // Sort messages by line number
        const sortedMessages = [...group.messages].sort((a, b) => {
          if (a.line === undefined) return 1;
          if (b.line === undefined) return -1;
          return a.line - b.line;
        });

        // Count by severity
        const errorCount = sortedMessages.filter(
          (m) => m.severity === 'ERROR'
        ).length;
        const warningCount = sortedMessages.filter(
          (m) => m.severity === 'WARNING'
        ).length;
        const infoCount = sortedMessages.filter(
          (m) => m.severity === 'INFO'
        ).length;

        return (
          <div key={group.file} className="border border-gray-200 rounded-lg">
            {/* File header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono font-medium text-gray-900">
                  {group.file}
                </span>
                <div className="flex items-center gap-3 text-xs">
                  {errorCount > 0 && (
                    <span className="text-red-600">{errorCount} errors</span>
                  )}
                  {warningCount > 0 && (
                    <span className="text-yellow-600">
                      {warningCount} warnings
                    </span>
                  )}
                  {infoCount > 0 && (
                    <span className="text-blue-600">{infoCount} info</span>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="divide-y divide-gray-200">
              {sortedMessages.map((msg, idx) => {
                const severityColor =
                  msg.severity === 'ERROR'
                    ? 'text-red-600'
                    : msg.severity === 'WARNING'
                    ? 'text-yellow-600'
                    : 'text-blue-600';

                return (
                  <div key={idx} className="px-4 py-3">
                    {/* Location and severity */}
                    <div className="flex items-baseline gap-2 mb-1">
                      {msg.line !== undefined && (
                        <span className="text-xs font-mono text-gray-500">
                          Line {msg.line}
                          {msg.column !== undefined && `:${msg.column}`}
                        </span>
                      )}
                      <span className={`text-xs font-semibold ${severityColor}`}>
                        {msg.severity}
                      </span>
                    </div>

                    {/* Message */}
                    <div className="text-sm text-gray-900">{msg.message}</div>

                    {/* Suggestion */}
                    {msg.suggestion && (
                      <div className="mt-2 text-xs text-gray-700 bg-gray-50 p-2 rounded border border-gray-200">
                        💡 {msg.suggestion}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
