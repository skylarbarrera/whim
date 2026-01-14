import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

interface SpinnerProps {
  interval?: number;
}

export const Spinner: React.FC<SpinnerProps> = ({ interval = 100 }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prevFrame) => (prevFrame + 1) % SPINNER_FRAMES.length);
    }, interval);

    return () => clearInterval(timer);
  }, [interval]);

  return <Text>{SPINNER_FRAMES[frame]}</Text>;
};
