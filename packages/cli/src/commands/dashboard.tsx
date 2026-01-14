import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Section } from '../components/Section.js';
import { Spinner } from '../components/Spinner.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { useApi } from '../hooks/useApi.js';
import type { WhimMetrics, Worker, WorkItem } from '@whim/shared';

interface StatusResponse {
  status: string;
  workers: Worker[];
  queue: WorkItem[];
  metrics: WhimMetrics;
}

interface DashboardProps {
  apiUrl?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ apiUrl = 'http://localhost:3000' }) => {
  const { data, loading, error, refetch } = useApi<StatusResponse>('/api/status', { apiUrl });
  const [showHelp, setShowHelp] = useState(false);
  const { exit } = useApp();

  // Keyboard handler
  useInput((input, key) => {
    if (input === 'q') {
      exit();
    } else if (input === 'r') {
      refetch();
    } else if (input === '?') {
      setShowHelp(!showHelp);
    } else if (input === 'w') {
      // TODO: Focus workers section
    } else if (input === 'u') {
      // TODO: Focus queue section
    } else if (input === 'k') {
      // TODO: Kill selected worker
    } else if (input === 'c') {
      // TODO: Cancel selected queue item
    } else if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      // TODO: Navigate items
    }
  });

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
          <Box flexDirection="column">
            {workers.map((worker) => {
              // Find the work item for this worker to get repo/branch
              const workItem = queue.find((item) => item.id === worker.workItemId);
              const progress = (worker.iteration / (workItem?.maxIterations || 10)) * 100;

              return (
                <Box key={worker.id} flexDirection="column" marginBottom={1}>
                  <Box>
                    <Spinner />
                    <Text> </Text>
                    <Text color="blue">{worker.id.substring(0, 8)}</Text>
                    <Text> </Text>
                    <Text bold>{workItem?.repo || 'unknown'}</Text>
                    <Text color="gray"> @ </Text>
                    <Text color="magenta">{workItem?.branch || 'unknown'}</Text>
                  </Box>
                  <Box marginLeft={2}>
                    <Text color="gray">Iteration {worker.iteration} </Text>
                    <ProgressBar percent={progress} width={15} />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Section>

      {/* QUEUE Section */}
      <Section header="QUEUE">
        {queue.length === 0 ? (
          <Text color="gray" dimColor>
            Queue is empty
          </Text>
        ) : (
          <Box flexDirection="column">
            {queue
              .filter((item) => item.status === 'queued' || item.status === 'assigned')
              .slice(0, 5)
              .map((item) => {
                const statusColor =
                  item.status === 'queued'
                    ? 'yellow'
                    : item.status === 'assigned'
                    ? 'green'
                    : 'gray';

                return (
                  <Box key={item.id} marginBottom={1}>
                    <Text bold>{item.repo}</Text>
                    <Text color="gray"> @ </Text>
                    <Text color="magenta">{item.branch}</Text>
                    <Text color="gray"> | </Text>
                    <Text color={statusColor}>{item.status}</Text>
                    <Text color="gray"> | </Text>
                    <Text>{item.priority}</Text>
                  </Box>
                );
              })}
          </Box>
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

      {/* Help Overlay */}
      {showHelp && (
        <Box
          position="absolute"
          top={5}
          left={10}
          width={60}
          borderStyle="double"
          borderColor="cyan"
          padding={1}
          flexDirection="column"
        >
          <Text bold color="cyan" underline>
            KEYBOARD SHORTCUTS
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color="yellow">q</Text> - Quit dashboard
            </Text>
            <Text>
              <Text color="yellow">r</Text> - Force refresh
            </Text>
            <Text>
              <Text color="yellow">?</Text> - Toggle this help
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">w</Text> - Focus workers section (coming soon)
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">u</Text> - Focus queue section (coming soon)
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">k</Text> - Kill selected worker (coming soon)
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">c</Text> - Cancel selected item (coming soon)
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">↑↓</Text> - Navigate items (coming soon)
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
