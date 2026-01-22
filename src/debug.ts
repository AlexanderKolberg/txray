import type { NetworkConfig } from '@0xsequence/network';
import {
	createPublicClient,
	decodeEventLog,
	decodeErrorResult,
	formatEther,
	http,
	type Hex,
	type Log,
} from 'viem';
import { getRpcUrl, getExplorerTxUrl, getTenderlyUrl, getPhalconUrl } from './networks.js';
import { ALL_ABIS, KNOWN_TOPICS, KNOWN_CONTRACTS } from './abis.js';

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

export async function debugTransaction(
	network: NetworkConfig,
	txHash: `0x${string}`
): Promise<DebugResult> {
	const client = createPublicClient({
		transport: http(getRpcUrl(network)),
	});

	const [tx, receipt] = await Promise.all([
		client.getTransaction({ hash: txHash }),
		client.getTransactionReceipt({ hash: txHash }),
	]);

	const block = await client.getBlock({ blockNumber: receipt.blockNumber });

	const logs = decodeAllLogs(receipt.logs);
	const errors = extractErrors(logs);

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
		logs,
		errors,
		links: {
			explorer: getExplorerTxUrl(network, txHash),
			tenderly: getTenderlyUrl(network, txHash),
			phalcon: getPhalconUrl(network, txHash),
		},
	};
}

function decodeAllLogs(logs: Log[]): DecodedLog[] {
	return logs.map((log, i) => {
		const addressLabel = KNOWN_CONTRACTS[log.address.toLowerCase()];
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
			decoded = result.args as Record<string, unknown>;
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
		if (data.startsWith('0x08c379a0')) {
			try {
				const length = Number('0x' + data.slice(74, 138));
				const message = Buffer.from(data.slice(138, 138 + length * 2), 'hex').toString('utf8');
				return { errorName: 'Error', message };
			} catch {
				return null;
			}
		}
	}

	return null;
}

export function formatDebugResult(result: DebugResult): string {
	const lines: string[] = [];
	const hr = '='.repeat(80);

	lines.push(hr);
	lines.push(`TRANSACTION DEBUG - ${result.network.title || result.network.name}`);
	lines.push(hr);
	lines.push('');
	lines.push(`Hash: ${result.txHash}`);
	lines.push(`Status: ${result.status}`);
	lines.push(`Block: ${result.blockNumber}`);
	lines.push(`Time: ${result.timestamp.toISOString()}`);
	lines.push(`From: ${result.from}`);
	lines.push(`To: ${result.to || '(contract creation)'}`);
	lines.push(`Value: ${formatEther(result.value)} ${result.network.nativeToken?.symbol || 'ETH'}`);
	lines.push(`Gas Used: ${result.gasUsed.toLocaleString()}`);
	lines.push('');

	if (result.errors.length > 0) {
		lines.push(hr);
		lines.push('ERRORS FOUND');
		lines.push(hr);
		for (const error of result.errors) {
			lines.push(`Source: ${error.source}`);
			lines.push(`Error: ${error.errorName}`);
			if (error.message) lines.push(`Message: ${error.message}`);
			lines.push('');
		}
	}

	lines.push(hr);
	lines.push(`EVENT LOGS (${result.logs.length})`);
	lines.push(hr);
	for (const log of result.logs) {
		lines.push(`#${log.index + 1} ${log.eventName || 'Unknown'}`);
		lines.push(`  Contract: ${log.address}`);
		if (log.addressLabel) lines.push(`           ${log.addressLabel}`);
		if (log.decoded) {
			for (const [key, value] of Object.entries(log.decoded)) {
				const formatted = formatValue(value);
				lines.push(`  ${key}: ${formatted}`);
			}
		}
		lines.push('');
	}

	lines.push(hr);
	lines.push('DEBUG LINKS');
	lines.push(hr);
	lines.push(`Explorer: ${result.links.explorer}`);
	lines.push(`Tenderly: ${result.links.tenderly}`);
	lines.push(`Phalcon:  ${result.links.phalcon}`);
	lines.push(hr);

	return lines.join('\n');
}

function formatValue(value: unknown): string {
	if (typeof value === 'bigint') {
		const str = value.toString();
		if (value > 10n ** 15n && value < 10n ** 30n) {
			return `${str} (${formatEther(value)} if 18 decimals)`;
		}
		return str;
	}
	if (typeof value === 'string' && value.startsWith('0x') && value.length === 42) {
		const label = KNOWN_CONTRACTS[value.toLowerCase()];
		return label ? `${value} (${label})` : value;
	}
	if (Array.isArray(value)) {
		return `[${value.length} items]`;
	}
	return String(value);
}
