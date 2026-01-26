import { describe, expect, test } from 'bun:test';
import { createLabelResolver, loadLabels } from '../src/labels.js';

describe('loadLabels', () => {
	test('loads builtin labels', () => {
		const labels = loadLabels();

		expect(labels['0x0000000000000068f116a894984e2db1123eb395']).toBe('Seaport 1.6');
		expect(labels['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']).toBe('WETH (Mainnet)');
	});

	test('returns empty object for non-existent custom path', () => {
		const labels = loadLabels('/non/existent/path.json');

		expect(Object.keys(labels).length).toBeGreaterThan(0);
	});
});

describe('createLabelResolver', () => {
	test('resolves known address', () => {
		const resolver = createLabelResolver();

		const label = resolver('0x0000000000000068F116A894984e2DB1123eb395');
		expect(label).toBe('Seaport 1.6');
	});

	test('returns undefined for unknown address', () => {
		const resolver = createLabelResolver();

		const label = resolver('0x0000000000000000000000000000000000000001');
		expect(label).toBeUndefined();
	});

	test('normalizes address to lowercase', () => {
		const resolver = createLabelResolver();

		const label1 = resolver('0x0000000000000068f116a894984e2db1123eb395');
		const label2 = resolver('0x0000000000000068F116A894984E2DB1123EB395');

		expect(label1).toBe(label2);
	});
});
