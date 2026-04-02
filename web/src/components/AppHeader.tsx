interface AppHeaderProps {
  stats?: string;
  children?: React.ReactNode;
}

export function AppHeader({ stats, children }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {stats && <span className="header-stats">{stats}</span>}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {children}
      </div>
    </header>
  );
}
