import { useEffect, useState } from 'react';

type HealthResponse = {
  status: string;
  service: string;
};

export function App() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    void fetch('/api/health')
      .then((response) => response.json() as Promise<HealthResponse>)
      .then((payload) => setStatus(`${payload.service}:${payload.status}`))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <main>
      <h1>Sheetspace Tech Skeleton</h1>
      <p data-testid="api-status">Backend health: {status}</p>
    </main>
  );
}
