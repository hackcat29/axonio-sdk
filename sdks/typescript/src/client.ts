import type { ClawDBConfig, ClawDBSession } from 'axonio-types';

import { BatchClient } from './batch';
import { BranchClient } from './branch.client';
import { ClawDBConfigResolver } from './config';
import { MemoryClient } from './memory.client';
import { ReflectClient } from './reflect.client';
import { SessionClient } from './session.client';
import { ClawDBEventStream } from './streaming';
import { SyncClient } from './sync.client';
import { TransportFactory } from './transport';
import type { SessionExecutor, Transport } from './types';

export class ClawDB {
  private readonly transport: Transport;
  private readonly config: Required<ClawDBConfig>;
  private readonly sessionClient: SessionClient;
  private session?: ClawDBSession;

  private memoryClient?: MemoryClient;
  private branchClient?: BranchClient;
  private syncClient?: SyncClient;
  private reflectClient?: ReflectClient;
  private eventStream?: ClawDBEventStream;
  private batchClient?: BatchClient;

  constructor(config: ClawDBConfig = {}) {
    const resolver = new ClawDBConfigResolver();
    this.config = resolver.resolve(config);
    this.transport = TransportFactory.create(this.config, () => this.session);
    this.sessionClient = new SessionClient(this.transport, {
      agentId: this.config.agentId,
      role: this.config.role,
      autoRefresh: true,
      onSessionChange: (session) => {
        this.session = session;
      }
    });
  }

  static create(config: ClawDBConfig = {}): ClawDB {
    return new ClawDB(config);
  }

  static fromEnv(): ClawDB {
    return new ClawDB(ClawDBConfigResolver.fromEnv());
  }

  static fromApiKey(apiKey: string, endpoint: string): ClawDB {
    return new ClawDB({
      apiKey,
      endpoint,
      tls: endpoint.startsWith('https://')
    });
  }

  async connect(): Promise<void> {
    this.session = await this.sessionClient.create({
      role: this.config.role
    });
  }

  async disconnect(): Promise<void> {
    this.eventStream?.close();
    await this.sessionClient.revoke();
    await this.transport.close?.();
    this.session = undefined;
  }

  async withSession<T>(fn: (db: ClawDB) => Promise<T>): Promise<T> {
    const alreadyConnected = this.session != null;

    if (!alreadyConnected) {
      await this.connect();
    }

    try {
      return await fn(this);
    } finally {
      if (!alreadyConnected) {
        await this.disconnect();
      }
    }
  }

  get memory(): MemoryClient {
    if (!this.memoryClient) {
      this.memoryClient = new MemoryClient(this.transport, () => this.getSession(), this.getExecutor());
    }
    return this.memoryClient;
  }

  get branches(): BranchClient {
    if (!this.branchClient) {
      this.branchClient = new BranchClient(this.transport, () => this.getSession(), this.getExecutor(), () => this);
    }
    return this.branchClient;
  }

  get sync(): SyncClient {
    if (!this.syncClient) {
      this.syncClient = new SyncClient(this.transport, () => this.getSession(), this.getExecutor());
    }
    return this.syncClient;
  }

  get reflect(): ReflectClient {
    if (!this.reflectClient) {
      this.reflectClient = new ReflectClient(this.transport, () => this.getSession(), this.getExecutor());
    }
    return this.reflectClient;
  }

  get events(): ClawDBEventStream {
    if (!this.eventStream) {
      this.eventStream = new ClawDBEventStream(this.transport, () => this.getSession());
    }
    return this.eventStream;
  }

  get batch(): BatchClient {
    if (!this.batchClient) {
      this.batchClient = new BatchClient(this.transport, () => this.getSession(), this.getExecutor());
    }
    return this.batchClient;
  }

  private getExecutor(): SessionExecutor {
    return <T>(fn: () => Promise<T>) => this.sessionClient.executeWithAutoRefresh(fn);
  }

  private getSession(): ClawDBSession {
    return this.sessionClient.assertSession();
  }
}
