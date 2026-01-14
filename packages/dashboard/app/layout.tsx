import type { Metadata } from 'next';
import { Navigation } from '@/components';

export const metadata: Metadata = {
  title: 'Whim Dashboard',
  description: 'Monitor and manage Whim workers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <Navigation />
        <main style={{ padding: '2rem' }}>{children}</main>
      </body>
    </html>
  );
}
