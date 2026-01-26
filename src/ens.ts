import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

const ENS_CACHE = new Map<string, string | null>();
const REVERSE_ENS_CACHE = new Map<string, string | null>();

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

function getEnsClient(): ReturnType<typeof createPublicClient> {
	if (!cachedClient) {
		cachedClient = createPublicClient({
			chain: mainnet,
			transport: http(),
		});
	}
	return cachedClient;
}

export async function resolveEnsName(name: string): Promise<string | null> {
	const normalized = normalize(name);

	if (ENS_CACHE.has(normalized)) {
		return ENS_CACHE.get(normalized) ?? null;
	}

	try {
		const client = getEnsClient();
		const address = await client.getEnsAddress({ name: normalized });

		ENS_CACHE.set(normalized, address);
		return address;
	} catch {
		ENS_CACHE.set(normalized, null);
		return null;
	}
}

export async function reverseResolveAddress(address: string): Promise<string | null> {
	const lowerAddress = address.toLowerCase();

	if (REVERSE_ENS_CACHE.has(lowerAddress)) {
		return REVERSE_ENS_CACHE.get(lowerAddress) ?? null;
	}

	try {
		const client = getEnsClient();
		const name = await client.getEnsName({ address: address as `0x${string}` });

		REVERSE_ENS_CACHE.set(lowerAddress, name);
		return name;
	} catch {
		REVERSE_ENS_CACHE.set(lowerAddress, null);
		return null;
	}
}

export async function resolveAddresses(addresses: string[]): Promise<Map<string, string>> {
	const results = new Map<string, string>();
	const uniqueAddresses = [...new Set(addresses.map((a) => a.toLowerCase()))];

	const resolvePromises = uniqueAddresses.map(async (address) => {
		const name = await reverseResolveAddress(address);
		if (name) {
			results.set(address, name);
		}
	});

	await Promise.allSettled(resolvePromises);

	return results;
}

export function clearEnsCache(): void {
	ENS_CACHE.clear();
	REVERSE_ENS_CACHE.clear();
}

export function getEnsCacheStats(): { forward: number; reverse: number } {
	return {
		forward: ENS_CACHE.size,
		reverse: REVERSE_ENS_CACHE.size,
	};
}
