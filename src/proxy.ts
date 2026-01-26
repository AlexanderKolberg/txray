import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { createPublicClient, http } from 'viem';
import { DEFAULT_TIMEOUT_MS } from './constants.js';
import { getRpcUrl } from './networks.js';

const EIP1967_IMPLEMENTATION_SLOT =
	'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const EIP1967_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

const EIP1822_LOGIC_SLOT = '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7';

const OPENZEPPELIN_IMPLEMENTATION_SLOT =
	'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';

export type ProxyType = 'EIP1967' | 'EIP1822' | 'OpenZeppelin' | 'Beacon' | 'Unknown' | 'None';

export interface ProxyInfo {
	isProxy: boolean;
	proxyType: ProxyType;
	implementationAddress?: string;
	beaconAddress?: string;
	adminAddress?: string;
}

async function readStorageSlot(
	client: ReturnType<typeof createPublicClient>,
	address: `0x${string}`,
	slot: `0x${string}`
): Promise<string | null> {
	try {
		const value = await client.getStorageAt({ address, slot });
		if (!value || value === '0x0000000000000000000000000000000000000000000000000000000000000000') {
			return null;
		}
		return `0x${value.slice(26)}`;
	} catch {
		return null;
	}
}

export async function detectProxy(
	network: NetworkConfig,
	address: `0x${string}`,
	options: { timeout?: number } = {}
): Promise<ProxyInfo> {
	const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const [eip1967Impl, eip1967Beacon, eip1967Admin, eip1822Logic, ozImpl] = await Promise.all([
		readStorageSlot(client, address, EIP1967_IMPLEMENTATION_SLOT),
		readStorageSlot(client, address, EIP1967_BEACON_SLOT),
		readStorageSlot(client, address, EIP1967_ADMIN_SLOT),
		readStorageSlot(client, address, EIP1822_LOGIC_SLOT),
		readStorageSlot(client, address, OPENZEPPELIN_IMPLEMENTATION_SLOT),
	]);

	if (eip1967Impl) {
		return {
			isProxy: true,
			proxyType: 'EIP1967',
			implementationAddress: eip1967Impl,
			adminAddress: eip1967Admin ?? undefined,
		};
	}

	if (eip1967Beacon) {
		const beaconClient = createPublicClient({
			transport: http(getRpcUrl(network), { timeout }),
		});
		const beaconImpl = await readStorageSlot(
			beaconClient,
			eip1967Beacon as `0x${string}`,
			EIP1967_IMPLEMENTATION_SLOT
		);

		return {
			isProxy: true,
			proxyType: 'Beacon',
			beaconAddress: eip1967Beacon,
			implementationAddress: beaconImpl ?? undefined,
			adminAddress: eip1967Admin ?? undefined,
		};
	}

	if (eip1822Logic) {
		return {
			isProxy: true,
			proxyType: 'EIP1822',
			implementationAddress: eip1822Logic,
		};
	}

	if (ozImpl) {
		return {
			isProxy: true,
			proxyType: 'OpenZeppelin',
			implementationAddress: ozImpl,
		};
	}

	return {
		isProxy: false,
		proxyType: 'None',
	};
}

export function formatProxyInfo(info: ProxyInfo): string {
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('PROXY DETECTION'));
	lines.push(hr);
	lines.push('');

	if (!info.isProxy) {
		lines.push(`${pc.dim('Status:')} ${pc.yellow('Not a proxy (or unknown pattern)')}`);
	} else {
		lines.push(`${pc.dim('Status:')}         ${pc.green('Proxy detected')}`);
		lines.push(`${pc.dim('Type:')}           ${pc.cyan(info.proxyType)}`);

		if (info.implementationAddress) {
			lines.push(`${pc.dim('Implementation:')} ${pc.white(info.implementationAddress)}`);
		}

		if (info.beaconAddress) {
			lines.push(`${pc.dim('Beacon:')}         ${pc.white(info.beaconAddress)}`);
		}

		if (info.adminAddress) {
			lines.push(`${pc.dim('Admin:')}          ${pc.white(info.adminAddress)}`);
		}
	}

	lines.push('');
	lines.push(hr);

	return lines.join('\n');
}

export async function proxyCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId } = await import('./networks.js');
	const ora = (await import('ora')).default;

	let chainId: number | undefined;
	let address: string | undefined;
	let timeout: number | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--chain' || arg === '-c') {
			const val = args[++i];
			chainId = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--help' || arg === '-h') {
			printProxyHelp();
			return;
		} else if (!arg.startsWith('-') && !address) {
			address = arg;
		}
	}

	if (!address || !address.startsWith('0x')) {
		console.error(pc.red('Error: valid address required'));
		printProxyHelp();
		process.exit(1);
	}

	const config = loadConfig();
	chainId = chainId ?? config.defaultChain ?? 1;
	const network = getNetworkByChainId(chainId);

	const spinner = ora({
		text: `Detecting proxy for ${address.slice(0, 12)}...`,
		color: 'cyan',
	}).start();

	try {
		const info = await detectProxy(network, address as `0x${string}`, { timeout });
		spinner.succeed('Detection complete');
		console.log('');
		console.log(formatProxyInfo(info));
	} catch (error) {
		spinner.fail('Detection failed');
		console.error(pc.red((error as Error).message));
		process.exit(1);
	}
}

function printProxyHelp(): void {
	console.log(`
${pc.bold('txray proxy')} ${pc.dim('- Detect proxy contract patterns')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray proxy')} ${pc.dim('<address> [options]')}

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}           Show this help message
  ${pc.cyan('--chain, -c')} ${pc.dim('<id>')}     Chain ID (default: 1)
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}   Request timeout

${pc.yellow('DETECTED PATTERNS:')}
  ${pc.dim('- EIP-1967 (Transparent Proxy)')}
  ${pc.dim('- EIP-1822 (UUPS)')}
  ${pc.dim('- OpenZeppelin (Legacy)')}
  ${pc.dim('- Beacon Proxy')}

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray proxy 0x1234...abcd')}
  ${pc.dim('txray proxy 0x1234...abcd --chain 137')}
`);
}
