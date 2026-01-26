import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
	defaultChain?: number;
	timeout?: number;
	outputFormat?: 'pretty' | 'json';
	customRpcs?: Record<number, string>;
	fallbackRpcs?: Record<number, string[]>;
	retryAttempts?: number;
}

const CONFIG_DIR = join(homedir(), '.config', 'txray');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
	defaultChain: 1,
	timeout: 30000,
	outputFormat: 'pretty',
	customRpcs: {},
	fallbackRpcs: {},
	retryAttempts: 3,
};

function ensureConfigDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

export function loadConfig(): Config {
	const envOverrides: Partial<Config> = {};

	const envChain = process.env.TXRAY_DEFAULT_CHAIN;
	if (envChain) {
		envOverrides.defaultChain = parseInt(envChain, 10);
	}

	const envTimeout = process.env.TXRAY_TIMEOUT;
	if (envTimeout) {
		envOverrides.timeout = parseInt(envTimeout, 10);
	}

	const envFormat = process.env.TXRAY_OUTPUT_FORMAT;
	if (envFormat === 'json' || envFormat === 'pretty') {
		envOverrides.outputFormat = envFormat;
	}

	try {
		if (existsSync(CONFIG_FILE)) {
			const content = readFileSync(CONFIG_FILE, 'utf-8');
			const fileConfig = JSON.parse(content) as Partial<Config>;
			return { ...DEFAULT_CONFIG, ...fileConfig, ...envOverrides };
		}
	} catch {}

	return { ...DEFAULT_CONFIG, ...envOverrides };
}

export function saveConfig(config: Config): void {
	ensureConfigDir();
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
	return CONFIG_FILE;
}

export function getCustomRpcUrl(chainId: number): string | undefined {
	const envRpc = process.env.TXRAY_RPC_URL;
	if (envRpc) return envRpc;

	const config = loadConfig();
	return config.customRpcs?.[chainId];
}

export function getAllRpcUrls(chainId: number): string[] {
	const config = loadConfig();
	const urls: string[] = [];

	const envRpc = process.env.TXRAY_RPC_URL;
	if (envRpc) urls.push(envRpc);

	const customRpc = config.customRpcs?.[chainId];
	if (customRpc) urls.push(customRpc);

	const fallbacks = config.fallbackRpcs?.[chainId];
	if (fallbacks) urls.push(...fallbacks);

	return urls;
}

export function getRetryAttempts(): number {
	const envRetry = process.env.TXRAY_RETRY_ATTEMPTS;
	if (envRetry) return Number.parseInt(envRetry, 10);

	const config = loadConfig();
	return config.retryAttempts ?? 3;
}

export async function configCommand(args: string[]): Promise<void> {
	const action = args[0];

	if (!action || action === 'show') {
		const config = loadConfig();
		console.log(`Config file: ${CONFIG_FILE}`);
		console.log('');
		console.log('Current configuration:');
		console.log(JSON.stringify(config, null, 2));
		console.log('');
		console.log('Environment overrides:');
		console.log(`  TXRAY_DEFAULT_CHAIN: ${process.env.TXRAY_DEFAULT_CHAIN ?? '(not set)'}`);
		console.log(`  TXRAY_TIMEOUT: ${process.env.TXRAY_TIMEOUT ?? '(not set)'}`);
		console.log(`  TXRAY_OUTPUT_FORMAT: ${process.env.TXRAY_OUTPUT_FORMAT ?? '(not set)'}`);
		console.log(`  TXRAY_RPC_URL: ${process.env.TXRAY_RPC_URL ?? '(not set)'}`);
		return;
	}

	if (action === 'set') {
		const key = args[1];
		const value = args[2];

		if (!key || !value) {
			console.log('Usage: txray config set <key> <value>');
			console.log('');
			console.log('Keys:');
			console.log('  defaultChain <number>    Default chain ID');
			console.log('  timeout <ms>             Request timeout in ms');
			console.log('  outputFormat <format>    Output format (pretty|json)');
			console.log('  rpc.<chainId> <url>      Custom RPC URL for chain');
			return;
		}

		const config = loadConfig();

		if (key === 'defaultChain') {
			config.defaultChain = parseInt(value, 10);
		} else if (key === 'timeout') {
			config.timeout = parseInt(value, 10);
		} else if (key === 'outputFormat') {
			if (value === 'pretty' || value === 'json') {
				config.outputFormat = value;
			} else {
				console.error('Invalid output format. Use "pretty" or "json".');
				process.exit(1);
			}
		} else if (key.startsWith('rpc.')) {
			const chainId = parseInt(key.slice(4), 10);
			if (!config.customRpcs) config.customRpcs = {};
			config.customRpcs[chainId] = value;
		} else {
			console.error(`Unknown config key: ${key}`);
			process.exit(1);
		}

		saveConfig(config);
		console.log(`Set ${key} = ${value}`);
		return;
	}

	if (action === 'path') {
		console.log(CONFIG_FILE);
		return;
	}

	console.log('Usage: txray config [show|set|path]');
	console.log('');
	console.log('Commands:');
	console.log('  show         Show current configuration');
	console.log('  set <k> <v>  Set a configuration value');
	console.log('  path         Show config file path');
}
