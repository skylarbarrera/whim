import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Section } from '../components/Section.js';
import { Spinner } from '../components/Spinner.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { useApi } from '../hooks/useApi.js';
import { Logs } from './logs.js';
import type { Worker, WorkItem } from '@whim/shared';

interface StatusResponse {
  status: string;
  workers: { active: number; maxWorkers: number };
  queue: { size: number; oldest: string | null };
  rateLimits: {
    iterationsToday: number;
    dailyBudget: number;
    lastSpawn: string;
    cooldownSeconds: number;
  };
}

interface QueueResponse {
  items: WorkItem[];
  stats: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
}

interface DashboardProps {
  apiUrl?: string;
}

type FocusedSection = 'workers' | 'queue' | null;
type ViewMode = 'dashboard' | 'logs';

export const Dashboard: React.FC<DashboardProps> = ({ apiUrl = 'http://localhost:3000' }) => {
  const { data: statusData, loading: statusLoading, error: statusError, refetch: refetchStatus } = useApi<StatusResponse>('/api/status', { apiUrl });
  const { data: workersData, loading: workersLoading, error: workersError, refetch: refetchWorkers } = useApi<Worker[]>('/api/workers', { apiUrl });
  const { data: queueData, loading: queueLoading, error: queueError, refetch: refetchQueue } = useApi<QueueResponse>('/api/queue', { apiUrl });

  const loading = statusLoading || workersLoading || queueLoading;
  const error = statusError || workersError || queueError;
  const data = statusData;
  const refetch = () => { refetchStatus(); refetchWorkers(); refetchQueue(); };
  const [showHelp, setShowHelp] = useState(false);
  const [focusedSection, setFocusedSection] = useState<FocusedSection>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedWorker, setSelectedWorker] = useState<{ worker: Worker; workItem?: WorkItem } | null>(null);
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
      setFocusedSection('workers');
      setSelectedIndex(0);
    } else if (input === 'u') {
      setFocusedSection('queue');
      setSelectedIndex(0);
    } else if (input === 'l' && focusedSection === 'workers' && workersData) {
      // Open logs for selected worker
      if (workersData.length > 0 && selectedIndex < workersData.length) {
        const worker = workersData[selectedIndex];
        if (worker) {
          const workItem = queueData?.items.find(item => item.id === worker.workItemId);
          setSelectedWorker({ worker, workItem });
          setViewMode('logs');
        }
      }
    } else if (input === 'k') {
      // TODO: Kill selected worker
    } else if (input === 'c') {
      // TODO: Cancel selected queue item
    } else if (key.upArrow && focusedSection) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow && focusedSection) {
      const maxIndex = focusedSection === 'workers' ? (workersData?.length ?? 1) - 1 : (queueData?.items.length ?? 1) - 1;
      setSelectedIndex(prev => Math.min(maxIndex, prev + 1));
    }
  });

  if (loading && !data) {
    return (
      <Box flexDirection="column">
        <Text>
          Loading dashboard...
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

  // Show logs view if in logs mode
  if (viewMode === 'logs' && selectedWorker) {
    return (
      <Logs
        workerId={selectedWorker.worker.id}
        worker={selectedWorker.worker}
        workItem={selectedWorker.workItem}
        apiUrl={apiUrl}
        onBack={() => setViewMode('dashboard')}
      />
    );
  }

  const workers = workersData ?? [];
  const queue = queueData?.items ?? [];
  const metrics = {
    activeWorkers: data.workers.active,
    queuedItems: data.queue.size,
    completedToday: queueData?.stats.byStatus.completed ?? 0,
    failedToday: queueData?.stats.byStatus.failed ?? 0,
    iterationsToday: data.rateLimits.iterationsToday,
    dailyBudget: data.rateLimits.dailyBudget,
    avgCompletionTime: 0,
    successRate: 0,
  };

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
            {workers.map((worker, index) => {
              // Find the work item for this worker to get repo/branch
              const workItem = queue.find((item) => item.id === worker.workItemId);
              const progress = (worker.iteration / (workItem?.maxIterations || 10)) * 100;
              const isSelected = focusedSection === 'workers' && selectedIndex === index;

              return (
                <Box key={worker.id} flexDirection="column" marginBottom={1}>
                  <Box>
                    {isSelected && <Text color="cyan">→ </Text>}
                    <Spinner />
                    <Text> </Text>
                    <Text color="blue">{worker.id.substring(0, 8)}</Text>
                    <Text> </Text>
                    <Text bold>{workItem?.repo || 'unknown'}</Text>
                    <Text color="gray"> @ </Text>
                    <Text color="magenta">{workItem?.branch || 'unknown'}</Text>
                  </Box>
                  <Box marginLeft={isSelected ? 4 : 2}>
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
          Press 'q' to quit | 'w' workers | 'l' logs | 'r' refresh | '?' help
        </Text>
      </Box>

      {/* Help Overlay */}
      {showHelp && (
        <Box
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
            <Text>
              <Text color="yellow">w</Text> - Focus workers section
            </Text>
            <Text>
              <Text color="yellow">u</Text> - Focus queue section
            </Text>
            <Text>
              <Text color="yellow">l</Text> - View logs for selected worker
            </Text>
            <Text>
              <Text color="yellow">↑↓</Text> - Navigate items
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">k</Text> - Kill selected worker (coming soon)
            </Text>
            <Text color="gray" dimColor>
              <Text color="yellow">c</Text> - Cancel selected item (coming soon)
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
