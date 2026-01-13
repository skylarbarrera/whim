export default function HomePage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>AI Factory Dashboard</h1>
      <p>Dashboard coming soon...</p>
      <nav>
        <ul>
          <li><a href="/workers">Workers</a></li>
          <li><a href="/queue">Queue</a></li>
          <li><a href="/learnings">Learnings</a></li>
          <li><a href="/metrics">Metrics</a></li>
        </ul>
      </nav>
    </main>
  );
}
