import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	KNOWN_CONTRACTS as baseKnownContracts,
	KNOWN_TOPICS as baseKnownTopics,
} from '../known.js';
import { COMMON_ERRORS_ABI } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const abiDir = join(__dirname, '..', 'abi');

type AbiItem = {
	type: string;
	name?: string;
	inputs?: ReadonlyArray<{
		readonly indexed?: boolean;
		readonly name: string;
		readonly type: string;
	}>;
};

const allAbis: AbiItem[] = [...(COMMON_ERRORS_ABI as unknown as AbiItem[])];
const knownTopics: Record<string, string> = { ...baseKnownTopics };
const knownContracts: Record<string, string> = { ...baseKnownContracts };

const files = readdirSync(abiDir).filter((f) => f.endsWith('.ts'));

for (const file of files) {
	const mod = await import(join(abiDir, file));

	for (const [key, value] of Object.entries(mod)) {
		if (Array.isArray(value)) {
			allAbis.push(...(value as AbiItem[]));
		} else if (key === 'KNOWN_TOPICS' && typeof value === 'object') {
			Object.assign(knownTopics, value);
		} else if (key === 'KNOWN_CONTRACTS' && typeof value === 'object') {
			Object.assign(knownContracts, value);
		}
	}
}

export const ALL_ABIS = allAbis;
export const KNOWN_TOPICS = knownTopics;
export const KNOWN_CONTRACTS = knownContracts;
