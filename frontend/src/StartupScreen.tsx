export function StartupLoadingScreen() {
  return (
    <main className="startup-screen" aria-busy="true">
      <h1>Sheetspace</h1>
      <p>Loading workbook...</p>
    </main>
  );
}

export function StartupErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="startup-screen">
      <h1>Sheetspace</h1>
      <div className="startup-error" role="alert">
        <h2>Workbook could not be loaded</h2>
        <p>{message}</p>
      </div>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </main>
  );
}
