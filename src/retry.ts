export interface RetryOptions {
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
	shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
	maxAttempts: 3,
	initialDelayMs: 1000,
	maxDelayMs: 10000,
	backoffMultiplier: 2,
	shouldRetry: (error: Error) => {
		const message = error.message.toLowerCase();
		return (
			message.includes('rate limit') ||
			message.includes('429') ||
			message.includes('timeout') ||
			message.includes('etimedout') ||
			message.includes('econnreset') ||
			message.includes('enotfound') ||
			message.includes('network') ||
			message.includes('socket')
		);
	},
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	let lastError: Error | undefined;
	let delay = opts.initialDelayMs;

	for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			if (attempt === opts.maxAttempts || !opts.shouldRetry(lastError)) {
				throw lastError;
			}

			await sleep(delay);
			delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
		}
	}

	throw lastError;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RpcManager {
	private rpcs: string[];
	private currentIndex = 0;
	private failureCounts: Map<string, number> = new Map();
	private readonly maxFailures = 3;

	constructor(rpcs: string[]) {
		if (rpcs.length === 0) {
			throw new Error('At least one RPC URL is required');
		}
		this.rpcs = rpcs;
	}

	getCurrentRpc(): string {
		const rpc = this.rpcs[this.currentIndex];
		if (!rpc) {
			throw new Error('No RPC available');
		}
		return rpc;
	}

	reportFailure(rpc: string): void {
		const failures = (this.failureCounts.get(rpc) ?? 0) + 1;
		this.failureCounts.set(rpc, failures);

		if (failures >= this.maxFailures && this.rpcs.length > 1) {
			this.rotateRpc();
		}
	}

	reportSuccess(rpc: string): void {
		this.failureCounts.set(rpc, 0);
	}

	private rotateRpc(): void {
		this.currentIndex = (this.currentIndex + 1) % this.rpcs.length;
	}

	getRpcCount(): number {
		return this.rpcs.length;
	}
}
