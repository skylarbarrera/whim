import React from 'react';
import { Box, Text } from 'ink';

interface SectionProps {
  header: string;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ header, children }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {header}
        </Text>
      </Box>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
};
