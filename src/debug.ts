import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import {
	createPublicClient,
	decodeErrorResult,
	decodeEventLog,
	formatEther,
	type Hex,
	http,
	type Log,
} from 'viem';
import { ALL_ABIS, KNOWN_TOPICS } from './abis.js';
import {
	BIGINT_THRESHOLD_HIGH,
	BIGINT_THRESHOLD_LOW,
	DEFAULT_TIMEOUT_MS,
	ERROR_DATA_OFFSET,
	ERROR_LENGTH_END,
	ERROR_SELECTOR_REVERT,
	HR_WIDTH,
} from './constants.js';
import { resolveAddresses } from './ens.js';
import { type Labels, loadLabels } from './labels.js';
import { getExplorerTxUrl, getPhalconUrl, getRpcUrl, getTenderlyUrl } from './networks.js';

export interface DebugResult {
	network: NetworkConfig;
	txHash: string;
	status: 'success' | 'reverted';
	blockNumber: bigint;
	timestamp: Date;
	from: string;
	to: string | null;
	value: bigint;
	gasUsed: bigint;
	logs: DecodedLog[];
	errors: DecodedError[];
	links: {
		explorer: string;
		tenderly: string;
		phalcon: string;
	};
	labels: Labels;
}

export interface DecodedLog {
	index: number;
	address: string;
	addressLabel?: string;
	eventName?: string;
	topics: string[];
	data: string;
	decoded?: Record<string, unknown>;
}

export interface DecodedError {
	source: string;
	errorName: string;
	message?: string;
	data: string;
}

export interface DebugOptions {
	labelsPath?: string;
	timeout?: number;
	noEns?: boolean;
}

class TxRayError extends Error {
	constructor(
		message: string,
		public readonly code?: string
	) {
		super(message);
		this.name = 'TxRayError';
	}
}

function parseRpcError(error: unknown): TxRayError {
	const message = (error as Error).message || String(error);

	if (message.includes('not found') || message.includes('could not be found')) {
		return new TxRayError('Transaction not found. Check the hash and network.', 'TX_NOT_FOUND');
	}

	if (message.includes('rate limit') || message.includes('429')) {
		return new TxRayError('Rate limited by RPC. Try again in a few seconds.', 'RATE_LIMITED');
	}

	if (
		message.includes('timeout') ||
		message.includes('ETIMEDOUT') ||
		message.includes('ECONNRESET')
	) {
		return new TxRayError(
			'Request timed out. Try increasing --timeout or check your connection.',
			'TIMEOUT'
		);
	}

	if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
		return new TxRayError('Could not reach RPC. Check your internet connection.', 'NETWORK_ERROR');
	}

	return new TxRayError(message, 'RPC_ERROR');
}

export async function debugTransaction(
	network: NetworkConfig,
	txHash: `0x${string}`,
	options: DebugOptions = {}
): Promise<DebugResult> {
	const labels = loadLabels(options.labelsPath);
	const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const [tx, receipt] = await Promise.all([
		client.getTransaction({ hash: txHash }).catch((error) => {
			throw parseRpcError(error);
		}),
		client.getTransactionReceipt({ hash: txHash }).catch((error) => {
			throw parseRpcError(error);
		}),
	]);

	const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch((error) => {
		throw parseRpcError(error);
	});

	const logs = decodeAllLogs(receipt.logs, labels);
	const errors = extractErrors(logs);

	const mergedLabels = { ...labels };

	if (!options.noEns && network.chainId === 1) {
		const addresses = [tx.from, tx.to, ...logs.map((l) => l.address)].filter(
			(a): a is string => !!a
		);
		const ensNames = await resolveAddresses(addresses).catch(() => new Map<string, string>());
		for (const [addr, name] of ensNames) {
			if (!mergedLabels[addr]) {
				mergedLabels[addr] = name;
			}
		}
	}

	const logsWithEns = logs.map((log) => ({
		...log,
		addressLabel: mergedLabels[log.address.toLowerCase()] ?? log.addressLabel,
	}));

	return {
		network,
		txHash,
		status: receipt.status,
		blockNumber: receipt.blockNumber,
		timestamp: new Date(Number(block.timestamp) * 1000),
		from: tx.from,
		to: tx.to,
		value: tx.value,
		gasUsed: receipt.gasUsed,
		logs: logsWithEns,
		errors,
		links: {
			explorer: getExplorerTxUrl(network, txHash),
			tenderly: getTenderlyUrl(network, txHash),
			phalcon: getPhalconUrl(network, txHash),
		},
		labels: mergedLabels,
	};
}

function decodeAllLogs(logs: Log[], labels: Labels): DecodedLog[] {
	return logs.map((log, i) => {
		const addressLabel = labels[log.address.toLowerCase()];
		const topic0 = log.topics[0];

		let eventName: string | undefined;
		let decoded: Record<string, unknown> | undefined;
		try {
			const result = decodeEventLog({
				abi: ALL_ABIS,
				data: log.data,
				topics: log.topics as [Hex, ...Hex[]],
			});
			eventName = result.eventName;
			decoded = (result.args ?? {}) as Record<string, unknown>;
		} catch {
			eventName = topic0 ? KNOWN_TOPICS[topic0] : undefined;
		}

		return {
			index: i,
			address: log.address,
			addressLabel,
			eventName,
			topics: log.topics as string[],
			data: log.data,
			decoded,
		};
	});
}

function extractErrors(logs: DecodedLog[]): DecodedError[] {
	const errors: DecodedError[] = [];

	for (const log of logs) {
		if (log.eventName === 'CallFailed' && log.decoded?.returnData) {
			const returnData = log.decoded.returnData as Hex;
			const decoded = tryDecodeError(returnData);
			if (decoded) {
				errors.push({
					source: `Log #${log.index + 1} (${log.address})`,
					...decoded,
					data: returnData,
				});
			}
		}
	}

	return errors;
}

function tryDecodeError(data: Hex): { errorName: string; message?: string } | null {
	if (data.length < 10) return null;

	try {
		const result = decodeErrorResult({
			abi: ALL_ABIS,
			data,
		});
		return {
			errorName: result.errorName,
			message: result.args?.[0] as string | undefined,
		};
	} catch {
		if (data.startsWith(ERROR_SELECTOR_REVERT)) {
			try {
				const length = Number(`0x${data.slice(ERROR_DATA_OFFSET, ERROR_LENGTH_END)}`);
				const message = Buffer.from(
					data.slice(ERROR_LENGTH_END, ERROR_LENGTH_END + length * 2),
					'hex'
				).toString('utf8');
				return { errorName: 'Error', message };
			} catch {
				return null;
			}
		}
	}

	return null;
}

export function formatDebugResult(result: DebugResult): string {
	const { labels } = result;
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(HR_WIDTH));

	lines.push(hr);
	lines.push(
		`${pc.bold('TRANSACTION')} ${pc.dim('·')} ${pc.cyan(result.network.title || result.network.name)}`
	);
	lines.push(hr);
	lines.push('');
	lines.push(`${pc.dim('Hash:')}   ${pc.white(result.txHash)}`);
	const statusColor = result.status === 'success' ? pc.green : pc.red;
	lines.push(`${pc.dim('Status:')} ${statusColor(result.status)}`);
	lines.push(`${pc.dim('Block:')}  ${pc.white(String(result.blockNumber))}`);
	lines.push(`${pc.dim('Time:')}   ${pc.white(result.timestamp.toISOString())}`);
	lines.push(`${pc.dim('From:')}   ${pc.white(result.from)}`);
	lines.push(
		`${pc.dim('To:')}     ${result.to ? pc.white(result.to) : pc.dim('(contract creation)')}`
	);
	const valueStr = formatEther(result.value);
	const symbol = result.network.nativeToken?.symbol || 'ETH';
	lines.push(
		`${pc.dim('Value:')}  ${valueStr !== '0' ? pc.yellow(valueStr) : pc.dim(valueStr)} ${pc.dim(symbol)}`
	);
	lines.push(`${pc.dim('Gas:')}    ${pc.white(result.gasUsed.toLocaleString())}`);
	lines.push('');

	if (result.errors.length > 0) {
		lines.push(hr);
		lines.push(`${pc.red(pc.bold('ERRORS'))} ${pc.red(`(${result.errors.length})`)}`);
		lines.push(hr);
		for (const error of result.errors) {
			lines.push(`${pc.dim('Source:')}  ${pc.white(error.source)}`);
			lines.push(`${pc.dim('Error:')}   ${pc.red(error.errorName)}`);
			if (error.message) lines.push(`${pc.dim('Message:')} ${pc.red(error.message)}`);
			lines.push('');
		}
	}

	lines.push(hr);
	lines.push(`${pc.bold('EVENTS')} ${pc.dim(`(${result.logs.length})`)}`);
	lines.push(hr);
	for (const log of result.logs) {
		const eventName = log.eventName || 'Unknown';
		lines.push(`${pc.dim(`#${log.index + 1}`)} ${pc.cyan(eventName)}`);
		lines.push(`   ${pc.dim('Contract:')} ${pc.white(log.address)}`);
		if (log.addressLabel) lines.push(`             ${pc.yellow(log.addressLabel)}`);
		if (log.decoded) {
			for (const [key, value] of Object.entries(log.decoded)) {
				const formatted = formatValue(value, labels);
				lines.push(`   ${pc.dim(`${key}:`)} ${formatted}`);
			}
		}
		lines.push('');
	}

	lines.push(hr);
	lines.push(`${pc.bold('LINKS')}`);
	lines.push(hr);
	lines.push(`${pc.dim('Explorer:')} ${pc.blue(pc.underline(result.links.explorer))}`);
	lines.push(`${pc.dim('Tenderly:')} ${pc.blue(pc.underline(result.links.tenderly))}`);
	lines.push(`${pc.dim('Phalcon:')}  ${pc.blue(pc.underline(result.links.phalcon))}`);
	lines.push(hr);

	return lines.join('\n');
}

function formatValue(value: unknown, labels: Labels): string {
	if (typeof value === 'bigint') {
		const str = value.toString();
		if (value > BIGINT_THRESHOLD_LOW && value < BIGINT_THRESHOLD_HIGH) {
			return `${pc.magenta(str)} ${pc.dim(`(${formatEther(value)} if 18 decimals)`)}`;
		}
		return pc.magenta(str);
	}
	if (typeof value === 'string' && value.startsWith('0x') && value.length === 42) {
		const label = labels[value.toLowerCase()];
		return label ? `${pc.white(value)} ${pc.yellow(`(${label})`)}` : pc.white(value);
	}
	if (Array.isArray(value)) {
		return pc.dim(`[${value.length} items]`);
	}
	return pc.white(String(value));
}
