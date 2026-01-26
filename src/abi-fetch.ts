import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';

const ABI_CACHE_DIR = join(homedir(), '.cache', 'txray', 'abi');

interface EtherscanResponse {
	status: string;
	message: string;
	result: string;
}

interface SourcifyMetadata {
	output?: {
		abi?: unknown[];
	};
}

function ensureCacheDir(): void {
	if (!existsSync(ABI_CACHE_DIR)) {
		mkdirSync(ABI_CACHE_DIR, { recursive: true });
	}
}

function getCachePath(chainId: number, address: string): string {
	return join(ABI_CACHE_DIR, `${chainId}-${address.toLowerCase()}.json`);
}

function loadFromCache(chainId: number, address: string): unknown[] | null {
	const cachePath = getCachePath(chainId, address);
	if (existsSync(cachePath)) {
		try {
			const content = readFileSync(cachePath, 'utf-8');
			return JSON.parse(content);
		} catch {
			return null;
		}
	}
	return null;
}

function saveToCache(chainId: number, address: string, abi: unknown[]): void {
	ensureCacheDir();
	const cachePath = getCachePath(chainId, address);
	writeFileSync(cachePath, JSON.stringify(abi, null, 2));
}

const ETHERSCAN_APIS: Record<number, string> = {
	1: 'https://api.etherscan.io/api',
	5: 'https://api-goerli.etherscan.io/api',
	11155111: 'https://api-sepolia.etherscan.io/api',
	137: 'https://api.polygonscan.com/api',
	80001: 'https://api-testnet.polygonscan.com/api',
	42161: 'https://api.arbiscan.io/api',
	421613: 'https://api-goerli.arbiscan.io/api',
	10: 'https://api-optimistic.etherscan.io/api',
	420: 'https://api-goerli-optimistic.etherscan.io/api',
	8453: 'https://api.basescan.org/api',
	84531: 'https://api-goerli.basescan.org/api',
	56: 'https://api.bscscan.com/api',
	97: 'https://api-testnet.bscscan.com/api',
	43114: 'https://api.snowtrace.io/api',
	43113: 'https://api-testnet.snowtrace.io/api',
};

async function fetchFromEtherscan(chainId: number, address: string): Promise<unknown[] | null> {
	const apiUrl = ETHERSCAN_APIS[chainId];
	if (!apiUrl) return null;

	const url = `${apiUrl}?module=contract&action=getabi&address=${address}`;

	try {
		const response = await fetch(url);
		const data = (await response.json()) as EtherscanResponse;

		if (data.status === '1' && data.result) {
			return JSON.parse(data.result);
		}
	} catch {
		return null;
	}

	return null;
}

async function fetchFromSourcify(chainId: number, address: string): Promise<unknown[] | null> {
	const urls = [
		`https://repo.sourcify.dev/contracts/full_match/${chainId}/${address}/metadata.json`,
		`https://repo.sourcify.dev/contracts/partial_match/${chainId}/${address}/metadata.json`,
	];

	for (const url of urls) {
		try {
			const response = await fetch(url);
			if (!response.ok) continue;

			const metadata = (await response.json()) as SourcifyMetadata;
			if (metadata.output?.abi) {
				return metadata.output.abi;
			}
		} catch {}
	}

	return null;
}

export async function fetchAbi(
	chainId: number,
	address: string,
	options: { useCache?: boolean } = {}
): Promise<unknown[] | null> {
	const useCache = options.useCache ?? true;

	if (useCache) {
		const cached = loadFromCache(chainId, address);
		if (cached) return cached;
	}

	let abi = await fetchFromEtherscan(chainId, address);

	if (!abi) {
		abi = await fetchFromSourcify(chainId, address);
	}

	if (abi && useCache) {
		saveToCache(chainId, address, abi);
	}

	return abi;
}

export async function abiFetchCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const ora = (await import('ora')).default;

	let chainId: number | undefined;
	let address: string | undefined;
	let outputPath: string | undefined;
	let noCache = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--chain' || arg === '-c') {
			const val = args[++i];
			chainId = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--output' || arg === '-o') {
			outputPath = args[++i];
		} else if (arg === '--no-cache') {
			noCache = true;
		} else if (arg === '--help' || arg === '-h') {
			printAbiFetchHelp();
			return;
		} else if (!arg.startsWith('-') && !address) {
			address = arg;
		}
	}

	if (!address) {
		console.error(pc.red('Error: address required'));
		printAbiFetchHelp();
		process.exit(1);
	}

	const config = loadConfig();
	chainId = chainId ?? config.defaultChain ?? 1;

	const spinner = ora({
		text: `Fetching ABI for ${address.slice(0, 12)}...`,
		color: 'cyan',
	}).start();

	try {
		const abi = await fetchAbi(chainId, address, { useCache: !noCache });

		if (!abi) {
			spinner.fail('ABI not found');
			console.error(pc.dim('Contract may not be verified on Etherscan or Sourcify.'));
			process.exit(1);
		}

		spinner.succeed(`ABI fetched (${abi.length} entries)`);

		if (outputPath) {
			const content = `export const ABI = ${JSON.stringify(abi, null, 2)} as const;\n`;
			writeFileSync(outputPath, content);
			console.log(pc.dim(`Saved to ${outputPath}`));
		} else {
			console.log('');
			console.log(JSON.stringify(abi, null, 2));
		}
	} catch (error) {
		spinner.fail('Failed to fetch ABI');
		console.error(pc.red((error as Error).message));
		process.exit(1);
	}
}

function printAbiFetchHelp(): void {
	console.log(`
${pc.bold('txray abi')} ${pc.dim('- Fetch ABI for verified contracts')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray abi')} ${pc.dim('<address> [options]')}

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}           Show this help message
  ${pc.cyan('--chain, -c')} ${pc.dim('<id>')}     Chain ID (default: 1)
  ${pc.cyan('--output, -o')} ${pc.dim('<file>')}  Save ABI to file as TypeScript
  ${pc.cyan('--no-cache')}           Skip cache and fetch fresh

${pc.yellow('SOURCES:')}
  ${pc.dim('1. Etherscan (and compatible explorers)')}
  ${pc.dim('2. Sourcify')}

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray abi 0x1234...abcd')}
  ${pc.dim('txray abi 0x1234...abcd --chain 137')}
  ${pc.dim('txray abi 0x1234...abcd --output ./abi/my-contract.ts')}

${pc.yellow('SUPPORTED CHAINS:')}
  ${pc.dim('Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche')}
  ${pc.dim('And their testnets')}
`);
}
