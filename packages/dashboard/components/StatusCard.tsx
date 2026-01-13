interface StatusCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  status?: 'success' | 'warning' | 'error' | 'neutral';
}

const statusColors = {
  success: { bg: '#dcfce7', text: '#166534' },
  warning: { bg: '#fef3c7', text: '#92400e' },
  error: { bg: '#fee2e2', text: '#991b1b' },
  neutral: { bg: '#f3f4f6', text: '#374151' },
};

export function StatusCard({ title, value, subtitle, status = 'neutral' }: StatusCardProps) {
  const colors = statusColors[status];

  return (
    <div
      style={{
        padding: '1.5rem',
        borderRadius: '0.5rem',
        backgroundColor: colors.bg,
        minWidth: '200px',
      }}
    >
      <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>
        {title}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: colors.text }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
