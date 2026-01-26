import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { createPublicClient, http } from 'viem';
import { type Labels, loadLabels } from './labels.js';
import { getRpcUrl } from './networks.js';

export interface TraceCall {
	type: string;
	from: string;
	to: string;
	value?: string;
	gas?: string;
	gasUsed?: string;
	input?: string;
	output?: string;
	error?: string;
	revertReason?: string;
	calls?: TraceCall[];
}

export interface TraceResult {
	txHash: string;
	root: TraceCall;
	totalCalls: number;
	totalGas: bigint;
	hasErrors: boolean;
}

export interface TraceOptions {
	labelsPath?: string;
	timeout?: number;
}

export async function traceTransaction(
	network: NetworkConfig,
	txHash: `0x${string}`,
	options: TraceOptions = {}
): Promise<TraceResult> {
	const timeout = options.timeout ?? 30000;

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const trace = (await client.request({
		method: 'debug_traceTransaction' as never,
		params: [txHash, { tracer: 'callTracer' }] as never,
	})) as TraceCall;

	const stats = calculateStats(trace);

	return {
		txHash,
		root: trace,
		totalCalls: stats.totalCalls,
		totalGas: stats.totalGas,
		hasErrors: stats.hasErrors,
	};
}

interface TraceStats {
	totalCalls: number;
	totalGas: bigint;
	hasErrors: boolean;
}

function calculateStats(call: TraceCall): TraceStats {
	let totalCalls = 1;
	let totalGas = call.gasUsed ? BigInt(call.gasUsed) : 0n;
	let hasErrors = !!call.error;

	if (call.calls) {
		for (const child of call.calls) {
			const childStats = calculateStats(child);
			totalCalls += childStats.totalCalls;
			totalGas += childStats.totalGas;
			hasErrors = hasErrors || childStats.hasErrors;
		}
	}

	return { totalCalls, totalGas, hasErrors };
}

export function formatTrace(result: TraceResult, labels: Labels): string {
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('CALL TRACE'));
	lines.push(hr);
	lines.push('');
	lines.push(`${pc.dim('Tx:')}         ${result.txHash.slice(0, 18)}...`);
	lines.push(`${pc.dim('Total Calls:')} ${pc.cyan(String(result.totalCalls))}`);
	lines.push(`${pc.dim('Total Gas:')}   ${pc.yellow(result.totalGas.toLocaleString())}`);
	if (result.hasErrors) {
		lines.push(`${pc.dim('Status:')}      ${pc.red('Has Errors')}`);
	}
	lines.push('');
	lines.push(hr);
	lines.push('');

	formatCallTree(result.root, labels, lines, 0);

	lines.push('');
	lines.push(hr);

	return lines.join('\n');
}

function formatCallTree(call: TraceCall, labels: Labels, lines: string[], depth: number): void {
	const indent = '  '.repeat(depth);
	const prefix = depth > 0 ? `${indent}${pc.dim('├─')} ` : '';

	const typeColor = getTypeColor(call.type);
	const toLabel = labels[call.to?.toLowerCase() ?? ''];
	const toDisplay = toLabel
		? `${call.to?.slice(0, 10)}... ${pc.yellow(`(${toLabel})`)}`
		: (call.to ?? '(create)');

	const gasStr = call.gasUsed ? pc.dim(` [${Number(call.gasUsed).toLocaleString()} gas]`) : '';
	const errorStr = call.error ? pc.red(` ✗ ${call.error}`) : '';
	const valueStr =
		call.value && call.value !== '0x0' ? pc.magenta(` +${formatHexValue(call.value)}`) : '';

	lines.push(
		`${prefix}${typeColor(call.type)} ${pc.white(toDisplay)}${valueStr}${gasStr}${errorStr}`
	);

	if (call.input && call.input.length > 10) {
		const selector = call.input.slice(0, 10);
		lines.push(`${indent}  ${pc.dim('input:')} ${pc.cyan(selector)}${pc.dim('...')}`);
	}

	if (call.revertReason) {
		lines.push(`${indent}  ${pc.dim('revert:')} ${pc.red(call.revertReason)}`);
	}

	if (call.calls) {
		for (const child of call.calls) {
			formatCallTree(child, labels, lines, depth + 1);
		}
	}
}

function getTypeColor(type: string): (s: string) => string {
	switch (type.toUpperCase()) {
		case 'CALL':
			return pc.green;
		case 'STATICCALL':
			return pc.blue;
		case 'DELEGATECALL':
			return pc.yellow;
		case 'CREATE':
		case 'CREATE2':
			return pc.magenta;
		default:
			return pc.white;
	}
}

function formatHexValue(hex: string): string {
	const value = BigInt(hex);
	if (value === 0n) return '0';
	if (value < 10n ** 12n) return value.toString();
	const eth = Number(value) / 1e18;
	return `${eth.toFixed(4)} ETH`;
}

export function isTracingSupported(error: Error): boolean {
	const message = error.message.toLowerCase();
	return !(
		message.includes('method not found') ||
		message.includes('not supported') ||
		message.includes('debug_tracetransaction') ||
		message.includes('unsupported method')
	);
}

export async function traceCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId, parseExplorerUrl } = await import('./networks.js');
	const ora = (await import('ora')).default;

	const options: TraceOptions = {};
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--help' || arg === '-h') {
			printTraceHelp();
			return;
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	const input = positional[0];
	if (!input) {
		console.error(pc.red('Error: transaction hash or URL required'));
		printTraceHelp();
		process.exit(1);
	}

	let txHash: `0x${string}`;
	let chainId: number;

	if (input.startsWith('http')) {
		const parsed = parseExplorerUrl(input);
		txHash = parsed.txHash;
		chainId = parsed.chainId;
	} else if (input.startsWith('0x')) {
		const config = loadConfig();
		txHash = input.toLowerCase() as `0x${string}`;
		const chainArg = positional[1];
		chainId = chainArg ? Number.parseInt(chainArg, 10) : (config.defaultChain ?? 1);
	} else {
		console.error(pc.red('Invalid input. Provide a block explorer URL or tx hash.'));
		process.exit(1);
	}

	const network = getNetworkByChainId(chainId);
	const labels = loadLabels(options.labelsPath);

	const spinner = ora({
		text: `Tracing ${txHash.slice(0, 10)}...`,
		color: 'cyan',
	}).start();

	try {
		const result = await traceTransaction(network, txHash, options);
		spinner.succeed('Trace complete');
		console.log('');
		console.log(formatTrace(result, labels));
	} catch (error) {
		const err = error as Error;
		if (!isTracingSupported(err)) {
			spinner.fail('Tracing not supported by this RPC');
			console.error(pc.dim('This RPC node does not support debug_traceTransaction.'));
			console.error(
				pc.dim('Try using an archive node or a service like Alchemy/Infura with tracing enabled.')
			);
		} else {
			spinner.fail('Trace failed');
			console.error(pc.red(err.message));
		}
		process.exit(1);
	}
}

function printTraceHelp(): void {
	console.log(`
${pc.bold('txray trace')} ${pc.dim('- Get call trace for a transaction')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray trace')} ${pc.dim('<tx-url-or-hash> [chain-id] [options]')}

${pc.yellow('ARGUMENTS:')}
  ${pc.cyan('<tx>')}                  Transaction URL or hash
  ${pc.cyan('[chain-id]')}            Chain ID (default: 1, or from config)

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}            Show this help message
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}    Request timeout in milliseconds
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}   Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray trace https://etherscan.io/tx/0x123...')}
  ${pc.dim('txray trace 0x123... 1')}
  ${pc.dim('txray trace 0x123... --labels ./my-labels.json')}

${pc.yellow('NOTE:')}
  ${pc.dim('Requires an RPC that supports debug_traceTransaction (archive node).')}
  ${pc.dim('Many public RPCs do not support tracing.')}
`);
}
