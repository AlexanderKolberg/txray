import { describe, expect, test } from 'bun:test';
import { getCachePath, lookupSelector, lookupSelectorSync } from '../src/selectors.js';

describe('lookupSelector', () => {
	test('returns empty array for invalid selector', async () => {
		const result = await lookupSelector('invalid');
		expect(result).toEqual([]);
	});

	test('returns empty array for selector without 0x prefix', async () => {
		const result = await lookupSelector('a9059cbb');
		expect(result).toEqual([]);
	});

	test('returns empty array for short selector', async () => {
		const result = await lookupSelector('0x123');
		expect(result).toEqual([]);
	});
});

describe('lookupSelectorSync', () => {
	test('returns undefined for uncached selector', () => {
		const result = lookupSelectorSync('0x99999999');
		expect(result).toBeUndefined();
	});
});

describe('getCachePath', () => {
	test('returns a path ending with selectors.json', () => {
		const path = getCachePath();
		expect(path).toMatch(/selectors\.json$/);
	});
});
