import pc from 'picocolors';
import { loadConfig } from './config.js';
import { type DebugResult, debugTransaction } from './debug.js';
import { getNetworkByChainId, parseExplorerUrl } from './networks.js';

interface DiffOptions {
	labelsPath?: string;
	timeout?: number;
	format: 'side-by-side' | 'unified';
}

interface FieldDiff {
	field: string;
	left: string;
	right: string;
	changed: boolean;
}

interface LogDiff {
	index: number;
	eventName: string;
	left?: LogSummary;
	right?: LogSummary;
	status: 'added' | 'removed' | 'changed' | 'same';
	fieldDiffs?: FieldDiff[];
}

interface LogSummary {
	address: string;
	addressLabel?: string;
	eventName?: string;
	decoded?: Record<string, unknown>;
}

export async function diffCommand(args: string[]): Promise<void> {
	const options: DiffOptions = { format: 'unified' };
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--side-by-side' || arg === '-s') {
			options.format = 'side-by-side';
		} else if (arg === '--unified' || arg === '-u') {
			options.format = 'unified';
		} else if (arg === '--help' || arg === '-h') {
			printDiffHelp();
			return;
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	if (positional.length < 2) {
		console.error(pc.red('Error: diff requires two transactions'));
		printDiffHelp();
		process.exit(1);
	}

	const [tx1Input, tx2Input] = positional as [string, string];

	console.log(pc.dim('Fetching transactions...'));

	const [result1, result2] = await Promise.all([
		fetchTransaction(tx1Input, positional[2], options),
		fetchTransaction(tx2Input, positional[3], options),
	]);

	const output = formatDiff(result1, result2, options);
	console.log(output);
}

async function fetchTransaction(
	input: string,
	chainIdArg: string | undefined,
	options: DiffOptions
): Promise<DebugResult> {
	let txHash: `0x${string}`;
	let chainId: number;

	if (input.startsWith('http')) {
		const parsed = parseExplorerUrl(input);
		txHash = parsed.txHash;
		chainId = parsed.chainId;
	} else if (input.startsWith('0x')) {
		const config = loadConfig();
		txHash = input.toLowerCase() as `0x${string}`;
		chainId = chainIdArg ? Number.parseInt(chainIdArg, 10) : (config.defaultChain ?? 1);
	} else {
		throw new Error(`Invalid transaction input: ${input}`);
	}

	const network = getNetworkByChainId(chainId);
	return debugTransaction(network, txHash, {
		labelsPath: options.labelsPath,
		timeout: options.timeout,
	});
}

function formatDiff(left: DebugResult, right: DebugResult, _options: DiffOptions): string {
	const lines: string[] = [];
	const hr = pc.dim('═'.repeat(70));
	const hrLight = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('TRANSACTION DIFF'));
	lines.push(hr);
	lines.push('');

	lines.push(pc.bold('Transactions:'));
	lines.push(`  ${pc.red('- ')}${pc.dim('(left)')}  ${left.txHash.slice(0, 18)}...`);
	lines.push(`  ${pc.green('+ ')}${pc.dim('(right)')} ${right.txHash.slice(0, 18)}...`);
	lines.push('');

	lines.push(hrLight);
	lines.push(pc.bold('BASIC INFO'));
	lines.push(hrLight);

	const basicFields: Array<{ name: string; left: string; right: string }> = [
		{
			name: 'Network',
			left: left.network.title || left.network.name,
			right: right.network.title || right.network.name,
		},
		{ name: 'Status', left: left.status, right: right.status },
		{ name: 'Block', left: String(left.blockNumber), right: String(right.blockNumber) },
		{ name: 'From', left: left.from, right: right.from },
		{ name: 'To', left: left.to || '(none)', right: right.to || '(none)' },
		{ name: 'Value', left: String(left.value), right: String(right.value) },
		{ name: 'Gas Used', left: String(left.gasUsed), right: String(right.gasUsed) },
	];

	for (const field of basicFields) {
		const changed = field.left !== field.right;
		if (changed) {
			lines.push(`${pc.yellow(`${field.name}:`)} ${pc.dim('(changed)')}`);
			lines.push(`  ${pc.red(`- ${field.left}`)}`);
			lines.push(`  ${pc.green(`+ ${field.right}`)}`);
		} else {
			lines.push(`${pc.dim(`${field.name}:`)} ${pc.white(field.left)}`);
		}
	}
	lines.push('');

	lines.push(hrLight);
	lines.push(pc.bold('EVENTS'));
	lines.push(hrLight);

	const logDiffs = diffLogs(left, right);

	if (logDiffs.length === 0) {
		lines.push(pc.dim('No events in either transaction'));
	} else {
		for (const diff of logDiffs) {
			switch (diff.status) {
				case 'same':
					lines.push(
						`${pc.dim(`#${diff.index + 1}`)} ${pc.cyan(diff.eventName)} ${pc.dim('(same)')}`
					);
					break;
				case 'added':
					lines.push(
						`${pc.green(`#${diff.index + 1}`)} ${pc.green(diff.eventName)} ${pc.green('(added)')}`
					);
					if (diff.right) {
						lines.push(`  ${pc.dim('Contract:')} ${pc.white(diff.right.address)}`);
						if (diff.right.decoded) {
							for (const [key, value] of Object.entries(diff.right.decoded)) {
								lines.push(`  ${pc.green(`+ ${key}:`)} ${formatValueSimple(value)}`);
							}
						}
					}
					break;
				case 'removed':
					lines.push(
						`${pc.red(`#${diff.index + 1}`)} ${pc.red(diff.eventName)} ${pc.red('(removed)')}`
					);
					if (diff.left) {
						lines.push(`  ${pc.dim('Contract:')} ${pc.white(diff.left.address)}`);
						if (diff.left.decoded) {
							for (const [key, value] of Object.entries(diff.left.decoded)) {
								lines.push(`  ${pc.red(`- ${key}:`)} ${formatValueSimple(value)}`);
							}
						}
					}
					break;
				case 'changed':
					lines.push(
						`${pc.yellow(`#${diff.index + 1}`)} ${pc.cyan(diff.eventName)} ${pc.yellow('(changed)')}`
					);
					if (diff.fieldDiffs) {
						for (const fd of diff.fieldDiffs) {
							if (fd.changed) {
								lines.push(`  ${pc.yellow(`${fd.field}:`)}`);
								lines.push(`    ${pc.red(`- ${fd.left}`)}`);
								lines.push(`    ${pc.green(`+ ${fd.right}`)}`);
							}
						}
					}
					break;
			}
			lines.push('');
		}
	}

	if (left.errors.length > 0 || right.errors.length > 0) {
		lines.push(hrLight);
		lines.push(pc.bold('ERRORS'));
		lines.push(hrLight);

		if (left.errors.length > 0 && right.errors.length === 0) {
			lines.push(pc.red('Left transaction has errors, right does not:'));
			for (const err of left.errors) {
				lines.push(`  ${pc.red(`- ${err.errorName}`)}: ${err.message || ''}`);
			}
		} else if (left.errors.length === 0 && right.errors.length > 0) {
			lines.push(pc.green('Right transaction has errors, left does not:'));
			for (const err of right.errors) {
				lines.push(`  ${pc.green(`+ ${err.errorName}`)}: ${err.message || ''}`);
			}
		} else {
			lines.push(pc.dim('Both transactions have errors'));
			lines.push(`${pc.dim('Left errors:')} ${left.errors.length}`);
			lines.push(`${pc.dim('Right errors:')} ${right.errors.length}`);
		}
		lines.push('');
	}

	lines.push(hr);
	lines.push(pc.bold('SUMMARY'));
	lines.push(hr);

	const added = logDiffs.filter((d) => d.status === 'added').length;
	const removed = logDiffs.filter((d) => d.status === 'removed').length;
	const changed = logDiffs.filter((d) => d.status === 'changed').length;
	const same = logDiffs.filter((d) => d.status === 'same').length;

	lines.push(
		`Events: ${pc.green(`+${added}`)} ${pc.red(`-${removed}`)} ${pc.yellow(`~${changed}`)} ${pc.dim(`=${same}`)}`
	);

	const statusChanged = left.status !== right.status;
	if (statusChanged) {
		lines.push(`Status: ${pc.red(left.status)} → ${pc.green(right.status)}`);
	}

	const gasDiff = right.gasUsed - left.gasUsed;
	if (gasDiff !== 0n) {
		const gasDiffStr = gasDiff > 0n ? `+${gasDiff}` : String(gasDiff);
		const gasColor = gasDiff > 0n ? pc.red : pc.green;
		lines.push(`Gas: ${gasColor(gasDiffStr)} (${left.gasUsed} → ${right.gasUsed})`);
	}

	lines.push(hr);

	return lines.join('\n');
}

function diffLogs(left: DebugResult, right: DebugResult): LogDiff[] {
	const diffs: LogDiff[] = [];
	const maxLen = Math.max(left.logs.length, right.logs.length);

	for (let i = 0; i < maxLen; i++) {
		const leftLog = left.logs[i];
		const rightLog = right.logs[i];

		if (!leftLog && rightLog) {
			diffs.push({
				index: i,
				eventName: rightLog.eventName || 'Unknown',
				right: {
					address: rightLog.address,
					addressLabel: rightLog.addressLabel,
					eventName: rightLog.eventName,
					decoded: rightLog.decoded,
				},
				status: 'added',
			});
		} else if (leftLog && !rightLog) {
			diffs.push({
				index: i,
				eventName: leftLog.eventName || 'Unknown',
				left: {
					address: leftLog.address,
					addressLabel: leftLog.addressLabel,
					eventName: leftLog.eventName,
					decoded: leftLog.decoded,
				},
				status: 'removed',
			});
		} else if (leftLog && rightLog) {
			const eventSame = leftLog.eventName === rightLog.eventName;
			const addressSame = leftLog.address.toLowerCase() === rightLog.address.toLowerCase();
			const dataSame = leftLog.data === rightLog.data;

			if (eventSame && addressSame && dataSame) {
				diffs.push({
					index: i,
					eventName: leftLog.eventName || 'Unknown',
					left: {
						address: leftLog.address,
						addressLabel: leftLog.addressLabel,
						eventName: leftLog.eventName,
						decoded: leftLog.decoded,
					},
					right: {
						address: rightLog.address,
						addressLabel: rightLog.addressLabel,
						eventName: rightLog.eventName,
						decoded: rightLog.decoded,
					},
					status: 'same',
				});
			} else {
				const fieldDiffs: FieldDiff[] = [];

				if (!eventSame) {
					fieldDiffs.push({
						field: 'eventName',
						left: leftLog.eventName || 'Unknown',
						right: rightLog.eventName || 'Unknown',
						changed: true,
					});
				}

				if (!addressSame) {
					fieldDiffs.push({
						field: 'address',
						left: leftLog.address,
						right: rightLog.address,
						changed: true,
					});
				}

				const allKeys = new Set([
					...Object.keys(leftLog.decoded || {}),
					...Object.keys(rightLog.decoded || {}),
				]);

				for (const key of allKeys) {
					const leftVal = leftLog.decoded?.[key];
					const rightVal = rightLog.decoded?.[key];
					const leftStr = formatValueSimple(leftVal);
					const rightStr = formatValueSimple(rightVal);

					if (leftStr !== rightStr) {
						fieldDiffs.push({
							field: key,
							left: leftStr,
							right: rightStr,
							changed: true,
						});
					}
				}

				diffs.push({
					index: i,
					eventName: leftLog.eventName || rightLog.eventName || 'Unknown',
					left: {
						address: leftLog.address,
						addressLabel: leftLog.addressLabel,
						eventName: leftLog.eventName,
						decoded: leftLog.decoded,
					},
					right: {
						address: rightLog.address,
						addressLabel: rightLog.addressLabel,
						eventName: rightLog.eventName,
						decoded: rightLog.decoded,
					},
					status: 'changed',
					fieldDiffs,
				});
			}
		}
	}

	return diffs;
}

function formatValueSimple(value: unknown): string {
	if (value === undefined) return '(undefined)';
	if (typeof value === 'bigint') return value.toString();
	if (Array.isArray(value)) return `[${value.length} items]`;
	return String(value);
}

function printDiffHelp(): void {
	console.log(`
${pc.bold('txray diff')} ${pc.dim('- Compare two transactions')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray diff')} ${pc.dim('<tx1> <tx2> [options]')}

${pc.yellow('ARGUMENTS:')}
  ${pc.cyan('<tx1>')}                 First transaction (URL or hash)
  ${pc.cyan('<tx2>')}                 Second transaction (URL or hash)

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}            Show this help message
  ${pc.cyan('--unified, -u')}         Unified diff output (default)
  ${pc.cyan('--side-by-side, -s')}    Side-by-side diff output
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}    Request timeout in milliseconds
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}   Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray diff https://etherscan.io/tx/0x123... https://etherscan.io/tx/0x456...')}
  ${pc.dim('txray diff 0x123... 0x456... 1')}
  ${pc.dim('txray diff 0x123... 0x456... --side-by-side')}
`);
}
