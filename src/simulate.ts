import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { createPublicClient, http, parseEther } from 'viem';
import { DEFAULT_TIMEOUT_MS } from './constants.js';
import { getRpcUrl } from './networks.js';

export interface SimulateOptions {
	from?: `0x${string}`;
	to?: `0x${string}`;
	data?: `0x${string}`;
	value?: string;
	gas?: bigint;
	timeout?: number;
	labelsPath?: string;
	stateOverrides?: Record<string, StateOverride>;
}

export interface StateOverride {
	balance?: string;
	nonce?: number;
	code?: `0x${string}`;
	state?: Record<string, string>;
}

export interface SimulateResult {
	success: boolean;
	returnData: string;
	gasUsed?: bigint;
	error?: string;
}

export async function simulateTransaction(
	network: NetworkConfig,
	options: SimulateOptions
): Promise<SimulateResult> {
	const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const callParams: {
		account?: `0x${string}`;
		to?: `0x${string}`;
		data?: `0x${string}`;
		value?: bigint;
		gas?: bigint;
	} = {};

	if (options.from) callParams.account = options.from;
	if (options.to) callParams.to = options.to;
	if (options.data) callParams.data = options.data;
	if (options.value) callParams.value = parseEther(options.value);
	if (options.gas) callParams.gas = options.gas;

	try {
		const result = await client.call(callParams as never);

		return {
			success: true,
			returnData: result.data ?? '0x',
		};
	} catch (error) {
		const err = error as Error;
		return {
			success: false,
			returnData: '0x',
			error: err.message,
		};
	}
}

export function formatSimulateResult(result: SimulateResult): string {
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('SIMULATION RESULT'));
	lines.push(hr);
	lines.push('');

	if (result.success) {
		lines.push(`${pc.dim('Status:')}  ${pc.green('Success')}`);
		lines.push(`${pc.dim('Return:')}  ${pc.cyan(result.returnData)}`);
	} else {
		lines.push(`${pc.dim('Status:')}  ${pc.red('Failed')}`);
		if (result.error) {
			lines.push(`${pc.dim('Error:')}   ${pc.red(result.error)}`);
		}
	}

	if (result.gasUsed) {
		lines.push(`${pc.dim('Gas:')}     ${pc.yellow(result.gasUsed.toLocaleString())}`);
	}

	lines.push('');
	lines.push(hr);

	return lines.join('\n');
}

export async function simulateCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId } = await import('./networks.js');
	const ora = (await import('ora')).default;

	const options: SimulateOptions = {};
	let chainId: number | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--from' || arg === '-f') {
			options.from = args[++i] as `0x${string}`;
		} else if (arg === '--to') {
			options.to = args[++i] as `0x${string}`;
		} else if (arg === '--data' || arg === '-d') {
			options.data = args[++i] as `0x${string}`;
		} else if (arg === '--value' || arg === '-v') {
			options.value = args[++i];
		} else if (arg === '--gas' || arg === '-g') {
			const val = args[++i];
			options.gas = val ? BigInt(val) : undefined;
		} else if (arg === '--chain' || arg === '-c') {
			const val = args[++i];
			chainId = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--help' || arg === '-h') {
			printSimulateHelp();
			return;
		}
	}

	if (!options.to && !options.data) {
		console.error(pc.red('Error: --to or --data required'));
		printSimulateHelp();
		process.exit(1);
	}

	const config = loadConfig();
	chainId = chainId ?? config.defaultChain ?? 1;
	const network = getNetworkByChainId(chainId);

	const spinner = ora({
		text: 'Simulating transaction...',
		color: 'cyan',
	}).start();

	try {
		const result = await simulateTransaction(network, options);
		spinner.succeed('Simulation complete');
		console.log('');
		console.log(formatSimulateResult(result));
	} catch (error) {
		spinner.fail('Simulation failed');
		console.error(pc.red((error as Error).message));
		process.exit(1);
	}
}

function printSimulateHelp(): void {
	console.log(`
${pc.bold('txray simulate')} ${pc.dim('- Simulate a transaction using eth_call')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray simulate')} ${pc.dim('[options]')}

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}           Show this help message
  ${pc.cyan('--from, -f')} ${pc.dim('<addr>')}    Sender address
  ${pc.cyan('--to')} ${pc.dim('<addr>')}          Target address
  ${pc.cyan('--data, -d')} ${pc.dim('<hex>')}     Calldata (hex)
  ${pc.cyan('--value, -v')} ${pc.dim('<eth>')}    Value in ETH
  ${pc.cyan('--gas, -g')} ${pc.dim('<amount>')}   Gas limit
  ${pc.cyan('--chain, -c')} ${pc.dim('<id>')}     Chain ID (default: 1)
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}   Request timeout

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray simulate --to 0x1234...abcd --data 0xa9059cbb...')}
  ${pc.dim('txray simulate --from 0x1234... --to 0x5678... --value 1.5')}
  ${pc.dim('txray simulate --to 0x1234... --data 0x... --chain 137')}
`);
}
