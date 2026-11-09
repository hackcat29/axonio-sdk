'use client';

import { useEffect, useState } from 'react';
import type { ClawDB } from 'axonio';

export interface UseClawDBOptions {
  endpoint?: string;
}

export interface UseClawDBResult {
  db: ClawDB | null;
  loading: boolean;
  error: Error | null;
}

export function useClawDB(options: UseClawDBOptions = {}): UseClawDBResult {
  const [db, setDb] = useState<ClawDB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const { ClawDB } = await import('axonio');
        const client = new ClawDB(options.endpoint ? { endpoint: options.endpoint } : {});

        if (!cancelled) {
          setDb(client);
        } else {
          client.close();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      setDb((current) => {
        current?.close();
        return null;
      });
    };
  }, [options.endpoint]);

  return { db, loading, error };
}
