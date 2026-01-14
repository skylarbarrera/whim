import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section.js';
import { Spinner } from '../components/Spinner.js';
import { useApi } from '../hooks/useApi.js';
import type { WhimMetrics, Worker, WorkItem } from '@whim/shared';

interface StatusResponse {
  status: string;
  workers: Worker[];
  queue: WorkItem[];
  metrics: WhimMetrics;
}

export const Dashboard: React.FC = () => {
  const { data, loading, error } = useApi<StatusResponse>('/api/status');

  if (loading && !data) {
    return (
      <Box flexDirection="column">
        <Text>
          Loading dashboard... <Spinner />
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text color="gray" dimColor>
          Make sure the orchestrator is running at http://localhost:3000
        </Text>
      </Box>
    );
  }

  if (!data) {
    return <Text>No data available</Text>;
  }

  const { workers, queue, metrics } = data;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header with refresh indicator */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          WHIM DASHBOARD
        </Text>
        <Text> </Text>
        <Spinner />
      </Box>

      {/* STATUS Section */}
      <Section header="STATUS">
        <Box flexDirection="column">
          <Text>
            <Text color="gray">State: </Text>
            <Text color="green">{data.status}</Text>
          </Text>
          <Text>
            <Text color="gray">Workers: </Text>
            <Text>{metrics.activeWorkers}</Text>
          </Text>
          <Text>
            <Text color="gray">Queue Depth: </Text>
            <Text>{metrics.queuedItems}</Text>
          </Text>
        </Box>
      </Section>

      {/* WORKERS Section */}
      <Section header="WORKERS">
        {workers.length === 0 ? (
          <Text color="gray" dimColor>
            No active workers
          </Text>
        ) : (
          <Text color="gray" dimColor>
            {workers.length} worker(s) - detailed view coming soon
          </Text>
        )}
      </Section>

      {/* QUEUE Section */}
      <Section header="QUEUE">
        {queue.length === 0 ? (
          <Text color="gray" dimColor>
            Queue is empty
          </Text>
        ) : (
          <Text color="gray" dimColor>
            {queue.length} item(s) - detailed view coming soon
          </Text>
        )}
      </Section>

      {/* TODAY Section */}
      <Section header="TODAY">
        <Box flexDirection="column">
          <Text>
            <Text color="green">✓ Completed: </Text>
            <Text>{metrics.completedToday}</Text>
          </Text>
          <Text>
            <Text color="red">✗ Failed: </Text>
            <Text>{metrics.failedToday}</Text>
          </Text>
          <Text>
            <Text color="gray">Iterations: </Text>
            <Text>{metrics.iterationsToday}</Text>
          </Text>
          <Text>
            <Text color="yellow">Success Rate: </Text>
            <Text>{(metrics.successRate * 100).toFixed(1)}%</Text>
          </Text>
        </Box>
      </Section>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="cyan" dimColor>
          Press 'q' to quit | 'r' to refresh | '?' for help
        </Text>
      </Box>
    </Box>
  );
};
