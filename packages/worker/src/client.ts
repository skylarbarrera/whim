import type {
  WorkerHeartbeatRequest,
  WorkerLockRequest,
  WorkerLockResponse,
  WorkerCompleteRequest,
  WorkerFailRequest,
  WorkerStuckRequest,
  Learning,
} from "@whim/shared";

export interface OrchestratorClientConfig {
  baseUrl: string;
  workerId: string;
}

export class OrchestratorClient {
  readonly baseUrl: string;
  readonly workerId: string;

  constructor(config: OrchestratorClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.workerId = config.workerId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Request failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async heartbeat(
    iteration: number,
    status?: string,
    tokens?: { in: number; out: number }
  ): Promise<void> {
    const body: WorkerHeartbeatRequest = {
      iteration,
      status,
      tokensIn: tokens?.in,
      tokensOut: tokens?.out,
    };

    await this.request<void>(
      "POST",
      `/api/worker/${this.workerId}/heartbeat`,
      body
    );
  }

  async lockFile(files: string[]): Promise<WorkerLockResponse> {
    const body: WorkerLockRequest = { files };
    return this.request<WorkerLockResponse>(
      "POST",
      `/api/worker/${this.workerId}/lock`,
      body
    );
  }

  async unlockFile(files: string[]): Promise<void> {
    const body: WorkerLockRequest = { files };
    await this.request<void>(
      "POST",
      `/api/worker/${this.workerId}/unlock`,
      body
    );
  }

  async complete(
    prUrl?: string,
    metrics?: WorkerCompleteRequest["metrics"],
    learnings?: WorkerCompleteRequest["learnings"],
    prNumber?: number,
    review?: WorkerCompleteRequest["review"]
  ): Promise<void> {
    const body: WorkerCompleteRequest = {
      prUrl,
      prNumber,
      review,
      metrics,
      learnings,
    };

    await this.request<void>(
      "POST",
      `/api/worker/${this.workerId}/complete`,
      body
    );
  }

  async fail(error: string, iteration: number): Promise<void> {
    const body: WorkerFailRequest = { error, iteration };
    await this.request<void>(
      "POST",
      `/api/worker/${this.workerId}/fail`,
      body
    );
  }

  async stuck(reason: string, attempts: number): Promise<void> {
    const body: WorkerStuckRequest = { reason, attempts };
    await this.request<void>(
      "POST",
      `/api/worker/${this.workerId}/stuck`,
      body
    );
  }

  async getLearnings(repo: string): Promise<Learning[]> {
    const encoded = encodeURIComponent(repo);
    return this.request<Learning[]>("GET", `/api/learnings?repo=${encoded}`);
  }
}
