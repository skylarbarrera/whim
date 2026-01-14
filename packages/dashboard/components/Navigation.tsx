'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Overview' },
  { href: '/workers', label: 'Workers' },
  { href: '/queue', label: 'Queue' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/learnings', label: 'Learnings' },
  { href: '/metrics', label: 'Metrics' },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav style={{
      display: 'flex',
      gap: '1rem',
      padding: '1rem 2rem',
      borderBottom: '1px solid #e5e7eb',
      backgroundColor: '#f9fafb',
    }}>
      <Link
        href="/"
        style={{
          fontWeight: 'bold',
          fontSize: '1.25rem',
          color: '#111827',
          textDecoration: 'none',
          marginRight: '2rem',
        }}
      >
        AI Factory
      </Link>
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          style={{
            color: pathname === item.href ? '#2563eb' : '#6b7280',
            textDecoration: 'none',
            fontWeight: pathname === item.href ? '600' : '400',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            backgroundColor: pathname === item.href ? '#eff6ff' : 'transparent',
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
