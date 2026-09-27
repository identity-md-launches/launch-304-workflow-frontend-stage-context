import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  encodeFunctionResult,
  decodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  toHex,
  parseUnits,
} from "viem";
const root = new URL("../../", import.meta.url),
  dist = new URL("dist/", root);
const manifest = JSON.parse(
  await readFile(new URL("imd-deployment.json", dist)),
);
const contracts = await Promise.all(
  manifest.contracts.map(async (c) => ({
    ...c,
    abi: JSON.parse(await readFile(new URL(c.abiPath, dist))),
  })),
);
const app = contracts.find((c) => c.name === "KudosEpochs"),
  token = contracts.find((c) => c.name === "LaunchToken");
const account = "0x1111111111111111111111111111111111111111",
  recipient = "0x2222222222222222222222222222222222222222",
  other = "0x3333333333333333333333333333333333333333";
const block = BigInt(manifest.deploymentBlock + 20),
  start = 1789900000n,
  timestamp = start + 300n;
const h = "0x" + "ab".repeat(32),
  txHash = "0x" + "cd".repeat(32);
const evidence = {
  checkedAt: new Date().toISOString(),
  environment:
    "Chromium production export at /preview/; mocked EIP-1193 wallet and JSON-RPC; no real transactions",
  tests: [],
  screenshots: [],
  errors: [],
  resourceFailures: [],
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/") || path.includes("..")) {
      res.writeHead(404).end();
      return;
    }
    const file = path.slice("/preview/".length) || "index.html";
    const bytes = await readFile(new URL(file, dist));
    const ext = file.split(".").pop();
    res.setHeader(
      "Content-Type",
      {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
      }[ext] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
let context, page;
function defaultState() {
  return {
    remaining: 5n,
    balance: parseUnits("100", 18),
    allowance: 0n,
    withdrawable: parseUnits("8", 18),
    received: 3n,
    lifetime: 12n,
    tips: parseUnits("10", 18),
    epoch: 0n,
    sends: [],
    simulations: [],
    logs: [],
    logRanges: [],
    rejectSimulation: false,
    rejectLogs: false,
    wrongRpc: false,
    missingCode: false,
    wrongToken: false,
    changeAccountDuringSimulation: false,
  };
}
let state;
const blockResponse = (n) => ({
  number: toHex(n),
  hash: h,
  parentHash: h,
  nonce: "0x0000000000000000",
  sha3Uncles: h,
  logsBloom: "0x" + "00".repeat(256),
  transactionsRoot: h,
  stateRoot: h,
  receiptsRoot: h,
  miner: account,
  difficulty: "0x0",
  totalDifficulty: "0x0",
  extraData: "0x",
  size: "0x100",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  timestamp: toHex(timestamp - (block - n) * 12n),
  transactions: [],
  uncles: [],
  baseFeePerGas: "0x1",
});
function eventLog(to, count, tip, index = 0) {
  return {
    address: app.address,
    topics: encodeEventTopics({
      abi: app.abi,
      eventName: "Kudos",
      args: { epoch: state.epoch, from: other, to },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [count, tip],
    ),
    blockNumber: toHex(block),
    blockHash: h,
    transactionHash: txHash,
    transactionIndex: "0x0",
    logIndex: toHex(index),
    removed: false,
  };
}
async function rpc(method, params = []) {
  if (method === "eth_chainId")
    return state.wrongRpc ? "0x1" : manifest.walletAddChain.chainId;
  if (method === "eth_blockNumber") return toHex(block);
  if (method === "eth_getBlockByNumber")
    return blockResponse(params[0] === "latest" ? block : BigInt(params[0]));
  if (method === "eth_getCode")
    return state.missingCode ? "0x" : "0x6080604052";
  if (method === "eth_getLogs") {
    state.logRanges.push(params[0]);
    if (state.rejectLogs) throw Error("Simulated log service unavailable");
    return state.logs.filter(
      (l) =>
        BigInt(l.blockNumber) >= BigInt(params[0].fromBlock) &&
        BigInt(l.blockNumber) <= BigInt(params[0].toBlock),
    );
  }
  if (method === "eth_call") {
    const c =
      params[0].to.toLowerCase() === app.address.toLowerCase() ? app : token;
    const { functionName, args } = decodeFunctionData({
      abi: c.abi,
      data: params[0].data,
    });
    const values = {
      token: state.wrongToken ? other : token.address,
      currentEpoch: state.epoch,
      deployTimestamp: start,
      EPOCH_DURATION: 604800n,
      KUDOS_PER_EPOCH: 5n,
      decimals: 18,
      remaining: state.remaining,
      balanceOf: state.balance,
      allowance: state.allowance,
      withdrawable: state.withdrawable,
      receivedIn: state.received,
      lifetimeReceived: state.lifetime,
      tipsReceived: state.tips,
    };
    if (["give", "approve", "withdraw"].includes(functionName)) {
      state.simulations.push(functionName);
      if (state.changeAccountDuringSimulation)
        await page.evaluate((addr) => {
          window.mockWallet.account = addr;
        }, other);
      if (state.rejectSimulation)
        throw Error("execution reverted: InvalidCount");
      return functionName === "approve"
        ? encodeFunctionResult({ abi: c.abi, functionName, result: true })
        : "0x";
    }
    if (!(functionName in values))
      throw Error(`Unhandled call: ${functionName} ${args}`);
    return encodeFunctionResult({
      abi: c.abi,
      functionName,
      result: values[functionName],
    });
  }
  if (method === "eth_sendTransaction") {
    const c =
      params[0].to.toLowerCase() === app.address.toLowerCase() ? app : token;
    const decoded = decodeFunctionData({ abi: c.abi, data: params[0].data });
    state.sends.push({ ...decoded, to: params[0].to, value: params[0].value });
    if (decoded.functionName === "approve") state.allowance = decoded.args[1];
    if (decoded.functionName === "give") {
      const [to, count, per] = decoded.args;
      state.remaining -= count;
      state.balance -= count * per;
      state.allowance -= count * per;
      state.logs.push(eventLog(to, count, count * per, state.logs.length));
    }
    if (decoded.functionName === "withdraw") {
      state.balance += state.withdrawable;
      state.withdrawable = 0n;
    }
    return txHash;
  }
  if (method === "eth_getTransactionReceipt")
    return {
      transactionHash: txHash,
      transactionIndex: "0x0",
      blockHash: h,
      blockNumber: toHex(block),
      from: account,
      to: app.address,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      contractAddress: null,
      logs: [],
      logsBloom: "0x" + "00".repeat(256),
      status: "0x1",
      effectiveGasPrice: "0x1",
      type: "0x2",
    };
  throw Error(`Unhandled RPC: ${method}`);
}
async function open({ wallet = true, wrong = false, tamper = false } = {}) {
  if (context) await context.close();
  state = defaultState();
  context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  page = await context.newPage();
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("requestfailed", (r) => {
    if (!r.failure()?.errorText.includes("ERR_ABORTED"))
      evidence.resourceFailures.push({
        url: r.url(),
        error: r.failure()?.errorText,
      });
  });
  await context.route("https://**", async (route) => {
    if (
      !manifest.network.rpcUrls.some((u) => route.request().url().startsWith(u))
    ) {
      await route.abort();
      return;
    }
    const body = route.request().postDataJSON();
    const answer = async (r) => {
      try {
        return {
          jsonrpc: "2.0",
          id: r.id,
          result: await rpc(r.method, r.params),
        };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: r.id,
          error: { code: -32000, message: e.message },
        };
      }
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(body)
          ? await Promise.all(body.map(answer))
          : await answer(body),
      ),
    });
  });
  if (tamper)
    await context.route("**/abi/KudosEpochs.json", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" }),
    );
  if (wallet) {
    await page.exposeFunction("walletRpc", (method, params) =>
      rpc(method, params),
    );
    await page.addInitScript(
      ({ account, chainId, wrong }) => {
        const events = {};
        window.mockWallet = {
          account,
          chain: wrong ? "0x1" : chainId,
          unknown: wrong,
          calls: [],
          rejectConnect: false,
          rejectSend: false,
        };
        window.ethereum = {
          on: (name, fn) => (events[name] ??= []).push(fn),
          removeListener: (name, fn) => {
            events[name] = (events[name] || []).filter((f) => f !== fn);
          },
          request: async ({ method, params }) => {
            const s = window.mockWallet;
            s.calls.push({ method, params });
            if (method === "eth_requestAccounts") {
              if (s.rejectConnect)
                throw { code: 4001, message: "User rejected" };
              return [s.account];
            }
            if (method === "eth_accounts") return [s.account];
            if (method === "eth_chainId") return s.chain;
            if (method === "wallet_switchEthereumChain") {
              if (s.unknown) throw { code: 4902, message: "Unknown chain" };
              s.chain = params[0].chainId;
              (events.chainChanged || []).forEach((f) => f(s.chain));
              return null;
            }
            if (method === "wallet_addEthereumChain") {
              s.unknown = false;
              return null;
            }
            if (method === "eth_sendTransaction" && s.rejectSend)
              throw { code: 4001, message: "User rejected" };
            return window.walletRpc(method, params);
          },
        };
        window.emitWallet = (event, value) => {
          if (event === "accountsChanged") window.mockWallet.account = value[0];
          if (event === "chainChanged") window.mockWallet.chain = value;
          (events[event] || []).forEach((f) => f(value));
        };
      },
      { account, chainId: manifest.walletAddChain.chainId, wrong },
    );
  }
  await page.goto(url);
  if (!tamper)
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
}
async function connect() {
  await page
    .getByRole("button", { name: "Connect wallet", exact: false })
    .click();
  await expect(page.getByTestId("balance")).toHaveText("100 KUDO");
}
async function test(name, fn) {
  await fn();
  evidence.tests.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
}
async function shot(name) {
  await page.screenshot({
    path: fileURLToPath(new URL(`docs/evidence/${name}.png`, root)),
    fullPage: true,
  });
  evidence.screenshots.push(`${name}.png`);
}
try {
  await test("Production subpath loads; disconnected actions disabled; no wallet recovery", async () => {
    await open({ wallet: false });
    await expect(
      page.getByRole("button", { name: "Give 1 kudo", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Withdraw tips" }),
    ).toBeDisabled();
    await shot("desktop-disconnected");
    await page
      .getByRole("button", { name: "Connect wallet", exact: false })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "No browser wallet found" }),
    ).toBeVisible();
  });
  await test("Unknown wallet chain adds exact supplied chain, switches again, then enables actions", async () => {
    await open({ wrong: true });
    await connect();
    await expect(
      page.getByRole("button", { name: "Give 1 kudo", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Switch to Sepolia" }).click();
    await expect(
      page.getByRole("button", { name: "Give 1 kudo", exact: true }),
    ).toBeEnabled();
    const calls = await page.evaluate(() => window.mockWallet.calls);
    assert.deepEqual(
      calls.find((c) => c.method === "wallet_addEthereumChain").params,
      [manifest.walletAddChain],
    );
    assert.equal(
      calls.filter((c) => c.method === "wallet_switchEthereumChain").length,
      2,
    );
  });
  await test("Free give simulates and submits with zero tip and no approval", async () => {
    await page.getByLabel("Who made a difference?").fill(recipient);
    await page
      .getByRole("button", { name: "Give 1 kudo", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Kudos sent" }),
    ).toBeVisible();
    assert.equal(state.sends.length, 1);
    assert.equal(state.sends[0].functionName, "give");
    assert.deepEqual(state.sends[0].args, [recipient, 1n, 0n]);
    assert(state.simulations.includes("give"));
    await expect(page.locator(".remaining strong")).toHaveText("4");
  });
  await test("Tip total is count × per-kudo; exact approval precedes give; balances refresh", async () => {
    await page.getByLabel("2 kudos", { exact: true }).check();
    await page.getByLabel("Tip per kudo", { exact: true }).fill("2.5");
    await expect(
      page.getByRole("button", { name: "Give 2 kudos", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Approve 5 KUDO", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "✓ KUDO approved", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("allowance")).toHaveText("5 KUDO");
    const approval = state.sends.at(-1);
    assert.equal(approval.functionName, "approve");
    assert.equal(approval.args[0].toLowerCase(), app.address);
    assert.equal(approval.args[1], parseUnits("5", 18));
    await shot("desktop-connected-approval");
    await page
      .getByRole("button", { name: "Give 2 kudos", exact: true })
      .click();
    await expect(page.getByTestId("balance")).toHaveText("95 KUDO");
    await expect(page.getByTestId("allowance")).toHaveText("0 KUDO");
    assert.equal(state.sends.at(-1).functionName, "give");
    assert.deepEqual(state.sends.at(-1).args, [
      recipient,
      2n,
      parseUnits("2.5", 18),
    ]);
  });
  await test("Withdraw pulls entire credit and disables a second withdrawal", async () => {
    await page.getByRole("button", { name: "Withdraw tips" }).click();
    await expect(page.getByTestId("withdrawable")).toHaveText("0 KUDO");
    await expect(page.getByTestId("balance")).toHaveText("103 KUDO");
    await expect(
      page.getByRole("button", { name: "Withdraw tips" }),
    ).toBeDisabled();
    assert.equal(state.sends.at(-1).functionName, "withdraw");
  });
  await test("Invalid recipient, self, zero, count, precision, overflow and insufficient balance never request a transaction", async () => {
    await open();
    await connect();
    await page
      .getByRole("button", { name: "Give 1 kudo", exact: true })
      .click();
    await expect(page.locator("#form-error")).toContainText(
      "valid Ethereum address",
    );
    for (const invalid of [
      account,
      "0x0000000000000000000000000000000000000000",
    ]) {
      await page.getByLabel("Who made a difference?").fill(invalid);
      await page
        .getByRole("button", { name: "Give 1 kudo", exact: true })
        .click();
      await expect(page.locator("#form-error")).toContainText(
        "valid Ethereum address",
      );
    }
    await page.getByLabel("Who made a difference?").fill(recipient);
    for (const value of [
      "-1",
      "0.0000000000000000001",
      "1e3",
      "9999999999999999999999999999999999999999999999999999999999999999999999999999999999",
      "101",
    ]) {
      await page.getByLabel("Tip per kudo", { exact: true }).fill(value);
      await page.getByRole("button", { name: /^Approve / }).click();
      await expect(page.locator("#form-error")).not.toBeEmpty();
    }
    await page.getByLabel("Tip per kudo", { exact: true }).fill("0");
    state.remaining = 1n;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("5 kudos", { exact: true }).check();
    await page
      .getByRole("button", { name: "Give 5 kudos", exact: true })
      .click();
    await expect(page.locator("#form-error")).toContainText("remaining kudos");
    assert.equal(state.sends.length, 0);
  });
  await test("Wallet rejection and simulation errors are shown with no broadcast", async () => {
    await open();
    await page.evaluate(() => (window.mockWallet.rejectConnect = true));
    await page
      .getByRole("button", { name: "Connect wallet", exact: false })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Request declined" }),
    ).toBeVisible();
    await page.evaluate(() => (window.mockWallet.rejectConnect = false));
    await connect();
    await page.getByLabel("Who made a difference?").fill(recipient);
    state.rejectSimulation = true;
    await page
      .getByRole("button", { name: "Give 1 kudo", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "reverted" }),
    ).toBeVisible();
    assert.equal(state.sends.length, 0);
    state.rejectSimulation = false;
    await page.evaluate(() => (window.mockWallet.rejectSend = true));
    await page
      .getByRole("button", { name: "Give 1 kudo", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Request declined" }),
    ).toBeVisible();
    assert.equal(state.sends.length, 0);
  });
  await test("Account change during simulation prevents signing", async () => {
    await open();
    await connect();
    await page.getByLabel("Who made a difference?").fill(recipient);
    state.changeAccountDuringSimulation = true;
    await page
      .getByRole("button", { name: "Give 1 kudo", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "wallet account or network changed" }),
    ).toBeVisible();
    assert.equal(state.sends.length, 0);
  });
  await test("Account and chain events invalidate spending state", async () => {
    await open();
    await connect();
    await page.evaluate(() => window.emitWallet("chainChanged", "0x1"));
    await expect(
      page.getByRole("button", { name: "Switch to Sepolia" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Give 1 kudo", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => window.emitWallet("accountsChanged", []));
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: false }),
    ).toBeVisible();
  });
  await test("Leaderboard aggregates count by recipient, deduplicates logs and uses complete epoch range", async () => {
    await open();
    state.logs = [
      eventLog(recipient, 2n, parseUnits("5", 18), 0),
      eventLog(other, 1n, 0n, 1),
      eventLog(recipient, 3n, 0n, 2),
      eventLog(recipient, 3n, 0n, 2),
    ];
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(
      page.locator("tbody tr").first().locator("td").nth(1),
    ).toHaveText("5");
    await expect(
      page.locator("tbody tr").first().locator("td").nth(2),
    ).toHaveText("5");
    assert(
      state.logRanges.every((r) => r.topics[1] === toHex(0n, { size: 32 })),
    );
    assert(
      state.logRanges.some(
        (r) =>
          BigInt(r.fromBlock) === BigInt(manifest.deploymentBlock) &&
          BigInt(r.toBlock) === block,
      ),
    );
  });
  await test("Failed event range shows an error instead of a partial leaderboard", async () => {
    state.rejectLogs = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText(/Leaderboard unavailable/)).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });
  await test("Missing code, wrong RPC chain and token binding mismatch gate writes", async () => {
    await open();
    await connect();
    for (const key of ["missingCode", "wrongRpc", "wrongToken"]) {
      state[key] = true;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Give 1 kudo", exact: true }),
      ).toBeDisabled();
      await expect(page.locator(".notice.error").first()).toBeVisible();
      state[key] = false;
    }
  });
  await test("Changing a paid plan requires fresh approval; a new epoch blocks a stale give", async () => {
    await open(); await connect();
    await page.getByLabel("Who made a difference?").fill(recipient);
    await page.getByLabel("Tip per kudo", {exact:true}).fill("1");
    await page.getByRole("button", {name:"Approve 1 KUDO",exact:true}).click();
    await expect(page.getByRole("button",{name:"Give 1 kudo",exact:true})).toBeEnabled();
    await page.getByLabel("Tip per kudo", {exact:true}).fill("2");
    await expect(page.getByRole("button",{name:"Give 1 kudo",exact:true})).toBeDisabled();
    await page.getByLabel("Tip per kudo", {exact:true}).fill("0");
    state.epoch=1n;
    await page.getByRole("button",{name:"Give 1 kudo",exact:true}).click();
    await expect(page.getByRole("alert").filter({hasText:"new week has started"})).toBeVisible();
    assert.equal(state.sends.length,1);
  });
  await test("Keyboard-only connect, approve, give and withdraw flow", async () => {
    await open();
    async function tabTo(locator) {
      for(let i=0;i<35;i++) {
        await page.keyboard.press("Tab");
        if(await locator.evaluate(e=>e===document.activeElement)) return;
      }
      throw Error("Could not reach keyboard target");
    }
    await tabTo(page.getByRole("button",{name:"Connect wallet",exact:true}));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("balance")).toHaveText("100 KUDO");
    await tabTo(page.getByLabel("Who made a difference?"));
    await page.keyboard.type(recipient);
    await tabTo(page.getByLabel("Tip per kudo",{exact:true}));
    await page.keyboard.press("Control+A"); await page.keyboard.type("1");
    await tabTo(page.getByRole("button",{name:"Approve 1 KUDO",exact:true}));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button",{name:"Give 1 kudo",exact:true})).toBeEnabled();
    await tabTo(page.getByRole("button",{name:"Give 1 kudo",exact:true}));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("balance")).toHaveText("99 KUDO");
    await tabTo(page.getByRole("button",{name:"Withdraw tips",exact:true}));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("withdrawable")).toHaveText("0 KUDO");
    assert.deepEqual(state.sends.map(s=>s.functionName),["approve","give","withdraw"]);
  });
  await test("Tampered ABI refuses to initialize", async () => {
    await open({ tamper: true });
    await expect(page.getByRole("alert")).toContainText(
      "ABI verification failed",
    );
    await expect(
      page.getByRole("button", { name: "Reload deployment" }),
    ).toBeVisible();
  });
  await test("Desktop/mobile/intermediate reflow, keyboard focus, reduced motion and accessibility audit", async () => {
    await open();
    await connect();
    state.logs = [
      eventLog(recipient, 7n, parseUnits("10", 18), 0),
      eventLog(other, 3n, parseUnits("1.5", 18), 1),
    ];
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    const audits = [];
    for (const width of [1280, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `Overflow at ${width}`,
      );
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      audits.push({
        width,
        violations: audit.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            html: n.html,
            summary: n.failureSummary,
          })),
        })),
      });
      if (width === 390 || width === 320) await shot(`mobile-${width}`);
    }
    await page.keyboard.press("Tab");
    evidence.contrast = await page.evaluate(() => {
      const luminance = rgb => {
        const channels = rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v/255).map(v => v<=0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
        return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
      };
      const pairs = [
        ["Body", "body", "color", "html"],
        ["Secondary text on card", ".give-card .hint", "color", ".give-card"],
        ["Primary action", ".button.primary", "color", ".button.primary"],
        ["Wallet secondary text", ".wallet-caption", "color", ".wallet-card"],
        ["Selected count", ".count-option.selected", "color", ".count-option.selected"],
        ["Field focus", "#recipient", "outlineColor", ".give-card"],
        ["Wallet focus", ".wallet-card .address", "outlineColor", ".wallet-card"]
      ];
      return pairs.map(([name,foreground,property,background]) => {
        const e=document.querySelector(foreground); if(property==="outlineColor")e.focus();
        const fg=getComputedStyle(e)[property],bg=getComputedStyle(document.querySelector(background)).backgroundColor;
        const a=luminance(fg),b=luminance(bg);return {name,foreground:fg,background:bg,ratio:Number(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)),minimum:property==="outlineColor"?3:4.5};
      });
    });
    assert(evidence.contrast.every(p=>p.ratio>=p.minimum),JSON.stringify(evidence.contrast));
    evidence.accessibility = audits;
    assert(
      audits.every((a) => a.violations.length === 0),
      JSON.stringify(audits),
    );
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Tab");
    // Exercise native radio keyboard behavior and visible focus on the recipient field.
    await page.getByLabel("Who made a difference?").focus();
    await page.keyboard.type(recipient);
    assert(
      await page
        .getByLabel("Who made a difference?")
        .evaluate((e) => getComputedStyle(e).outlineStyle !== "none"),
    );
    await shot("desktop-keyboard-focus");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("2 kudos", { exact: true })).toBeChecked();
    await page.locator(".wallet-card .address").focus();
    await shot("desktop-wallet-focus");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".button.primary")
        .evaluate((e) => getComputedStyle(e).transitionDuration),
      "0s",
    );
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "32px"),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  });
  assert.equal(evidence.errors.length, 0, JSON.stringify(evidence.errors));
  assert.equal(
    evidence.resourceFailures.length,
    0,
    JSON.stringify(evidence.resourceFailures),
  );
  evidence.status = "passed";
} catch (e) {
  evidence.status = "failed";
  evidence.failure = e.stack;
  console.error(e);
  if (page) await shot("test-failure");
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL("docs/evidence/interactions.json", root),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
