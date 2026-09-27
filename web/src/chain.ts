import {
  formatUnits,
  isAddress,
  maxUint256,
  parseUnits,
  zeroAddress,
} from "viem";
import type { Address, AbiEvent } from "viem";
import type { Client, Config } from "./config";
export type Snapshot = {
  account?: Address;
  block: bigint;
  blockHash: string;
  timestamp: bigint;
  epoch: bigint;
  start: bigint;
  duration: bigint;
  limit: bigint;
  decimals: number;
  remaining?: bigint;
  balance?: bigint;
  allowance?: bigint;
  withdrawable?: bigint;
  received?: bigint;
  lifetime?: bigint;
  tips?: bigint;
};
export type Leader = { address: Address; count: bigint; tip: bigint };
export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export const amount = (value: bigint | undefined, decimals = 18) =>
  value === undefined ? "—" : formatUnits(value, decimals);
export function errorText(error: unknown) {
  const e = error as {
    code?: number;
    shortMessage?: string;
    message?: string;
    cause?: unknown;
  };
  if (
    e?.code === 4001 ||
    /user rejected|user denied/i.test(e?.shortMessage || e?.message || "")
  )
    return "Request declined in your wallet. You can try again when ready.";
  return (
    e?.shortMessage ||
    e?.message ||
    "Unable to complete the request. Check your connection and try again."
  );
}
export function payment(
  to: string,
  count: number,
  tip: string,
  data: Snapshot | undefined,
  account?: Address,
) {
  if (
    !isAddress(to) ||
    to.toLowerCase() === zeroAddress ||
    to.toLowerCase() === account?.toLowerCase()
  )
    throw Error("Enter another person’s valid Ethereum address.");
  if (
    !data ||
    !Number.isInteger(count) ||
    count < 1 ||
    BigInt(count) > (data.remaining ?? 0n)
  )
    throw Error("Choose a count within your remaining kudos.");
  if (
    !/^(\d+)(\.\d+)?$/.test(tip) ||
    (tip.split(".")[1]?.length || 0) > data.decimals
  )
    throw Error(
      `Use a positive KUDO amount or 0, with up to ${data.decimals} decimal places.`,
    );
  const tipPerKudo = parseUnits(tip, data.decimals);
  const total = BigInt(count) * tipPerKudo;
  if (total > maxUint256)
    throw Error("This tip exceeds the supported token amount.");
  if (total > (data.balance ?? 0n))
    throw Error(
      "Your KUDO balance is too low for this total tip. Reduce the tip or get KUDO.",
    );
  return { to: to as Address, count: BigInt(count), tipPerKudo, total };
}
export async function snapshot(
  client: Client,
  config: Config,
  account?: Address,
): Promise<Snapshot> {
  if ((await client.getChainId()) !== config.manifest.chainId)
    throw Error(
      "The RPC returned the wrong chain. Transactions are disabled. Try refreshing.",
    );
  const block = await client.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const read = (
    contract: Config["app"],
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    client.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
      blockNumber,
    });
  const [appCode, tokenCode, binding, epoch, start, duration, limit, decimals] =
    await Promise.all([
      client.getCode({ address: config.app.address, blockNumber }),
      client.getCode({ address: config.token.address, blockNumber }),
      read(config.app, "token"),
      read(config.app, "currentEpoch"),
      read(config.app, "deployTimestamp"),
      read(config.app, "EPOCH_DURATION"),
      read(config.app, "KUDOS_PER_EPOCH"),
      read(config.token, "decimals"),
    ]);
  if (!appCode || appCode === "0x" || !tokenCode || tokenCode === "0x")
    throw Error(
      "Deployed contract code could not be verified. Transactions are disabled.",
    );
  if (String(binding).toLowerCase() !== config.token.address.toLowerCase())
    throw Error(
      "KudosEpochs.token() differs from the verified KUDO deployment. Transactions are disabled.",
    );
  const base = {
    account,
    block: blockNumber,
    blockHash: block.hash,
    timestamp: block.timestamp,
    epoch: epoch as bigint,
    start: start as bigint,
    duration: duration as bigint,
    limit: limit as bigint,
    decimals: Number(decimals),
  };
  if (!account) return base;
  // Read the token address exposed by token(), after verifying its attested binding.
  const token = { ...config.token, address: binding as Address };
  const [
    remaining,
    balance,
    allowance,
    withdrawable,
    received,
    lifetime,
    tips,
  ] = await Promise.all([
    read(config.app, "remaining", [account]),
    read(token, "balanceOf", [account]),
    read(token, "allowance", [account, config.app.address]),
    read(config.app, "withdrawable", [account]),
    read(config.app, "receivedIn", [epoch, account]),
    read(config.app, "lifetimeReceived", [account]),
    read(config.app, "tipsReceived", [account]),
  ]);
  return {
    ...base,
    remaining: remaining as bigint,
    balance: balance as bigint,
    allowance: allowance as bigint,
    withdrawable: withdrawable as bigint,
    received: received as bigint,
    lifetime: lifetime as bigint,
    tips: tips as bigint,
  };
}
export async function leaderboard(
  client: Client,
  config: Config,
  data: Snapshot,
  signal: AbortSignal,
): Promise<{ leaders: Leader[]; from: bigint; to: bigint }> {
  const check = () => {
    if (signal.aborted) throw Error("Leaderboard scan cancelled");
  };
  let low = BigInt(config.manifest.deploymentBlock),
    high = data.block;
  const epochStart = data.start + data.epoch * data.duration;
  // Find the first block of the current epoch, never assume a block duration.
  while (low < high) {
    check();
    const mid = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (block.timestamp < epochStart) low = mid + 1n;
    else high = mid;
  }
  const event = config.app.abi.find(
    (e) => e.type === "event" && e.name === "Kudos",
  ) as AbiEvent;
  const totals = new Map<string, Leader>();
  const seen = new Set<string>();
  const scan = async (fromBlock: bigint, toBlock: bigint): Promise<void> => {
    check();
    try {
      const logs = await client.getLogs({
        address: config.app.address,
        event,
        args: { epoch: data.epoch },
        fromBlock,
        toBlock,
        strict: true,
      });
      check();
      for (const log of logs) {
        const key = `${log.blockHash}:${log.logIndex}`;
        if (log.removed || seen.has(key)) continue;
        seen.add(key);
        const args = log.args as unknown as {
          to: Address;
          count: bigint;
          tip: bigint;
        };
        const address = args.to.toLowerCase() as Address;
        const item = totals.get(address) || { address, count: 0n, tip: 0n };
        item.count += args.count;
        item.tip += args.tip;
        totals.set(address, item);
      }
    } catch (error) {
      check();
      if (toBlock - fromBlock < 100n) throw error;
      const mid = (fromBlock + toBlock) / 2n;
      await scan(fromBlock, mid);
      await scan(mid + 1n, toBlock);
    }
  };
  for (let start = low; start <= data.block; start += 20000n) {
    check();
    await Promise.all(
      [0n, 5000n, 10000n, 15000n].map((offset) => {
        const a = start + offset,
          b = a + 4999n;
        return a > data.block
          ? Promise.resolve()
          : scan(a, b > data.block ? data.block : b);
      }),
    );
  }
  // Discard the whole scan if the snapshot block reorganized; do not mix forks.
  if (
    (await client.getBlock({ blockNumber: data.block })).hash !== data.blockHash
  )
    throw Error("Chain changed during the scan. Refresh to try again.");
  return {
    leaders: [...totals.values()].sort((a, b) =>
      a.count === b.count
        ? a.address.localeCompare(b.address)
        : a.count > b.count
          ? -1
          : 1,
    ),
    from: low,
    to: data.block,
  };
}
