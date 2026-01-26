import pc from 'picocolors';
import { createPublicClient, decodeFunctionData, formatEther, type Hex, http } from 'viem';
import { ALL_ABIS } from './abis.js';
import { type DecodeContext, decodeWithPlugins, loadAllDecoders } from './decoder-registry.js';
import { type Labels, loadLabels } from './labels.js';
import { getNetworkByChainId, getRpcUrl } from './networks.js';
import { lookupSelector } from './selectors.js';

export interface DecodedCall {
	selector: string;
	functionName?: string;
	signature?: string;
	args: Array<{ name: string; type: string; value: unknown }>;
	nested?: DecodedCall[];
}

function formatValue(value: unknown, labels: Labels, indent: number): string {
	const pad = '  '.repeat(indent);

	if (typeof value === 'bigint') {
		const str = value.toString();
		if (value > 10n ** 15n && value < 10n ** 30n) {
			return `${pc.magenta(str)} ${pc.dim(`(${formatEther(value)} if 18 decimals)`)}`;
		}
		return pc.magenta(str);
	}

	if (typeof value === 'string') {
		if (value.startsWith('0x') && value.length === 42) {
			const label = labels[value.toLowerCase()];
			return label ? `${pc.white(value)} ${pc.yellow(`(${label})`)}` : pc.white(value);
		}
		if (value.startsWith('0x') && value.length > 10) {
			return pc.dim(`${value.slice(0, 20)}...${value.slice(-8)}`);
		}
		return pc.white(value);
	}

	if (typeof value === 'boolean') {
		return pc.cyan(String(value));
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return pc.dim('[]');
		if (value.length > 5) return pc.dim(`[${value.length} items]`);

		const items = value.map((v) => formatValue(v, labels, indent + 1));
		if (items.join(', ').length < 60) {
			return `[${items.join(', ')}]`;
		}
		return `[\n${items.map((i) => `${pad}  ${i}`).join(',\n')}\n${pad}]`;
	}

	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value);
		if (entries.length === 0) return pc.dim('{}');

		const formatted = entries.map(
			([k, v]) => `${pc.dim(`${k}:`)} ${formatValue(v, labels, indent + 1)}`
		);

		if (formatted.join(', ').length < 60) {
			return `{ ${formatted.join(', ')} }`;
		}
		return `{\n${formatted.map((f) => `${pad}  ${f}`).join(',\n')}\n${pad}}`;
	}

	return pc.white(String(value));
}

export function formatDecodedCall(decoded: DecodedCall, labels: Labels, indent = 0): string {
	const lines: string[] = [];
	const pad = '  '.repeat(indent);

	const header = decoded.functionName
		? `${pc.cyan(decoded.functionName)}${pc.dim(`(${decoded.selector})`)}`
		: pc.yellow(decoded.selector);

	lines.push(`${pad}${header}`);

	if (decoded.signature) {
		lines.push(`${pad}  ${pc.dim('sig:')} ${decoded.signature}`);
	}

	for (const arg of decoded.args) {
		const formattedValue = formatValue(arg.value, labels, indent + 1);
		lines.push(`${pad}  ${pc.dim(arg.name)} ${pc.dim(`(${arg.type}):`)} ${formattedValue}`);
	}

	if (decoded.nested && decoded.nested.length > 0) {
		lines.push(`${pad}  ${pc.dim('nested calls:')}`);
		for (const nested of decoded.nested) {
			lines.push(formatDecodedCall(nested, labels, indent + 2));
		}
	}

	return lines.join('\n');
}

function tryDecodeNested(data: Hex, labels: Labels): DecodedCall | null {
	if (data.length < 10) return null;

	try {
		const result = decodeFunctionData({
			abi: ALL_ABIS,
			data,
		});

		const abiItem = ALL_ABIS.find(
			(item) => item.type === 'function' && item.name === result.functionName
		);

		const args: DecodedCall['args'] = [];
		const resultArgs = result.args ?? [];

		if (abiItem && 'inputs' in abiItem && abiItem.inputs) {
			for (let i = 0; i < abiItem.inputs.length; i++) {
				const input = abiItem.inputs[i];
				args.push({
					name: input?.name ?? `arg${i}`,
					type: input?.type ?? 'unknown',
					value: resultArgs[i],
				});
			}
		} else {
			for (let i = 0; i < resultArgs.length; i++) {
				args.push({
					name: `arg${i}`,
					type: 'unknown',
					value: resultArgs[i],
				});
			}
		}

		return {
			selector: data.slice(0, 10),
			functionName: result.functionName,
			args,
			nested: detectNestedCalls(args, labels),
		};
	} catch {
		return null;
	}
}

function detectNestedCalls(args: DecodedCall['args'], labels: Labels): DecodedCall[] {
	const nested: DecodedCall[] = [];

	for (const arg of args) {
		if (typeof arg.value === 'string' && arg.value.startsWith('0x') && arg.value.length > 10) {
			const decoded = tryDecodeNested(arg.value as Hex, labels);
			if (decoded) {
				nested.push(decoded);
			}
		}

		if (Array.isArray(arg.value)) {
			for (const item of arg.value) {
				if (typeof item === 'string' && item.startsWith('0x') && item.length > 10) {
					const decoded = tryDecodeNested(item as Hex, labels);
					if (decoded) {
						nested.push(decoded);
					}
				}

				if (typeof item === 'object' && item !== null) {
					const obj = item as Record<string, unknown>;
					for (const val of Object.values(obj)) {
						if (typeof val === 'string' && val.startsWith('0x') && val.length > 10) {
							const decoded = tryDecodeNested(val as Hex, labels);
							if (decoded) {
								nested.push(decoded);
							}
						}
					}
				}
			}
		}
	}

	return nested;
}

export async function decodeCalldata(
	data: Hex,
	labels: Labels,
	context?: Partial<DecodeContext>
): Promise<DecodedCall> {
	const selector = data.slice(0, 10).toLowerCase();

	const pluginContext: DecodeContext = {
		labels,
		selector,
		address: context?.address,
		chainId: context?.chainId,
	};

	const pluginResult = decodeWithPlugins(data, pluginContext);
	if (pluginResult) {
		return {
			selector,
			functionName: pluginResult.name,
			args: pluginResult.params,
			nested: pluginResult.nested?.map((n) => ({
				selector: '',
				functionName: n.name,
				args: n.params,
			})),
		};
	}

	try {
		const result = decodeFunctionData({
			abi: ALL_ABIS,
			data,
		});

		const abiItem = ALL_ABIS.find(
			(item) => item.type === 'function' && item.name === result.functionName
		);

		const args: DecodedCall['args'] = [];
		const resultArgs = result.args ?? [];

		if (abiItem && 'inputs' in abiItem && abiItem.inputs) {
			for (let i = 0; i < abiItem.inputs.length; i++) {
				const input = abiItem.inputs[i];
				args.push({
					name: input?.name ?? `arg${i}`,
					type: input?.type ?? 'unknown',
					value: resultArgs[i],
				});
			}
		} else {
			for (let i = 0; i < resultArgs.length; i++) {
				args.push({
					name: `arg${i}`,
					type: 'unknown',
					value: resultArgs[i],
				});
			}
		}

		return {
			selector,
			functionName: result.functionName,
			args,
			nested: detectNestedCalls(args, labels),
		};
	} catch {
		const signatures = await lookupSelector(selector);
		const signature = signatures[signatures.length - 1];

		return {
			selector,
			signature,
			args: [{ name: 'data', type: 'bytes', value: data.slice(10) }],
		};
	}
}

export async function decodeCommand(args: string[]): Promise<void> {
	let data: Hex | undefined;
	let txHash: string | undefined;
	let chainId = 1;
	let labelsPath: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--tx' || arg === '-t') {
			txHash = args[++i];
		} else if (arg.startsWith('--tx=')) {
			txHash = arg.slice('--tx='.length);
		} else if (arg === '--chain' || arg === '-c') {
			const val = args[++i];
			chainId = val ? parseInt(val, 10) : 1;
		} else if (arg.startsWith('--chain=')) {
			chainId = parseInt(arg.slice('--chain='.length), 10);
		} else if (arg === '--labels' || arg === '-l') {
			labelsPath = args[++i];
		} else if (arg.startsWith('--labels=')) {
			labelsPath = arg.slice('--labels='.length);
		} else if (arg.startsWith('0x')) {
			data = arg as Hex;
		}
	}

	if (!data && !txHash) {
		console.log('Usage: txray decode <calldata>');
		console.log('       txray decode --tx <hash> [--chain <id>]');
		console.log('');
		console.log('Decode transaction calldata using loaded ABIs.');
		console.log('');
		console.log('Options:');
		console.log('  --tx, -t <hash>     Fetch calldata from transaction');
		console.log('  --chain, -c <id>    Chain ID for transaction lookup (default: 1)');
		console.log('  --labels, -l <path> Load custom address labels');
		console.log('');
		console.log('Examples:');
		console.log('  txray decode 0xa9059cbb000000000000000000000000...');
		console.log('  txray decode --tx 0xabc123... --chain 1');
		return;
	}

	const labels = loadLabels(labelsPath);

	await loadAllDecoders();

	if (txHash) {
		console.log(`Fetching transaction ${txHash.slice(0, 10)}...`);
		const network = getNetworkByChainId(chainId);
		const client = createPublicClient({ transport: http(getRpcUrl(network)) });

		try {
			const tx = await client.getTransaction({ hash: txHash as Hex });
			data = tx.input;
			console.log(`${pc.dim('To:')} ${tx.to ?? pc.dim('(contract creation)')}`);
			console.log('');
		} catch (error) {
			console.error(`${pc.red('Error:')} Failed to fetch transaction: ${(error as Error).message}`);
			process.exit(1);
		}
	}

	if (!data || data.length < 10) {
		console.error(pc.red('Invalid calldata. Must be at least 10 characters (4-byte selector).'));
		process.exit(1);
	}

	console.log(pc.bold('Decoded Calldata:'));
	console.log(pc.dim('─'.repeat(50)));

	const decoded = await decodeCalldata(data, labels, { chainId });
	console.log(formatDecodedCall(decoded, labels));
}
