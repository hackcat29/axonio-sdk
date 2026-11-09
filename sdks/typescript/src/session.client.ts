import { ClawDBAuthError, ClawDBError, ClawDBInternalError } from 'axonio-errors';
import type { ClawDBSession } from 'axonio-types';

import { normalizeBatchError, normalizeSession } from './internal';
import type { SessionCreateOptions, Transport } from './types';

interface SessionClientConfig {
  agentId: string;
  role: string;
  autoRefresh?: boolean;
  onSessionChange?: (session: ClawDBSession | undefined) => void;
}

export class SessionClient {
  private currentSession?: ClawDBSession;

  constructor(
    private readonly transport: Transport,
    private readonly config: SessionClientConfig = {
      agentId: '',
      role: 'assistant',
      autoRefresh: true
    }
  ) {}

  get session(): ClawDBSession | undefined {
    return this.currentSession;
  }

  async create(options: SessionCreateOptions = {}): Promise<ClawDBSession> {
    const response = await this.transport.request<
      { agentId: string; role: string; scopes: string[]; taskType?: string },
      { session?: unknown } | unknown
    >('Session.Create', {
      agentId: this.config.agentId,
      role: options.role ?? this.config.role,
      scopes: options.scopes ?? [],
      taskType: options.taskType
    });

    return this.updateSession(normalizeSession((response as { session?: unknown }).session ?? response, {
      agentId: this.config.agentId,
      role: options.role ?? this.config.role,
      scopes: options.scopes ?? []
    }));
  }

  async validate(): Promise<boolean> {
    if (!this.currentSession?.token) {
      return false;
    }

    const response = await this.transport.request<Record<string, unknown>, { valid?: boolean; ok?: boolean }>(
      'Session.Validate',
      { token: this.currentSession.token, sessionToken: this.currentSession.token, session_token: this.currentSession.token }
    );

    return Boolean(response.valid ?? response.ok);
  }

  async refresh(): Promise<ClawDBSession> {
    if (!this.currentSession?.token) {
      throw new ClawDBAuthError('SESSION_EXPIRED', 'No session available to refresh.');
    }

    const response = await this.transport.request<Record<string, unknown>, { session?: unknown } | unknown>('Session.Refresh', {
      token: this.currentSession.token,
      sessionToken: this.currentSession.token,
      session_token: this.currentSession.token
    });

    return this.updateSession(normalizeSession((response as { session?: unknown }).session ?? response, {
      agentId: this.currentSession.agentId,
      role: this.currentSession.role,
      scopes: this.currentSession.scopes
    }));
  }

  async revoke(): Promise<void> {
    if (!this.currentSession?.token) {
      return;
    }

    await this.transport.request('Session.Revoke', {
      token: this.currentSession.token,
      sessionToken: this.currentSession.token,
      session_token: this.currentSession.token
    });

    this.currentSession = undefined;
    this.config.onSessionChange?.(undefined);
  }

  async executeWithAutoRefresh<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!this.shouldRefresh(error) || this.config.autoRefresh === false) {
        throw normalizeBatchError(error);
      }

      await this.refresh();

      try {
        return await operation();
      } catch (retryError) {
        throw normalizeBatchError(retryError);
      }
    }
  }

  assertSession(): ClawDBSession {
    if (!this.currentSession) {
      throw new ClawDBInternalError('Session has not been established. Call connect() first.');
    }

    return this.currentSession;
  }

  private shouldRefresh(error: unknown): boolean {
    if (error instanceof ClawDBAuthError) {
      return true;
    }

    if (ClawDBError.isClawDBError(error)) {
      return error.code === 'AUTH_FAILED' || error.code === 'SESSION_EXPIRED' || error.code === 'INVALID_API_KEY';
    }

    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    const code = (error as { code: unknown }).code;
    return code === 'AUTH_FAILED' || code === 'SESSION_EXPIRED' || code === 'INVALID_API_KEY' || code === 16 || code === '16';
  }

  private updateSession(session: ClawDBSession): ClawDBSession {
    this.currentSession = session;
    this.config.onSessionChange?.(session);
    return session;
  }
}
