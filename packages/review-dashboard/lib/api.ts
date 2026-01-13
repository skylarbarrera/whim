import type {
  ReviewWorkflowResult,
  PullRequestInfo,
} from '@factory/review-system';

/**
 * Review record stored in the system
 */
export interface ReviewRecord {
  id: string;
  pullRequest: PullRequestInfo;
  workflow: string;
  result: ReviewWorkflowResult;
  triggeredBy: 'webhook' | 'manual' | 'scheduled';
  triggeredAt: string;
  completedAt?: string;
}

/**
 * Request to trigger a manual review
 */
export interface TriggerReviewRequest {
  owner: string;
  repo: string;
  pullNumber: number;
  workflow: string;
  sha?: string;
}

/**
 * Response from triggering a review
 */
export interface TriggerReviewResponse {
  reviewId: string;
  status: 'queued' | 'running';
}

/**
 * API client for review dashboard
 */
export class ReviewApiClient {
  private baseUrl: string;

  constructor(baseUrl = '/api/reviews') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch list of reviews
   */
  async fetchReviews(options?: {
    owner?: string;
    repo?: string;
    status?: string;
    aiGeneratedOnly?: boolean;
    limit?: number;
  }): Promise<ReviewRecord[]> {
    const params = new URLSearchParams();
    if (options?.owner) params.set('owner', options.owner);
    if (options?.repo) params.set('repo', options.repo);
    if (options?.status) params.set('status', options.status);
    if (options?.aiGeneratedOnly) params.set('aiOnly', 'true');
    if (options?.limit) params.set('limit', options.limit.toString());

    const url = `${this.baseUrl}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch reviews: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetch a single review by ID
   */
  async fetchReviewById(reviewId: string): Promise<ReviewRecord | null> {
    const response = await fetch(`${this.baseUrl}/${reviewId}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch review: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Trigger a manual review
   */
  async triggerReview(
    request: TriggerReviewRequest
  ): Promise<TriggerReviewResponse> {
    const response = await fetch(`${this.baseUrl}/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to trigger review: ${error}`);
    }

    return response.json();
  }

  /**
   * Poll for review status updates
   */
  async pollReviewStatus(
    reviewId: string,
    onUpdate: (review: ReviewRecord) => void,
    intervalMs = 2000
  ): Promise<() => void> {
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const review = await this.fetchReviewById(reviewId);
          if (review) {
            onUpdate(review);

            // Stop polling if review is complete
            if (review.completedAt) {
              break;
            }
          }
        } catch (error) {
          console.error('Error polling review status:', error);
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    };

    poll();

    // Return cancel function
    return () => {
      cancelled = true;
    };
  }
}

/**
 * Default API client instance
 */
export const apiClient = new ReviewApiClient();
