import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Section } from '../components/Section.js';
import { Spinner } from '../components/Spinner.js';
import { useApi } from '../hooks/useApi.js';
import type { WorkerLogsResponse, Worker, WorkItem } from '@whim/shared';

interface LogsProps {
  workerId: string;
  worker: Worker;
  workItem: WorkItem | undefined;
  apiUrl?: string;
  onBack: () => void;
}

export const Logs: React.FC<LogsProps> = ({ workerId, worker, workItem, apiUrl = 'http://localhost:3000', onBack }) => {
  const { data, loading, error } = useApi<WorkerLogsResponse>(`/api/workers/${workerId}/logs`, { apiUrl, pollInterval: 2000 });

  // Keyboard handler
  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onBack();
    }
  });

  if (loading && !data) {
    return (
      <Box flexDirection="column">
        <Text>
          Loading logs... <Spinner />
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Section header="LOGS - ERROR">
          <Text color="red">Error: {error}</Text>
          <Text color="gray" dimColor marginTop={1}>
            Press 'q' or ESC to go back
          </Text>
        </Section>
      </Box>
    );
  }

  if (!data) {
    return <Text>No logs available</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          WORKER LOGS
        </Text>
        <Text> </Text>
        <Spinner />
      </Box>

      {/* Worker Info */}
      <Section header="WORKER INFO">
        <Box flexDirection="column">
          <Text>
            <Text color="gray">Worker ID: </Text>
            <Text color="blue">{worker.id.substring(0, 8)}</Text>
          </Text>
          <Text>
            <Text color="gray">Status: </Text>
            <Text color={worker.status === 'running' ? 'green' : worker.status === 'failed' ? 'red' : 'yellow'}>
              {worker.status}
            </Text>
          </Text>
          {workItem && (
            <>
              <Text>
                <Text color="gray">Repo: </Text>
                <Text bold>{workItem.repo}</Text>
              </Text>
              <Text>
                <Text color="gray">Branch: </Text>
                <Text color="magenta">{workItem.branch}</Text>
              </Text>
              <Text>
                <Text color="gray">Iteration: </Text>
                <Text>{worker.iteration}</Text>
              </Text>
            </>
          )}
        </Box>
      </Section>

      {/* Logs */}
      <Section header="LOGS">
        {data.logs.length === 0 ? (
          <Text color="gray" dimColor>
            No logs available
          </Text>
        ) : (
          <Box flexDirection="column">
            {data.logs.slice(-30).map((line, index) => (
              <Text key={index} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Section>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="cyan" dimColor>
          Press 'q' or ESC to go back | Updates every 2s
        </Text>
      </Box>
    </Box>
  );
};
