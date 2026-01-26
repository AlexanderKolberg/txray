import { describe, expect, test } from 'bun:test';
import { getNetworkByChainId, parseExplorerUrl } from '../src/networks.js';

describe('parseExplorerUrl', () => {
	test('parses etherscan mainnet URL', () => {
		const url =
			'https://etherscan.io/tx/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
		const result = parseExplorerUrl(url);

		expect(result.txHash).toBe(
			'0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
		);
		expect(result.chainId).toBe(1);
	});

	test('parses polygonscan URL', () => {
		const url =
			'https://polygonscan.com/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
		const result = parseExplorerUrl(url);

		expect(result.txHash).toBe(
			'0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
		);
		expect(result.chainId).toBe(137);
	});

	test('throws on invalid URL', () => {
		expect(() => parseExplorerUrl('not-a-url')).toThrow();
	});

	test('throws on URL without tx hash', () => {
		expect(() => parseExplorerUrl('https://etherscan.io/address/0x123')).toThrow();
	});

	test('normalizes tx hash to lowercase', () => {
		const url =
			'https://etherscan.io/tx/0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
		const result = parseExplorerUrl(url);

		expect(result.txHash).toBe(
			'0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
		);
	});
});

describe('getNetworkByChainId', () => {
	test('returns mainnet for chainId 1', () => {
		const network = getNetworkByChainId(1);
		expect(network.chainId).toBe(1);
	});

	test('returns polygon for chainId 137', () => {
		const network = getNetworkByChainId(137);
		expect(network.chainId).toBe(137);
	});

	test('throws on unknown chainId', () => {
		expect(() => getNetworkByChainId(999999)).toThrow();
	});
});
