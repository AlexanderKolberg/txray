import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { loadLabels } from './labels.js';
import { type TraceCall, traceTransaction } from './trace.js';

export interface GasConsumer {
	address: string;
	label?: string;
	gasUsed: bigint;
	callCount: number;
	percentage: number;
}

export interface GasAnalysisResult {
	txHash: string;
	totalGas: bigint;
	topConsumers: GasConsumer[];
	byCallType: Record<string, { count: number; gas: bigint }>;
	maxDepth: number;
}

export interface GasAnalysisOptions {
	labelsPath?: string;
	timeout?: number;
	topN?: number;
}

export async function analyzeGas(
	network: NetworkConfig,
	txHash: `0x${string}`,
	options: GasAnalysisOptions = {}
): Promise<GasAnalysisResult> {
	const traceResult = await traceTransaction(network, txHash, {
		labelsPath: options.labelsPath,
		timeout: options.timeout,
	});

	const labels = loadLabels(options.labelsPath);
	const topN = options.topN ?? 10;

	const gasMap = new Map<string, { gasUsed: bigint; callCount: number }>();
	const callTypeMap = new Map<string, { count: number; gas: bigint }>();
	let maxDepth = 0;

	function processCall(call: TraceCall, depth: number): void {
		maxDepth = Math.max(maxDepth, depth);

		const address = call.to?.toLowerCase() ?? 'contract-creation';
		const gasUsed = call.gasUsed ? BigInt(call.gasUsed) : 0n;

		const existing = gasMap.get(address) ?? { gasUsed: 0n, callCount: 0 };
		gasMap.set(address, {
			gasUsed: existing.gasUsed + gasUsed,
			callCount: existing.callCount + 1,
		});

		const callType = call.type.toUpperCase();
		const typeStats = callTypeMap.get(callType) ?? { count: 0, gas: 0n };
		callTypeMap.set(callType, {
			count: typeStats.count + 1,
			gas: typeStats.gas + gasUsed,
		});

		if (call.calls) {
			for (const child of call.calls) {
				processCall(child, depth + 1);
			}
		}
	}

	processCall(traceResult.root, 0);

	const totalGas = traceResult.totalGas;

	const consumers: GasConsumer[] = Array.from(gasMap.entries())
		.map(([address, stats]) => ({
			address,
			label: labels[address],
			gasUsed: stats.gasUsed,
			callCount: stats.callCount,
			percentage: totalGas > 0n ? Number((stats.gasUsed * 10000n) / totalGas) / 100 : 0,
		}))
		.sort((a, b) => (b.gasUsed > a.gasUsed ? 1 : -1))
		.slice(0, topN);

	const byCallType: Record<string, { count: number; gas: bigint }> = {};
	for (const [type, stats] of callTypeMap) {
		byCallType[type] = stats;
	}

	return {
		txHash,
		totalGas,
		topConsumers: consumers,
		byCallType,
		maxDepth,
	};
}

export function formatGasAnalysis(result: GasAnalysisResult): string {
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('GAS ANALYSIS'));
	lines.push(hr);
	lines.push('');
	lines.push(`${pc.dim('Tx:')}        ${result.txHash.slice(0, 18)}...`);
	lines.push(`${pc.dim('Total Gas:')} ${pc.yellow(result.totalGas.toLocaleString())}`);
	lines.push(`${pc.dim('Max Depth:')} ${pc.cyan(String(result.maxDepth))}`);
	lines.push('');

	lines.push(hr);
	lines.push(pc.bold('BY CALL TYPE'));
	lines.push(hr);
	lines.push('');

	const sortedTypes = Object.entries(result.byCallType).sort(([, a], [, b]) =>
		b.gas > a.gas ? 1 : -1
	);

	for (const [type, stats] of sortedTypes) {
		const percentage =
			result.totalGas > 0n ? Number((stats.gas * 10000n) / result.totalGas) / 100 : 0;
		const bar = createBar(percentage, 20);
		lines.push(
			`  ${pc.cyan(type.padEnd(12))} ${pc.white(stats.count.toString().padStart(5))} calls  ${pc.yellow(stats.gas.toLocaleString().padStart(12))} gas  ${bar} ${pc.dim(`${percentage.toFixed(1)}%`)}`
		);
	}
	lines.push('');

	lines.push(hr);
	lines.push(pc.bold('TOP GAS CONSUMERS'));
	lines.push(hr);
	lines.push('');

	for (let i = 0; i < result.topConsumers.length; i++) {
		const consumer = result.topConsumers[i];
		if (!consumer) continue;

		const rank = `#${(i + 1).toString().padStart(2)}`;
		const bar = createBar(consumer.percentage, 20);
		const addressDisplay = consumer.label
			? `${consumer.address.slice(0, 12)}... ${pc.yellow(`(${consumer.label})`)}`
			: `${consumer.address.slice(0, 20)}...`;

		lines.push(
			`${pc.dim(rank)} ${pc.white(addressDisplay.padEnd(42))} ${pc.yellow(consumer.gasUsed.toLocaleString().padStart(12))} ${bar} ${pc.dim(`${consumer.percentage.toFixed(1)}%`)} ${pc.dim(`(${consumer.callCount} calls)`)}`
		);
	}
	lines.push('');
	lines.push(hr);

	return lines.join('\n');
}

function createBar(percentage: number, width: number): string {
	const filled = Math.round((percentage / 100) * width);
	const empty = width - filled;
	return pc.green('█'.repeat(filled)) + pc.dim('░'.repeat(empty));
}

export async function gasCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId, parseExplorerUrl } = await import('./networks.js');
	const ora = (await import('ora')).default;

	const options: GasAnalysisOptions = {};
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--top' || arg === '-n') {
			const val = args[++i];
			options.topN = val ? Number.parseInt(val, 10) : 10;
		} else if (arg === '--help' || arg === '-h') {
			printGasHelp();
			return;
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	const input = positional[0];
	if (!input) {
		console.error(pc.red('Error: transaction hash or URL required'));
		printGasHelp();
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

	const spinner = ora({
		text: `Analyzing gas for ${txHash.slice(0, 10)}...`,
		color: 'cyan',
	}).start();

	try {
		const result = await analyzeGas(network, txHash, options);
		spinner.succeed('Gas analysis complete');
		console.log('');
		console.log(formatGasAnalysis(result));
	} catch (error) {
		const err = error as Error;
		spinner.fail('Gas analysis failed');
		console.error(pc.red(err.message));
		console.error(pc.dim('Note: Gas analysis requires call tracing (archive node).'));
		process.exit(1);
	}
}

function printGasHelp(): void {
	console.log(`
${pc.bold('txray gas')} ${pc.dim('- Analyze gas usage breakdown')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray gas')} ${pc.dim('<tx-url-or-hash> [chain-id] [options]')}

${pc.yellow('ARGUMENTS:')}
  ${pc.cyan('<tx>')}                  Transaction URL or hash
  ${pc.cyan('[chain-id]')}            Chain ID (default: 1, or from config)

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}            Show this help message
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}    Request timeout in milliseconds
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}   Load address labels from a JSON file
  ${pc.cyan('--top, -n')} ${pc.dim('<count>')}     Number of top consumers to show (default: 10)

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray gas https://etherscan.io/tx/0x123...')}
  ${pc.dim('txray gas 0x123... 1')}
  ${pc.dim('txray gas 0x123... --top 20')}

${pc.yellow('OUTPUT INCLUDES:')}
  ${pc.dim('- Gas breakdown by call type (CALL, STATICCALL, etc.)')}
  ${pc.dim('- Top gas-consuming contracts')}
  ${pc.dim('- Visual bar charts showing gas distribution')}
  ${pc.dim('- Call depth statistics')}

${pc.yellow('NOTE:')}
  ${pc.dim('Requires an RPC that supports debug_traceTransaction.')}
`);
}
