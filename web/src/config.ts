import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  toBytes,
} from "viem";
import type { Abi, Address } from "viem";

export type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export type Manifest = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  deploymentBlock: number;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: Manifest["network"]["nativeCurrency"];
    blockExplorerUrls: string[];
  };
};
export type Contract = Manifest["contracts"][number] & { abi: Abi };
export type Config = {
  manifest: Manifest;
  app: Contract;
  token: Contract;
  chain: ReturnType<typeof defineChain>;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok)
    throw Error(
      `Cannot load ${path}. Reload the page or check your connection.`,
    );
  return response.json();
}
export async function loadConfig(): Promise<Config> {
  const manifest: Manifest = await json("imd-deployment.json");
  if (
    manifest.version !== 1 ||
    manifest.chainId !== manifest.network.chainId ||
    Number(manifest.walletAddChain.chainId) !== manifest.chainId ||
    !Number.isSafeInteger(manifest.deploymentBlock)
  )
    throw Error(
      "Deployment configuration is inconsistent. Transactions are disabled.",
    );
  const contracts = await Promise.all(
    manifest.contracts.map(async (c) => {
      if (
        !isAddress(c.address) ||
        !/^abi\/[A-Za-z0-9_]+\.json$/.test(c.abiPath)
      )
        throw Error("Invalid deployment contract.");
      const abi: Abi = await json(c.abiPath);
      if (
        !Array.isArray(abi) ||
        keccak256(toBytes(canonical(abi))).slice(2) !== c.abiHash
      )
        throw Error(
          `ABI verification failed for ${c.name}. Transactions are disabled.`,
        );
      return { ...c, abi };
    }),
  );
  const app = contracts.find((c) => c.name === "KudosEpochs");
  const token = contracts.find((c) => c.name === "LaunchToken");
  if (!app || !token) throw Error("Deployment is missing a required contract.");
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: manifest.network.explorer },
    },
    testnet: manifest.network.testnet,
  });
  return { manifest, app, token, chain };
}
export function publicClient(config: Config, provider?: Provider) {
  const transports = config.manifest.network.rpcUrls.map((url) =>
    http(url, { timeout: 10000, retryCount: 1 }),
  );
  return createPublicClient({
    chain: config.chain,
    transport: fallback(
      provider
        ? [...transports, custom(provider, { retryCount: 0 })]
        : transports,
      { retryCount: 0 },
    ),
  });
}
export type Client = ReturnType<typeof publicClient>;
export async function switchNetwork(provider: Provider, config: Config) {
  const params = [{ chainId: config.manifest.walletAddChain.chainId }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      e.code !== 4902 &&
      e.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
        e.message || "",
      )
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [config.manifest.walletAddChain],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
