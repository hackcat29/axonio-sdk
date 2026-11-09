import { ClawDBTimeoutError } from 'axonio-errors';
import type { ClawDBSession, ReflectJob } from 'axonio-types';

import { normalizeAgentProfile, normalizeReflectJob, sleep, withSession } from './internal';
import type { AgentProfile, SessionExecutor, Transport } from './types';

export class ReflectClient {
  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession,
    private readonly executeWithSession: SessionExecutor
  ) {}

  async trigger(options: { jobType?: 'full' | 'summarise' | 'extract' | 'deduplicate'; dryRun?: boolean } = {}): Promise<ReflectJob> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request('Reflect.Trigger', withSession(this.session(), {
        jobType: options.jobType,
        job_type: options.jobType,
        dryRun: options.dryRun ?? false,
        dry_run: options.dryRun ?? false
      }));

      return normalizeReflectJob(response, 'pending');
    });
  }

  async status(jobId: string): Promise<ReflectJob> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request('Reflect.Status', withSession(this.session(), {
        jobId,
        job_id: jobId
      }));

      return normalizeReflectJob(response, 'running');
    });
  }

  async waitForCompletion(
    jobId: string,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {}
  ): Promise<ReflectJob> {
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 60000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = await this.status(jobId);
      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }

      await sleep(pollIntervalMs);
    }

    throw new ClawDBTimeoutError(`Reflect job ${jobId} timed out`, timeoutMs, { jobId });
  }

  async getProfile(): Promise<AgentProfile> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request('Reflect.Profile', withSession(this.session(), {}));
      return normalizeAgentProfile(response);
    });
  }
}
