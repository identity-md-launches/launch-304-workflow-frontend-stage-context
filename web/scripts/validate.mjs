import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
const root = new URL("../../", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root)));
const manifest = await read("dist/imd-deployment.json");
const handoff = await read("web/config/deployment.json");
const network = await read("web/config/network.json");
function canonical(v) {
  return Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
}
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.equal(manifest[key], handoff[key]);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.equal(manifest.contracts.length, handoff.contracts.length);
for (const contract of handoff.contracts) {
  const exported = manifest.contracts.find((c) => c.name === contract.name);
  for (const key of ["name", "address", "abiHash"])
    assert.equal(exported[key], contract[key]);
  const abi = await read(`dist/${exported.abiPath}`);
  assert.equal(keccak256(toBytes(canonical(abi))).slice(2), contract.abiHash);
  const source = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${contract.name}.json`],
    { cwd: root },
  );
  assert.deepEqual(
    await readFile(new URL(`dist/${exported.abiPath}`, root)),
    source,
  );
}
async function list(path, prefix = "") {
  let files = [];
  for (const f of await readdir(new URL(path, root), { withFileTypes: true })) {
    assert(!f.isSymbolicLink(), "No symlinks in export");
    files.push(
      ...(f.isDirectory()
        ? await list(`${path}${f.name}/`, `${prefix}${f.name}/`)
        : [prefix + f.name]),
    );
  }
  return files;
}
const files = (await list("dist/"))
  .filter((f) => f !== "imd-deployment.json")
  .sort();
assert.deepEqual(manifest.assets.map((a) => a.path).sort(), files);
assert(files.includes("index.html"));
assert(files.length <= 128);
let bytes = 0;
for (const asset of manifest.assets) {
  assert(
    !asset.path.includes("..") &&
      !asset.path.startsWith("/") &&
      !asset.path.includes(":"),
  );
  const contents = await readFile(new URL(`dist/${asset.path}`, root));
  bytes += contents.length;
  assert(contents.length <= 8388608);
  assert.equal(
    createHash("sha256").update(contents).digest("hex"),
    asset.sha256,
  );
}
assert(bytes < 30 * 1024 * 1024);
const html = await readFile(new URL("dist/index.html", root), "utf8");
assert(!/(?:src|href)="\//.test(html), "Relative asset URLs");
const submitted = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "web",
    "dist",
    "docs",
  ],
  { cwd: root },
)
  .toString()
  .split("\0")
  .filter(Boolean);
assert(
  submitted.every((f) => !/(^|\/)(node_modules|\.cache|vendor)(\/|$)/.test(f)),
  "No dependency or cache artifacts",
);
let sourceBytes = 0;
for (const file of submitted)
  sourceBytes += (await stat(new URL(file, root))).size;
const evidence = {
  checkedAt: new Date().toISOString(),
  status: "passed",
  assets: files.length,
  exportBytes: bytes,
  scopedFileBytes: sourceBytes,
  abiHashes: manifest.contracts.map((c) => ({
    name: c.name,
    abiHash: c.abiHash,
  })),
  checks: [
    "handoff fields",
    "exact network and walletAddChain objects",
    "pinned ABI bytes and canonical Keccak",
    "complete SHA-256 inventory",
    "relative paths",
    "asset count and size",
    "no dependency/cache artifacts",
  ],
};
await writeFile(
  new URL("docs/evidence/export-validation.json", root),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));
