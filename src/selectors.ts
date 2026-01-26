import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SelectorCache = Record<string, string[]>;

const CACHE_DIR = join(homedir(), '.cache', 'txray');
const CACHE_FILE = join(CACHE_DIR, 'selectors.json');

const FOURBYTE_API = 'https://www.4byte.directory/api/v1/signatures/';
const OPENCHAIN_API = 'https://api.openchain.xyz/signature-database/v1/lookup';

let cache: SelectorCache | null = null;
let cacheModified = false;

function ensureCacheDir(): void {
	if (!existsSync(CACHE_DIR)) {
		mkdirSync(CACHE_DIR, { recursive: true });
	}
}

function loadCache(): SelectorCache {
	if (cache) return cache;

	try {
		if (existsSync(CACHE_FILE)) {
			const content = readFileSync(CACHE_FILE, 'utf-8');
			cache = JSON.parse(content) as SelectorCache;
			return cache;
		}
	} catch {}

	cache = {};
	return cache;
}

function saveCache(): void {
	if (!cacheModified || !cache) return;

	try {
		ensureCacheDir();
		writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
		cacheModified = false;
	} catch {}
}

function addToCache(selector: string, signatures: string[]): void {
	const c = loadCache();
	c[selector.toLowerCase()] = signatures;
	cacheModified = true;
}

async function fetchFrom4byte(selector: string): Promise<string[]> {
	try {
		const url = `${FOURBYTE_API}?hex_signature=${selector}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

		if (!response.ok) return [];

		const data = (await response.json()) as { results?: Array<{ text_signature: string }> };
		const results = data.results ?? [];

		return results.map((r) => r.text_signature);
	} catch {
		return [];
	}
}

async function fetchFromOpenchain(selector: string): Promise<string[]> {
	try {
		const url = `${OPENCHAIN_API}?function=${selector}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

		if (!response.ok) return [];

		const data = (await response.json()) as {
			result?: { function?: Record<string, Array<{ name: string }> | null> };
		};
		const functionSigs = data.result?.function?.[selector.toLowerCase()];

		if (!functionSigs) return [];

		return functionSigs.map((f) => f.name);
	} catch {
		return [];
	}
}

export async function lookupSelector(selector: string): Promise<string[]> {
	const normalizedSelector = selector.toLowerCase();

	if (normalizedSelector.length !== 10 || !normalizedSelector.startsWith('0x')) {
		return [];
	}

	const c = loadCache();
	const cached = c[normalizedSelector];
	if (cached !== undefined) {
		return cached;
	}

	let signatures = await fetchFrom4byte(normalizedSelector);

	if (signatures.length === 0) {
		signatures = await fetchFromOpenchain(normalizedSelector);
	}

	addToCache(normalizedSelector, signatures);
	saveCache();

	return signatures;
}

export function lookupSelectorSync(selector: string): string[] | undefined {
	const normalizedSelector = selector.toLowerCase();
	const c = loadCache();
	return c[normalizedSelector];
}

export function getCachePath(): string {
	return CACHE_FILE;
}

export function clearCache(): void {
	cache = {};
	cacheModified = true;
	saveCache();
}

export async function selectorCommand(args: string[]): Promise<void> {
	const selector = args[0];

	if (!selector) {
		console.log('Usage: txray selector <0x...>');
		console.log('');
		console.log('Look up function signature by 4-byte selector.');
		console.log('');
		console.log('Example: txray selector 0xa9059cbb');
		return;
	}

	if (!selector.startsWith('0x') || selector.length !== 10) {
		console.error('Invalid selector. Must be 10 characters starting with 0x (e.g., 0xa9059cbb)');
		process.exit(1);
	}

	console.log(`Looking up ${selector}...`);

	const signatures = await lookupSelector(selector);

	if (signatures.length === 0) {
		console.log('No signatures found.');
	} else if (signatures.length === 1) {
		console.log(`\nSignature: ${signatures[0]}`);
	} else {
		console.log(`\nFound ${signatures.length} possible signatures:`);
		for (const sig of signatures) {
			console.log(`  - ${sig}`);
		}
	}
}
