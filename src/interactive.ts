import { createInterface } from 'node:readline';
import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { loadLabels } from './labels.js';
import { type TraceCall, traceTransaction } from './trace.js';

export interface InteractiveOptions {
	labelsPath?: string;
	timeout?: number;
}

interface TraceState {
	trace: TraceCall;
	path: number[];
	labels: Record<string, string>;
}

function getCurrentCall(trace: TraceCall, path: number[]): TraceCall {
	let current = trace;
	for (const idx of path) {
		if (!current.calls || !current.calls[idx]) {
			return current;
		}
		current = current.calls[idx];
	}
	return current;
}

function printCall(call: TraceCall, labels: Record<string, string>, depth: number = 0): void {
	const indent = '  '.repeat(depth);
	const toLabel = labels[call.to?.toLowerCase() ?? ''];
	const toDisplay = toLabel ? `${call.to?.slice(0, 12)}... (${toLabel})` : (call.to ?? '(create)');

	console.log(`${indent}${pc.cyan(call.type)} → ${pc.white(toDisplay)}`);

	if (call.gasUsed) {
		console.log(`${indent}  ${pc.dim('Gas:')} ${pc.yellow(Number(call.gasUsed).toLocaleString())}`);
	}

	if (call.value && call.value !== '0x0') {
		console.log(`${indent}  ${pc.dim('Value:')} ${pc.magenta(call.value)}`);
	}

	if (call.input && call.input.length > 2) {
		const selector = call.input.slice(0, 10);
		console.log(
			`${indent}  ${pc.dim('Input:')} ${pc.cyan(selector)}... (${(call.input.length - 2) / 2} bytes)`
		);
	}

	if (call.output && call.output.length > 2) {
		console.log(`${indent}  ${pc.dim('Output:')} ${call.output.slice(0, 66)}...`);
	}

	if (call.error) {
		console.log(`${indent}  ${pc.red('Error:')} ${call.error}`);
	}

	if (call.revertReason) {
		console.log(`${indent}  ${pc.red('Revert:')} ${call.revertReason}`);
	}
}

function printChildren(call: TraceCall, labels: Record<string, string>): void {
	if (!call.calls || call.calls.length === 0) {
		console.log(pc.dim('  No child calls'));
		return;
	}

	console.log(`\n${pc.bold('Child Calls:')} (${call.calls.length})\n`);

	for (let i = 0; i < call.calls.length; i++) {
		const child = call.calls[i];
		if (!child) continue;

		const toLabel = labels[child.to?.toLowerCase() ?? ''];
		const toDisplay = toLabel
			? `${child.to?.slice(0, 10)}... (${toLabel})`
			: (child.to?.slice(0, 14) ?? '(create)');
		const status = child.error ? pc.red('✗') : pc.green('✓');

		console.log(`  ${pc.dim(`[${i}]`)} ${status} ${pc.cyan(child.type)} → ${pc.white(toDisplay)}`);
	}
}

function printHelp(): void {
	console.log(`
${pc.bold('Commands:')}
  ${pc.cyan('n, next')}       Go to next sibling call
  ${pc.cyan('p, prev')}       Go to previous sibling call
  ${pc.cyan('d, down')} ${pc.dim('<n>')}   Enter child call n (default: 0)
  ${pc.cyan('u, up')}         Go back to parent call
  ${pc.cyan('r, root')}       Go back to root call
  ${pc.cyan('c, children')}   List child calls
  ${pc.cyan('i, info')}       Show full call details
  ${pc.cyan('h, help')}       Show this help
  ${pc.cyan('q, quit')}       Exit interactive mode
`);
}

export async function interactiveDebug(
	network: NetworkConfig,
	txHash: `0x${string}`,
	options: InteractiveOptions = {}
): Promise<void> {
	const labels = loadLabels(options.labelsPath);

	console.log(pc.dim('Fetching trace...'));

	const traceResult = await traceTransaction(network, txHash, {
		labelsPath: options.labelsPath,
		timeout: options.timeout,
	});

	const state: TraceState = {
		trace: traceResult.root,
		path: [],
		labels,
	};

	console.clear();
	console.log(pc.bold('Interactive Trace Debugger'));
	console.log(pc.dim(`Tx: ${txHash}`));
	console.log(pc.dim('Type "help" for commands\n'));

	printCall(getCurrentCall(state.trace, state.path), labels);

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const prompt = (): void => {
		const pathStr = state.path.length > 0 ? `[${state.path.join('.')}]` : '[root]';
		rl.question(`${pc.cyan(pathStr)} > `, (input) => {
			const [cmd, arg] = input.trim().split(/\s+/);

			switch (cmd?.toLowerCase()) {
				case 'q':
				case 'quit':
				case 'exit':
					rl.close();
					return;

				case 'h':
				case 'help':
					printHelp();
					break;

				case 'i':
				case 'info':
					console.log('');
					printCall(getCurrentCall(state.trace, state.path), labels, 0);
					console.log('');
					break;

				case 'c':
				case 'children':
					printChildren(getCurrentCall(state.trace, state.path), labels);
					break;

				case 'd':
				case 'down':
				case 'enter': {
					const idx = arg ? Number.parseInt(arg, 10) : 0;
					const current = getCurrentCall(state.trace, state.path);
					if (current.calls?.[idx]) {
						state.path.push(idx);
						console.log('');
						printCall(getCurrentCall(state.trace, state.path), labels);
					} else {
						console.log(pc.red(`No child call at index ${idx}`));
					}
					break;
				}

				case 'u':
				case 'up':
				case 'back':
					if (state.path.length > 0) {
						state.path.pop();
						console.log('');
						printCall(getCurrentCall(state.trace, state.path), labels);
					} else {
						console.log(pc.dim('Already at root'));
					}
					break;

				case 'r':
				case 'root':
					state.path = [];
					console.log('');
					printCall(getCurrentCall(state.trace, state.path), labels);
					break;

				case 'n':
				case 'next': {
					if (state.path.length === 0) {
						console.log(pc.dim('No siblings at root'));
						break;
					}
					const parentPath = state.path.slice(0, -1);
					const parent = getCurrentCall(state.trace, parentPath);
					const currentIdx = state.path[state.path.length - 1] ?? 0;
					if (parent.calls && currentIdx < parent.calls.length - 1) {
						state.path[state.path.length - 1] = currentIdx + 1;
						console.log('');
						printCall(getCurrentCall(state.trace, state.path), labels);
					} else {
						console.log(pc.dim('No more siblings'));
					}
					break;
				}

				case 'p':
				case 'prev': {
					if (state.path.length === 0) {
						console.log(pc.dim('No siblings at root'));
						break;
					}
					const currentIdx = state.path[state.path.length - 1] ?? 0;
					if (currentIdx > 0) {
						state.path[state.path.length - 1] = currentIdx - 1;
						console.log('');
						printCall(getCurrentCall(state.trace, state.path), labels);
					} else {
						console.log(pc.dim('At first sibling'));
					}
					break;
				}

				default:
					if (cmd) {
						console.log(pc.red(`Unknown command: ${cmd}`));
					}
			}

			prompt();
		});
	};

	prompt();
}

export async function interactiveCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId, parseExplorerUrl } = await import('./networks.js');

	const options: InteractiveOptions = {};
	const positional: string[] = [];
	let chainId: number | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--chain' || arg === '-c') {
			const val = args[++i];
			chainId = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--help' || arg === '-h') {
			printInteractiveHelp();
			return;
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	const input = positional[0];
	if (!input) {
		console.error(pc.red('Error: transaction hash or URL required'));
		printInteractiveHelp();
		process.exit(1);
	}

	let txHash: `0x${string}`;

	if (input.startsWith('http')) {
		const parsed = parseExplorerUrl(input);
		txHash = parsed.txHash;
		chainId = chainId ?? parsed.chainId;
	} else if (input.startsWith('0x')) {
		const config = loadConfig();
		txHash = input.toLowerCase() as `0x${string}`;
		chainId =
			(chainId ?? positional[1])
				? Number.parseInt(positional[1] ?? '', 10)
				: (config.defaultChain ?? 1);
	} else {
		console.error(pc.red('Invalid input'));
		process.exit(1);
	}

	const network = getNetworkByChainId(chainId ?? 1);
	await interactiveDebug(network, txHash, options);
}

function printInteractiveHelp(): void {
	console.log(`
${pc.bold('txray debug')} ${pc.dim('- Interactive trace debugger')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray debug')} ${pc.dim('<tx-url-or-hash> [chain-id] [options]')}

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}           Show this help message
  ${pc.cyan('--chain, -c')} ${pc.dim('<id>')}     Chain ID
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}   Request timeout
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}  Load address labels

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray debug https://etherscan.io/tx/0x123...')}
  ${pc.dim('txray debug 0x123... 1')}

${pc.yellow('NOTE:')}
  ${pc.dim('Requires an RPC that supports debug_traceTransaction.')}
`);
}
