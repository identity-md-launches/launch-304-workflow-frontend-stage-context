import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { decodeFunctionResult, encodeFunctionData } from "viem";
const root = new URL("../../", import.meta.url);
const config = JSON.parse(
  await readFile(new URL("dist/imd-deployment.json", root)),
);
const contracts = await Promise.all(
  config.contracts.map(async (c) => ({
    ...c,
    abi: JSON.parse(await readFile(new URL(`dist/${c.abiPath}`, root))),
  })),
);
const app = contracts.find((c) => c.name === "KudosEpochs"),
  token = contracts.find((c) => c.name === "LaunchToken");
const results = [];
for (const url of config.network.rpcUrls) {
  try {
    let id = 0;
    const rpc = (method, params = []) => {
      const r = JSON.parse(
        execFileSync(
          "curl",
          [
            "--silent",
            "--show-error",
            "--max-time",
            "18",
            url,
            "-H",
            "Content-Type: application/json",
            "--data",
            JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
          ],
          { encoding: "utf8" },
        ),
      );
      if (r.error) throw Error(r.error.message);
      return r.result;
    };
    const chain = Number(rpc("eth_chainId"));
    if (chain !== config.chainId) throw Error("Wrong chain");
    const block = rpc("eth_blockNumber");
    const code = contracts.map((c) => ({
      name: c.name,
      bytes: (rpc("eth_getCode", [c.address, block]).length - 2) / 2,
    }));
    if (code.some((c) => !c.bytes)) throw Error("Missing code");
    const read = (c, name, args = []) =>
      decodeFunctionResult({
        abi: c.abi,
        functionName: name,
        data: rpc("eth_call", [
          {
            to: c.address,
            data: encodeFunctionData({ abi: c.abi, functionName: name, args }),
          },
          block,
        ]),
      });
    const binding = read(app, "token");
    if (binding.toLowerCase() !== token.address.toLowerCase())
      throw Error("Token binding mismatch");
    results.push({
      url,
      status: "passed",
      chainId: chain,
      blockNumber: Number(block),
      code,
      tokenBinding: binding,
      epoch: read(app, "currentEpoch").toString(),
      deployTimestamp: read(app, "deployTimestamp").toString(),
      decimals: read(token, "decimals"),
      symbol: read(token, "symbol"),
    });
    break;
  } catch (e) {
    results.push({
      url,
      status: "unavailable",
      error: e.message.slice(0, 300),
    });
  }
}
const evidence = {
  checkedAt: new Date().toISOString(),
  readOnly: true,
  transactionsBroadcast: 0,
  results,
};
await writeFile(
  new URL("docs/evidence/live-read.json", root),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));
