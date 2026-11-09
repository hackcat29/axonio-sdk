import type { ClawDBSession, SyncResult } from 'axonio-types';

import { normalizeSyncResult, toDate, withSession } from './internal';
import type { SessionExecutor, SyncOptions, SyncStatus, Transport } from './types';

export class SyncClient {
  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession,
    private readonly executeWithSession: SessionExecutor
  ) {}

  async push(): Promise<SyncResult> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request('Sync.Push', withSession(this.session(), {}));
      return normalizeSyncResult(response);
    });
  }

  async pull(): Promise<SyncResult> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request('Sync.Pull', withSession(this.session(), {}));
      return normalizeSyncResult(response);
    });
  }

  async sync(): Promise<SyncResult> {
    await this.push();
    return this.pull();
  }

  async status(): Promise<SyncStatus> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request<Record<string, unknown>, Record<string, unknown>>(
        'Sync.Status',
        withSession(this.session(), {})
      );

      return {
        connected: Boolean(response.connected ?? response.syncConnected ?? response.sync_connected ?? false),
        pendingPush: Number(response.pendingPush ?? response.pending_push ?? 0),
        lastSyncAt:
          response.lastSyncAt == null && response.last_sync_at == null ? null : toDate(response.lastSyncAt ?? response.last_sync_at)
      };
    });
  }

  async configure(hubUrl: string, options: SyncOptions = {}): Promise<void> {
    await this.executeWithSession(async () => {
      await this.transport.request('Sync.Configure', withSession(this.session(), {
        hubUrl,
        hub_url: hubUrl,
        options
      }));
    });
  }
}
