import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const root = new URL("../../", import.meta.url);
const handoff = JSON.parse(
  await readFile(new URL("web/config/deployment.json", root)),
);
const network = JSON.parse(
  await readFile(new URL("web/config/network.json", root)),
);
if (
  handoff.chainId !== network.network.chainId ||
  Number(network.walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Handoff/network mismatch");
const contracts = [];
await mkdir(new URL("dist/abi/", root), { recursive: true });
for (const c of handoff.contracts) {
  const abiPath = `abi/${c.name}.json`;
  if (!/^[A-Za-z0-9_]+$/.test(c.name)) throw Error("Unsafe contract name");
  const raw = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/${abiPath}`],
    { cwd: root },
  );
  const abi = JSON.parse(raw);
  if (
    !Array.isArray(abi) ||
    keccak256(toBytes(canonical(abi))).slice(2) !== c.abiHash
  )
    throw Error(`ABI hash mismatch: ${c.name}`);
  await writeFile(new URL(`dist/${abiPath}`, root), raw);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath,
  });
  console.log(`Verified pinned ABI: ${c.name} ${c.abiHash}`);
}
async function inventory(dir, prefix = "") {
  const files = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + f.name;
    if (f.isDirectory())
      files.push(...(await inventory(new URL(`${f.name}/`, dir), `${path}/`)));
    else if (path !== "imd-deployment.json") {
      const bytes = await readFile(new URL(f.name, dir));
      if (bytes.length > 8388608) throw Error("Asset exceeds 8 MiB");
      files.push({
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const assets = await inventory(new URL("dist/", root));
if (assets.length > 128) throw Error("Too many assets");
const { version, launchId, chainId, sourceCommit, attestationHash } = handoff;
const manifest = {
  version,
  launchId,
  chainId,
  sourceCommit,
  attestationHash,
  contracts,
  assets,
  network: network.network,
  walletAddChain: network.walletAddChain,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
};
await writeFile(
  new URL("dist/imd-deployment.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Exported deployment manifest with ${assets.length} assets`);
