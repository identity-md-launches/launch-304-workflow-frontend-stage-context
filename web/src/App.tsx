import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createWalletClient,
  custom,
  formatUnits,
  isAddress,
  parseUnits,
} from "viem";
import type { Address, Hash } from "viem";
import { publicClient, switchNetwork } from "./config";
import type { Config, Provider } from "./config";
import {
  amount,
  errorText,
  leaderboard,
  payment,
  shortAddress,
  snapshot,
} from "./chain";
import type { Snapshot } from "./chain";

type Wallet = { name: string; id: string; provider: Provider };
type Board = Awaited<ReturnType<typeof leaderboard>>;
function Flower({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={large ? "flower large" : "flower"}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <g fill="currentColor">
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse
            key={i}
            cx="50"
            cy="28"
            rx="12"
            ry="26"
            transform={`rotate(${i * 45} 50 50)`}
          />
        ))}
      </g>
      <circle cx="50" cy="50" r="10" fill="var(--paper)" />
    </svg>
  );
}
function AddressLink({ address, config }: { address: string; config: Config }) {
  return (
    <a
      className="address"
      href={`${config.manifest.network.explorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
      aria-label={`View address ${address} on explorer`}
    >
      <bdi>{shortAddress(address)}</bdi>
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}
export function App({ config }: { config: Config }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [data, setData] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [board, setBoard] = useState<Board>();
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [count, setCount] = useState(1);
  const [tip, setTip] = useState("0");
  const [fieldError, setFieldError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [approved, setApproved] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [txError, setTxError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const lock = useRef(false);
  const refreshing = useRef(false);
  const generation = useRef(0);
  const boardAbort = useRef<AbortController | undefined>(undefined);
  const recipientRef = useRef<HTMLInputElement>(null);
  const client = useMemo(
    () =>
      publicClient(
        config,
        walletChain === config.manifest.chainId ? provider : undefined,
      ),
    [config, provider, walletChain],
  );
  const wrongChain = !!account && walletChain !== config.manifest.chainId;
  const ready =
    !!account &&
    !!data &&
    data.account === account &&
    !wrongChain &&
    !readError &&
    !loading &&
    !busy;
  const planKey = `${account}:${data?.epoch}:${recipient.toLowerCase()}:${count}:${tip}`;
  let total = 0n;
  try {
    if (
      /^\d+(\.\d+)?$/.test(tip) &&
      (tip.split(".")[1]?.length || 0) <= (data?.decimals ?? 18)
    )
      total = parseUnits(tip, data?.decimals ?? 18) * BigInt(count);
  } catch {
    /* inline validation on action */
  }
  const paying = tip !== "" && !/^0*(\.0*)?$/.test(tip);
  const approvalDone =
    approved === planKey && !!data && (data.allowance ?? 0n) >= total;

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info: { name: string; uuid: string };
          provider: Provider;
        }>
      ).detail;
      if (typeof detail?.provider?.request === "function")
        setWallets((list) =>
          list.some((w) => w.provider === detail.provider)
            ? list
            : [
                ...list,
                {
                  name: detail.info.name,
                  id: detail.info.uuid,
                  provider: detail.provider,
                },
              ],
        );
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (window.ethereum)
      setWallets((list) =>
        list.length
          ? list
          : [
              {
                name: "Browser wallet",
                id: "injected",
                provider: window.ethereum!,
              },
            ],
      );
    return () =>
      window.removeEventListener("eip6963:announceProvider", announce);
  }, []);

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    refreshing.current = true;
    setLoading(true);
    setReadError("");
    boardAbort.current?.abort();
    try {
      const next = await snapshot(client, config, account);
      if (run !== generation.current) return;
      setData(next);
      setLoading(false);
      const abort = new AbortController();
      boardAbort.current = abort;
      setBoardLoading(true);
      setBoardError("");
      setBoard(undefined);
      try {
        const result = await leaderboard(client, config, next, abort.signal);
        if (run === generation.current) setBoard(result);
      } catch (error) {
        if (run === generation.current)
          setBoardError(
            `Leaderboard unavailable. ${errorText(error)} Use Refresh to retry; no partial ranking is shown.`,
          );
      } finally {
        if (run === generation.current) setBoardLoading(false);
      }
    } catch (error) {
      if (run === generation.current) {
        setData(undefined);
        setBoard(undefined);
        setBoardLoading(false);
        setLoading(false);
        setReadError(errorText(error));
      }
    } finally {
      if (run === generation.current) refreshing.current = false;
    }
  }, [account, client, config]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!lock.current && !refreshing.current) void refresh();
    }, 30000);
    return () => {
      window.clearInterval(timer);
      generation.current++;
      boardAbort.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(
        accounts[0] && isAddress(accounts[0]) ? accounts[0] : undefined,
      );
      setData(undefined);
      setApproved("");
      setFieldError("");
    };
    const chainChanged = (...args: unknown[]) => {
      setWalletChain(Number(args[0]));
      setData(undefined);
      setApproved("");
    };
    const disconnected = () => {
      setAccount(undefined);
      setWalletChain(undefined);
      setData(undefined);
      setApproved("");
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [provider]);

  async function connect() {
    if (walletBusy) return;
    setWalletBusy(true);
    setTxError("");
    try {
      const p =
        (wallets.find((w) => w.id === selected) || wallets[0])?.provider ||
        window.ethereum;
      if (!p)
        throw Error(
          "No browser wallet found. Open this page in an Ethereum wallet browser or enable a wallet extension, then try again.",
        );
      const accounts = (await p.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts[0] || !isAddress(accounts[0]))
        throw Error(
          "No account was shared. Choose an account in your wallet and try again.",
        );
      setProvider(p);
      setAccount(accounts[0]);
      setApproved("");
      setWalletChain(Number(await p.request({ method: "eth_chainId" })));
    } catch (error) {
      setTxError(errorText(error));
    } finally {
      setWalletBusy(false);
    }
  }
  async function changeNetwork() {
    if (!provider || walletBusy) return;
    setWalletBusy(true);
    setTxError("");
    try {
      await switchNetwork(provider, config);
      setWalletChain(Number(await provider.request({ method: "eth_chainId" })));
      setApproved("");
    } catch (error) {
      setTxError(errorText(error));
    } finally {
      setWalletBusy(false);
    }
  }
  async function transact(kind: "approve" | "give" | "withdraw") {
    if (!provider || !account || !ready || lock.current) return;
    setFieldError("");
    setTxError("");
    let planned: ReturnType<typeof payment> | undefined;
    if (kind !== "withdraw") {
      try {
        planned = payment(recipient.trim(), count, tip, data, account);
      } catch (error) {
        const message = errorText(error);
        const field = message.startsWith("Enter")
          ? "recipient"
          : message.startsWith("Choose")
            ? "count"
            : "tip";
        setFieldError(message);
        setErrorField(field);
        if (field === "recipient") recipientRef.current?.focus();
        else if (field === "count")
          document
            .querySelector<HTMLInputElement>("input[name=count]:checked")
            ?.focus();
        else document.getElementById("tip")?.focus();
        return;
      }
    }
    if (kind === "give" && planned!.total > 0n && !approvalDone) {
      setTxError("Approve the total KUDO tip first, then give kudos.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setHash(undefined);
    const signingAccount = account;
    const checkWallet = async () => {
      const [chain, accounts] = await Promise.all([
        provider.request({ method: "eth_chainId" }),
        provider.request({ method: "eth_accounts" }),
      ]);
      if (
        Number(chain) !== config.manifest.chainId ||
        (accounts as string[])[0]?.toLowerCase() !==
          signingAccount.toLowerCase()
      )
        throw Error(
          "Your wallet account or network changed. Refresh and review the action again.",
        );
    };
    try {
      setStatus("Checking the latest state…");
      await checkWallet();
      const fresh = await snapshot(client, config, signingAccount);
      if (kind !== "withdraw") {
        planned = payment(recipient.trim(), count, tip, fresh, signingAccount);
        if (fresh.epoch !== data?.epoch)
          throw Error(
            "A new week has started. Refresh and review your kudos before continuing.",
          );
        if (kind === "give" && planned.total > (fresh.allowance ?? 0n))
          throw Error("Allowance changed. Approve the total tip again.");
      } else if (!fresh.withdrawable)
        throw Error("No KUDO is currently available to withdraw.");
      const contract = kind === "approve" ? config.token : config.app;
      const functionName = kind === "approve" ? "approve" : kind;
      const args =
        kind === "approve"
          ? [config.app.address, planned!.total]
          : kind === "give"
            ? [planned!.to, planned!.count, planned!.tipPerKudo]
            : [];
      const simulation = await client.simulateContract({
        address: contract.address,
        abi: [
          ...contract.abi,
          ...(kind === "approve"
            ? []
            : config.token.abi.filter((a) => a.type === "error")),
        ],
        functionName,
        args,
        account: signingAccount,
      });
      await checkWallet();
      setStatus(
        kind === "approve"
          ? `Confirm approval for exactly ${amount(planned!.total, fresh.decimals)} KUDO in your wallet.`
          : kind === "give"
            ? `Confirm ${count} ${count === 1 ? "kudo" : "kudos"} with a total tip of ${amount(planned!.total, fresh.decimals)} KUDO in your wallet.`
            : `Confirm withdrawal of ${amount(fresh.withdrawable, fresh.decimals)} KUDO to your wallet.`,
      );
      const wallet = createWalletClient({
        chain: config.chain,
        transport: custom(provider),
      });
      const submitted = await wallet.writeContract(simulation.request);
      setHash(submitted);
      setStatus("Transaction submitted. Waiting for confirmation…");
      let replaced = false;
      const receipt = await client.waitForTransactionReceipt({
        hash: submitted,
        confirmations: 1,
        timeout: 180000,
        onReplaced: (replacement) => {
          setHash(replacement.transactionReceipt.transactionHash);
          if (replacement.reason !== "repriced") replaced = true;
        },
      });
      if (replaced)
        throw Error(
          "Transaction was replaced or cancelled. Check the explorer, then refresh before retrying.",
        );
      if (receipt.status !== "success")
        throw Error(
          "Transaction reverted. Check the explorer, refresh your balances and try again.",
        );
      if (kind === "approve") {
        setApproved(planKey);
        setStatus(
          "Approval confirmed. Review the recipient and total, then give kudos.",
        );
      } else {
        setApproved("");
        setStatus(
          kind === "give"
            ? "Kudos sent. Your appreciation is onchain."
            : "Tips withdrawn to your wallet.",
        );
      }
      await refresh();
    } catch (error) {
      setTxError(errorText(error));
      setStatus("");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const weekEnd = data
    ? new Date(
        Number(data.start + (data.epoch + 1n) * data.duration) * 1000,
      ).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Loading…";
  const gate = !account
    ? "Connect your wallet to give kudos and see your balances."
    : wrongChain
      ? `Switch to ${config.manifest.network.name} to continue.`
      : readError
        ? "Live state could not be verified. Refresh to try again."
        : loading
          ? "Checking live balances…"
          : data?.remaining === 0n
            ? "You’ve given all five kudos. Come back next week."
            : "Kudos are free. A small Sepolia ETH gas fee still applies.";
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="shell header">
        <a className="wordmark" href="#main" aria-label="Kudos home">
          <Flower />
          <span>
            kudos<span className="wordmark-dot">.</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="network-tag">
            <span className="dot" />
            {config.manifest.network.name} testnet
          </span>
          {wallets.length > 1 && !account && (
            <label className="wallet-choice">
              Wallet
              <select
                aria-label="Choose wallet"
                value={selected || wallets[0].id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button secondary"
            disabled={walletBusy || busy}
            onClick={() =>
              account
                ? (setAccount(undefined),
                  setProvider(undefined),
                  setWalletChain(undefined),
                  setData(undefined),
                  setApproved(""))
                : void connect()
            }
          >
            {walletBusy
              ? "Connecting…"
              : account
                ? "Disconnect wallet"
                : "Connect wallet"}
            <span aria-hidden="true"> ↗</span>
          </button>
        </div>
      </header>
      <main id="main" className="shell">
        <section className="intro" aria-labelledby="headline">
          <div>
            <p className="eyebrow">A little appreciation goes a long way</p>
            <h1 id="headline">
              Give credit.
              <br />
              <span>Make someone’s week.</span>
            </h1>
            <p>
              Five kudos to give, every week. Recognize a good deed,
              <br className="desktop-break" /> say thanks, and add a little KUDO
              if you like.
            </p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <Flower large />
            <span>Good work deserves kudos.</span>
          </div>
        </section>
        <div className="week-bar">
          <span>
            <span className="dot" />
            {data ? `Week ${data.epoch + 1n}` : "Weekly kudos"}
            <span className="week-detail"> · Resets {weekEnd}</span>
          </span>
          <button
            className="text-button"
            onClick={() => void refresh()}
            disabled={loading || busy}
          >
            <span aria-hidden="true">↻ </span>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {wrongChain && (
          <div className="notice warning">
            <p>
              Your wallet is on another network. This page uses{" "}
              {config.manifest.network.name}.
            </p>
            <button
              className="button secondary"
              disabled={walletBusy || busy}
              onClick={() => void changeNetwork()}
            >
              Switch to {config.manifest.network.name}
            </button>
          </div>
        )}
        {readError && (
          <p className="notice error" role="alert">
            {readError}
          </p>
        )}
        <div className="workspace">
          <section className="card give-card" aria-labelledby="give-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Pass it on</p>
                <h2 id="give-title">Give kudos</h2>
              </div>
              <span className="small-flower" aria-hidden="true">
                ✳
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void transact("give");
              }}
              noValidate
            >
              <fieldset disabled={busy}>
                <label htmlFor="recipient">Who made a difference?</label>
                <input
                  ref={recipientRef}
                  id="recipient"
                  name="recipient"
                  className="recipient"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="0x… recipient address"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setApproved("");
                    setFieldError("");
                  }}
                  aria-invalid={!!fieldError && errorField === "recipient"}
                  aria-describedby="recipient-hint form-error"
                />
                <p id="recipient-hint" className="hint">
                  Use someone else’s Ethereum wallet address.
                </p>
                <fieldset
                  className="count-field"
                  aria-invalid={!!fieldError && errorField === "count"}
                  aria-describedby="form-error"
                >
                  <legend>How many kudos?</legend>
                  <div className="count-options">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label
                        key={n}
                        className={`count-option ${count === n ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="count"
                          value={n}
                          checked={count === n}
                          onChange={() => {
                            setCount(n);
                            setApproved("");
                            setFieldError("");
                          }}
                        />
                        <span>
                          {n}
                          <span className="sr-only">
                            {" "}
                            {n === 1 ? "kudo" : "kudos"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="tip-heading">
                  <label htmlFor="tip">Tip per kudo</label>
                  <span className="optional">Optional</span>
                </div>
                <div className="amount-input">
                  <input
                    id="tip"
                    name="tip"
                    aria-invalid={!!fieldError && errorField === "tip"}
                    inputMode="decimal"
                    autoComplete="off"
                    value={tip}
                    onChange={(e) => {
                      setTip(e.target.value);
                      setApproved("");
                      setFieldError("");
                    }}
                    aria-describedby="tip-hint form-error"
                  />
                  <span>KUDO</span>
                </div>
                <p id="tip-hint" className="hint">
                  Leave at 0 to send appreciation without a token tip.
                </p>
              </fieldset>
              <div className="payment-summary">
                <span>
                  Total tip{" "}
                  <span className="muted">
                    ({count} × {tip || "0"})
                  </span>
                </span>
                <strong>{formatUnits(total, data?.decimals ?? 18)} KUDO</strong>
              </div>
              {paying && (
                <div className="approval-note">
                  <p>
                    <strong>1. Approve KUDO</strong> for this tip.{" "}
                    <strong>2. Give kudos</strong> to pay it.
                  </p>
                  <p>
                    Approval lets KudosEpochs spend exactly the total shown.
                    Each step requires a wallet confirmation and gas.
                  </p>
                  <button
                    type="button"
                    className={`button ${approvalDone ? "secondary" : "primary"} full`}
                    disabled={!ready || approvalDone}
                    onClick={() => void transact("approve")}
                  >
                    {approvalDone
                      ? "✓ KUDO approved"
                      : `Approve ${formatUnits(total, data?.decimals ?? 18)} KUDO`}
                  </button>
                </div>
              )}
              <p id="form-error" className="field-error" role="alert">
                {fieldError}
              </p>
              <button
                type="submit"
                className={`button ${paying && !approvalDone ? "secondary" : "primary"} full`}
                disabled={
                  !ready || data?.remaining === 0n || (paying && !approvalDone)
                }
              >
                {busy
                  ? "Waiting for wallet / confirmation…"
                  : `Give ${count} ${count === 1 ? "kudo" : "kudos"}`}
                <span aria-hidden="true"> ↗</span>
              </button>
              <p className="hint gate">{gate}</p>
            </form>
          </section>
          <aside className="wallet-column" aria-label="Your kudos and wallet">
            <section className="wallet-card" aria-labelledby="wallet-title">
              <div className="section-heading">
                <h2 id="wallet-title">Your week</h2>
                <span className="wallet-icon" aria-hidden="true">
                  ✦
                </span>
              </div>
              <p className="wallet-caption">Kudos left to give</p>
              <div className="remaining">
                <strong>
                  {account ? (data?.remaining?.toString() ?? "—") : "—"}
                </strong>
                <span>/ {data?.limit.toString() ?? "5"}</span>
              </div>
              <div className="kudos-dots" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    className={
                      account &&
                      data?.remaining !== undefined &&
                      data.remaining >= BigInt(n)
                        ? "available"
                        : ""
                    }
                    key={n}
                  >
                    ✳
                  </span>
                ))}
              </div>
              <p className="wallet-explainer">
                A fresh five each week.
                <br />
                Unused kudos don’t roll over.
              </p>
              <div className="wallet-divider" />
              <div className="wallet-connection">
                {account ? (
                  <>
                    <span>Connected wallet</span>
                    <AddressLink address={account} config={config} />
                  </>
                ) : (
                  <>
                    <span>No wallet connected</span>
                    <button
                      className="wallet-link"
                      onClick={() => void connect()}
                      disabled={walletBusy}
                    >
                      Connect to get started ↗
                    </button>
                  </>
                )}
              </div>
            </section>
            <section
              className="card balance-card"
              aria-labelledby="balance-title"
            >
              <h2 id="balance-title">Your KUDO</h2>
              <dl className="balances">
                <div>
                  <dt>Wallet balance</dt>
                  <dd data-testid="balance">
                    {amount(data?.balance, data?.decimals)} <span>KUDO</span>
                  </dd>
                </div>
                <div>
                  <dt>App allowance</dt>
                  <dd data-testid="allowance">
                    {amount(data?.allowance, data?.decimals)} <span>KUDO</span>
                  </dd>
                </div>
                <div className="withdraw-row">
                  <dt>Ready to withdraw</dt>
                  <dd data-testid="withdrawable">
                    {amount(data?.withdrawable, data?.decimals)}{" "}
                    <span>KUDO</span>
                  </dd>
                </div>
              </dl>
              <button
                className="button secondary full"
                disabled={!ready || !data?.withdrawable}
                onClick={() => void transact("withdraw")}
              >
                Withdraw tips <span aria-hidden="true">↗</span>
              </button>
              <p className="hint">
                Collect all received tips into your connected wallet.
              </p>
              {account && data && (
                <p className="personal-stats">
                  {data.received?.toString()} kudos received this week ·{" "}
                  {data.lifetime?.toString()} all time
                  <br />
                  {amount(data.tips, data.decimals)} KUDO in lifetime tips
                </p>
              )}
            </section>
          </aside>
        </div>
        <div className="transaction-message" aria-live="polite" role="status">
          {status && <p className="notice">{status}</p>}
        </div>
        <div role="alert">
          {txError && <p className="notice error">{txError}</p>}
        </div>
        {hash && (
          <p className="tx-link">
            <a
              href={`${config.manifest.network.explorer}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction on explorer ↗
            </a>
            <span className="hint">
              {" "}
              If confirmation is delayed, check this transaction before
              retrying.
            </span>
          </p>
        )}
        <section
          className="leaderboard card"
          aria-labelledby="leaderboard-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">A little recognition</p>
              <h2 id="leaderboard-title">This week’s leaderboard</h2>
            </div>
            <span className="chip">
              {data ? `Week ${data.epoch + 1n}` : "Current week"}
            </span>
          </div>
          <p className="muted">
            People receiving kudos this week. Ranked by appreciation, not tips.
          </p>
          {boardLoading ? (
            <p className="empty" role="status">
              Reading this week’s Kudos events…
            </p>
          ) : boardError ? (
            <p className="empty error" role="alert">
              {boardError}
            </p>
          ) : !board ? (
            <p className="empty">Waiting for verified chain data.</p>
          ) : board.leaders.length === 0 ? (
            <div className="empty">
              <span className="empty-star" aria-hidden="true">
                ✳
              </span>
              <h3>A fresh week of possibilities</h3>
              <p>
                No kudos yet this week. Be the first to give someone credit.
              </p>
              <a href="#give-title">Give the first kudos ↑</a>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  Current week kudos recipients
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Recipient</th>
                    <th scope="col">Kudos</th>
                    <th scope="col">Tips (KUDO)</th>
                  </tr>
                </thead>
                <tbody>
                  {board.leaders.map((leader, i) => (
                    <tr key={leader.address}>
                      <td>{i + 1}</td>
                      <th scope="row">
                        <AddressLink config={config} address={leader.address} />
                        {leader.address === account?.toLowerCase() && (
                          <span className="you-tag">You</span>
                        )}
                      </th>
                      <td>{leader.count.toString()}</td>
                      <td>{amount(leader.tip, data?.decimals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {board && (
            <p className="hint provenance">
              From onchain events · Blocks {board.from.toString()}–
              {board.to.toString()} · Refreshed every 30 seconds
            </p>
          )}
        </section>
        <section className="how-it-works" aria-label="About kudos">
          <div>
            <span className="step-label">01 / Recognize</span>
            <h3>Five chances to say thanks.</h3>
            <p>
              Each address gets five non-transferable kudos per week. A week
              starts at deployment, not on Monday.
            </p>
          </div>
          <div>
            <span className="step-label">02 / Add a little extra</span>
            <h3>Free kudos. Optional KUDO.</h3>
            <p>
              Kudos are counts; KUDO is the token. Get KUDO by swapping Sepolia
              ETH in the launch pool, outside this page.
            </p>
          </div>
          <div>
            <span className="step-label">03 / Keep it in perspective</span>
            <h3>Appreciation, not proof.</h3>
            <p>
              Anyone can use multiple wallets. Kudos aren’t verified reputation.
              Tips only move the giver’s own KUDO.
            </p>
          </div>
        </section>
      </main>
      <footer className="shell footer">
        <span>Small gestures. Onchain.</span>
        <div>
          <a
            href={`${config.manifest.network.explorer}/address/${config.app.address}`}
            target="_blank"
            rel="noreferrer"
          >
            KudosEpochs ↗
          </a>
          <a
            href={`${config.manifest.network.explorer}/address/${config.token.address}`}
            target="_blank"
            rel="noreferrer"
          >
            KUDO token ↗
          </a>
          <a href="./imd-deployment.json">Deployment details ↗</a>
        </div>
        <p>
          Sepolia testnet · You’ll need Sepolia ETH for gas. No admin, no
          custody of ETH.
        </p>
      </footer>
    </>
  );
}
