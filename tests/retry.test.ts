import { describe, expect, test } from 'bun:test';
import { RpcManager, withRetry } from '../src/retry.js';

describe('withRetry', () => {
	test('returns result on first success', async () => {
		const result = await withRetry(async () => 'success');
		expect(result).toBe('success');
	});

	test('retries on failure and eventually succeeds', async () => {
		let attempts = 0;
		const result = await withRetry(
			async () => {
				attempts++;
				if (attempts < 3) {
					throw new Error('rate limit');
				}
				return 'success';
			},
			{ maxAttempts: 3, initialDelayMs: 10 }
		);
		expect(result).toBe('success');
		expect(attempts).toBe(3);
	});

	test('throws after max attempts', async () => {
		let attempts = 0;
		await expect(
			withRetry(
				async () => {
					attempts++;
					throw new Error('rate limit');
				},
				{ maxAttempts: 2, initialDelayMs: 10 }
			)
		).rejects.toThrow('rate limit');
		expect(attempts).toBe(2);
	});

	test('does not retry non-retryable errors', async () => {
		let attempts = 0;
		await expect(
			withRetry(
				async () => {
					attempts++;
					throw new Error('invalid argument');
				},
				{ maxAttempts: 3, initialDelayMs: 10 }
			)
		).rejects.toThrow('invalid argument');
		expect(attempts).toBe(1);
	});
});

describe('RpcManager', () => {
	test('returns first RPC', () => {
		const manager = new RpcManager(['http://rpc1.com', 'http://rpc2.com']);
		expect(manager.getCurrentRpc()).toBe('http://rpc1.com');
	});

	test('rotates RPC after failures', () => {
		const manager = new RpcManager(['http://rpc1.com', 'http://rpc2.com']);

		manager.reportFailure('http://rpc1.com');
		manager.reportFailure('http://rpc1.com');
		manager.reportFailure('http://rpc1.com');

		expect(manager.getCurrentRpc()).toBe('http://rpc2.com');
	});

	test('resets failure count on success', () => {
		const manager = new RpcManager(['http://rpc1.com', 'http://rpc2.com']);

		manager.reportFailure('http://rpc1.com');
		manager.reportFailure('http://rpc1.com');
		manager.reportSuccess('http://rpc1.com');
		manager.reportFailure('http://rpc1.com');

		expect(manager.getCurrentRpc()).toBe('http://rpc1.com');
	});

	test('throws if no RPCs provided', () => {
		expect(() => new RpcManager([])).toThrow('At least one RPC URL is required');
	});
});
