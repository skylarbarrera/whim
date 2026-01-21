import React from 'react';
import { Box, Text } from 'ink';

interface ProgressBarProps {
  percent: number;
  width?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ percent, width = 20 }) => {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const filledWidth = Math.round((clampedPercent / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = '█'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);

  return (
    <Box>
      <Text color="green">{filledBar}</Text>
      <Text color="gray" dimColor>
        {emptyBar}
      </Text>
      <Text> {clampedPercent.toFixed(0)}%</Text>
    </Box>
  );
};
