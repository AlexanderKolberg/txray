import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import type { Labels } from './labels.js';

export interface DecodeContext {
	labels: Labels;
	selector: string;
	address?: string;
	chainId?: number;
}

export interface DecodedData {
	name: string;
	description?: string;
	params: Array<{ name: string; type: string; value: unknown }>;
	nested?: DecodedData[];
}

export interface Decoder {
	name: string;
	priority?: number;
	match: (data: Hex, context: DecodeContext) => boolean;
	decode: (data: Hex, context: DecodeContext) => DecodedData | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DECODERS_DIR = join(homedir(), '.config', 'txray', 'decoders');
const PROJECT_DECODERS_DIR = join(__dirname, '..', 'decoders');

const registeredDecoders: Decoder[] = [];

async function loadDecodersFromDir(dir: string): Promise<Decoder[]> {
	const decoders: Decoder[] = [];

	if (!existsSync(dir)) {
		return decoders;
	}

	try {
		const files = readdirSync(dir).filter(
			(f) => f.endsWith('.decoder.ts') || f.endsWith('.decoder.js')
		);

		for (const file of files) {
			try {
				const modulePath = join(dir, file);
				const mod = await import(modulePath);

				if (
					mod.default &&
					typeof mod.default === 'object' &&
					'name' in mod.default &&
					'match' in mod.default
				) {
					decoders.push(mod.default as Decoder);
				}

				if (
					mod.decoder &&
					typeof mod.decoder === 'object' &&
					'name' in mod.decoder &&
					'match' in mod.decoder
				) {
					decoders.push(mod.decoder as Decoder);
				}

				for (const [key, value] of Object.entries(mod)) {
					if (
						key !== 'default' &&
						key !== 'decoder' &&
						typeof value === 'object' &&
						value !== null &&
						'name' in value &&
						'match' in value
					) {
						decoders.push(value as Decoder);
					}
				}
			} catch (error) {
				console.warn(`Warning: Failed to load decoder from ${file}: ${(error as Error).message}`);
			}
		}
	} catch (error) {
		console.warn(`Warning: Failed to read decoders directory ${dir}: ${(error as Error).message}`);
	}

	return decoders;
}

export async function loadAllDecoders(): Promise<void> {
	registeredDecoders.length = 0;

	const projectDecoders = await loadDecodersFromDir(PROJECT_DECODERS_DIR);
	const userDecoders = await loadDecodersFromDir(USER_DECODERS_DIR);

	registeredDecoders.push(...projectDecoders, ...userDecoders);

	registeredDecoders.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function registerDecoder(decoder: Decoder): void {
	registeredDecoders.push(decoder);
	registeredDecoders.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function getDecoders(): Decoder[] {
	return [...registeredDecoders];
}

export function findDecoder(data: Hex, context: DecodeContext): Decoder | null {
	for (const decoder of registeredDecoders) {
		if (decoder.match(data, context)) {
			return decoder;
		}
	}
	return null;
}

export function decodeWithPlugins(data: Hex, context: DecodeContext): DecodedData | null {
	const decoder = findDecoder(data, context);
	if (!decoder) return null;

	try {
		return decoder.decode(data, context);
	} catch {
		return null;
	}
}

export function getUserDecodersPath(): string {
	return USER_DECODERS_DIR;
}

export function getProjectDecodersPath(): string {
	return PROJECT_DECODERS_DIR;
}
