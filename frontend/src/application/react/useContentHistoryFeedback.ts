import { useEffect, useState } from 'react';
import type { WorkbookController } from './workbookControllerTypes';

export function useContentHistoryFeedback() {
  const [feedback, setFeedback] = useState<WorkbookController['contentHistoryFeedback']>();
  useEffect(() => {
    if (!feedback) return;
    const identity = feedback.identity;
    const timeout = window.setTimeout(() => {
      setFeedback((current) => current?.identity === identity ? undefined : current);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  return [feedback, setFeedback] as const;
}
