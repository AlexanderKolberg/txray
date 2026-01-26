import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_CONTRACTS } from './abis.js';

export type Labels = Record<string, string>;

export interface LabelSources {
	builtin: Labels;
	user: Labels;
	project: Labels;
	custom: Labels;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_DIR = join(homedir(), '.config', 'txray');
const USER_LABELS_PATH = join(USER_CONFIG_DIR, 'labels.json');
const PROJECT_LABELS_PATH = join(__dirname, '..', 'labels.json');

function getBuiltinLabels(): Labels {
	const labels: Labels = {};
	for (const [address, name] of Object.entries(KNOWN_CONTRACTS)) {
		labels[address.toLowerCase()] = name;
	}
	return labels;
}

function loadLabelsFile(path: string): Labels {
	try {
		if (!existsSync(path)) {
			return {};
		}
		const content = readFileSync(path, 'utf-8');
		const parsed: unknown = JSON.parse(content);

		if (typeof parsed !== 'object' || parsed === null) {
			console.warn(`Warning: Invalid labels file at ${path} (expected object)`);
			return {};
		}

		const labels: Labels = {};
		for (const [address, name] of Object.entries(parsed)) {
			if (typeof name === 'string') {
				labels[address.toLowerCase()] = name;
			}
		}
		return labels;
	} catch (error) {
		console.warn(`Warning: Failed to load labels from ${path}: ${(error as Error).message}`);
		return {};
	}
}

export function loadLabels(customPath?: string): Labels {
	const sources: LabelSources = {
		builtin: getBuiltinLabels(),
		user: loadLabelsFile(USER_LABELS_PATH),
		project: loadLabelsFile(PROJECT_LABELS_PATH),
		custom: customPath ? loadLabelsFile(resolve(customPath)) : {},
	};

	return {
		...sources.builtin,
		...sources.user,
		...sources.project,
		...sources.custom,
	};
}

export function createLabelResolver(customPath?: string): (address: string) => string | undefined {
	const labels = loadLabels(customPath);
	return (address: string): string | undefined => labels[address.toLowerCase()];
}

export function getUserLabelsPath(): string {
	return USER_LABELS_PATH;
}

export function getProjectLabelsPath(): string {
	return PROJECT_LABELS_PATH;
}
