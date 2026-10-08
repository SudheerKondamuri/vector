"use client";

import { useMemo, useState } from "react";
import { Check, Coins, LoaderCircle, ShieldAlert } from "lucide-react";
import { encodeFunctionData } from "viem";
import { jsonBody, pilotRequest } from "../../lib/pilot-client";
import { ERC20_ABI, VECTOR_ESCROW_ABI } from "../../lib/settlement";
import type { EscrowRecord, PilotSubmission, PilotTask, PilotUser } from "../../lib/pilot-types";
import { getWalletProvider } from "./wallet-connect-button";

const address = /^0x[a-fA-F0-9]{40}$/;
const txHash = /^0x[a-fA-F0-9]{64}$/;

async function receipt(provider: Awaited<ReturnType<typeof getWalletProvider>>, hash: string): Promise<{ logs?: Array<{ topics?: string[] }> }> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { status?: string; logs?: Array<{ topics?: string[] }> } | null;
    if (value) {
      if (value.status && value.status !== "0x1") throw new Error("The wallet transaction reverted.");
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("The transaction was not confirmed within one minute.");
}

function send(provider: Awaited<ReturnType<typeof getWalletProvider>>, from: string, to: string, data: string): Promise<string> {
  return provider.request({ method: "eth_sendTransaction", params: [{ from, to, data }] }) as Promise<string>;
}

function onchainId(logs?: Array<{ topics?: string[] }>): string | undefined {
  const topic = logs?.find(log => log.topics && log.topics.length > 1)?.topics?.[1];
  return topic ? BigInt(topic).toString() : undefined;
}

export function SettlementPanel({ task, submission, escrow, user, onChanged }: { task: PilotTask; submission?: PilotSubmission; escrow?: EscrowRecord; user: PilotUser; onChanged: () => void }) {
  const owner = task.ownerId === user.id;
  const accepted = submission || (task.acceptedSubmissionId ? undefined : undefined);
  const [operatorAddress, setOperatorAddress] = useState(escrow?.operatorAddress || "");
  const [amountAtomic, setAmountAtomic] = useState(escrow?.amountAtomic || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const configured = useMemo(() => ({ token: process.env.NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_ADDRESS || "", contract: process.env.NEXT_PUBLIC_BASE_SEPOLIA_ESCROW_ADDRESS || "" }), []);

  if (!submission || !["accepted", "rejected"].includes(submission.status)) return null;

  async function wallet(): Promise<{ provider: Awaited<ReturnType<typeof getWalletProvider>>; account: string }> {
    const provider = await getWalletProvider();
    await provider.connect();
    const accounts = await provider.request({ method: "eth_accounts" }) as string[];
    if (!accounts[0] || !address.test(accounts[0])) throw new Error("Connect a wallet before starting settlement.");
    return { provider, account: accounts[0] };
  }

  async function fund() {
    if (!operatorAddress || !address.test(operatorAddress)) { setError("Enter the operator's 0x wallet address."); return; }
    if (!configured.token || !configured.contract) { setError("Base Sepolia token and escrow contract addresses are not configured."); return; }
    if (!/^\d+$/.test(amountAtomic) || BigInt(amountAtomic) <= BigInt(0)) { setError("Enter a positive integer token amount in the token's smallest unit."); return; }
    setBusy(true); setError("");
    try {
      const { provider, account } = await wallet();
      const intent = await pilotRequest<{ escrow: EscrowRecord }>(`/tasks/${task.id}/escrow-intent`, jsonBody({ sponsorAddress: account, operatorAddress, tokenAddress: configured.token, contractAddress: configured.contract, amountAtomic, chainId: 84532, challengePeriodSeconds: 172800 }));
      const approval = await send(provider, account, configured.token, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [configured.contract as `0x${string}`, BigInt(amountAtomic)] }));
      await receipt(provider, approval);
      const creation = await send(provider, account, configured.contract, encodeFunctionData({ abi: VECTOR_ESCROW_ABI, functionName: "createEscrow", args: [operatorAddress as `0x${string}`, configured.token as `0x${string}`, BigInt(amountAtomic), intent.escrow.taskHash as `0x${string}`, intent.escrow.policyHash as `0x${string}`, BigInt(172800)] }));
      const creationReceipt = await receipt(provider, creation);
      await pilotRequest(`/escrows/${intent.escrow.id}/funding`, jsonBody({ txHash: creation, onchainEscrowId: onchainId(creationReceipt.logs) }));
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settlement funding failed."); }
    finally { setBusy(false); }
  }

  async function transaction(action: "requestRelease" | "challenge" | "finalizeRelease" | "resolveChallenge", releaseToOperator?: boolean) {
    if (!escrow?.onchainEscrowId) { setError("Wait for the funding event to be reconciled before continuing."); return; }
    setBusy(true); setError("");
    try {
      const { provider, account } = await wallet();
      const data = action === "resolveChallenge"
        ? encodeFunctionData({ abi: VECTOR_ESCROW_ABI, functionName: "resolveChallenge", args: [BigInt(escrow.onchainEscrowId), Boolean(releaseToOperator)] })
        : encodeFunctionData({ abi: VECTOR_ESCROW_ABI, functionName: action, args: [BigInt(escrow.onchainEscrowId)] });
      const hash = await send(provider, account, escrow.contractAddress, data);
      await receipt(provider, hash);
      const endpoint = action === "requestRelease" ? "release-request" : action === "challenge" ? "challenge" : action === "finalizeRelease" ? "finalize" : `resolve-challenge?releaseToOperator=${releaseToOperator ? "true" : "false"}`;
      await pilotRequest(`/escrows/${escrow.id}/${endpoint}`, jsonBody({ txHash: hash }));
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settlement transaction failed."); }
    finally { setBusy(false); }
  }

  const challengeOpen = escrow?.status === "release-pending" && !!escrow.challengeEndsAt && Date.parse(escrow.challengeEndsAt) > Date.now();
  return <section className="vp-panel vp-detail-section" aria-labelledby="vp-settlement-title"><div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">05 / SETTLEMENT</p><h2 id="vp-settlement-title">Base Sepolia escrow</h2></div><span className="vp-badge">{escrow?.status || "Not funded"}</span></div><p className="vp-muted">Testnet ERC-20 settlement is non-custodial. Vector never receives wallet keys or treats testnet tokens as production payment.</p>{error && <p className="vp-error" role="alert">{error}</p>}{owner && !escrow && <div className="vp-grid vp-detail-form-grid"><label className="vp-field"><span>Operator wallet address</span><input value={operatorAddress} onChange={event => setOperatorAddress(event.target.value)} placeholder="0x…" spellCheck={false} /></label><label className="vp-field"><span>Token amount · smallest unit</span><input value={amountAtomic} onChange={event => setAmountAtomic(event.target.value)} placeholder="1000000" inputMode="numeric" /></label><div className="vp-detail-actions vp-detail-full"><button type="button" className="vp-button" onClick={() => void fund()} disabled={busy}><Coins size={15} aria-hidden="true" />{busy ? "Funding…" : "Approve and fund escrow"}</button></div></div>}{escrow && <div className="vp-detail-settlement"><dl className="vp-detail-metadata"><div><dt>Amount</dt><dd className="vp-detail-mono">{escrow.amountAtomic}</dd></div><div><dt>On-chain escrow</dt><dd className="vp-detail-mono">{escrow.onchainEscrowId || "Awaiting reconciliation"}</dd></div><div><dt>Challenge period</dt><dd>{escrow.challengeEndsAt ? new Date(escrow.challengeEndsAt).toLocaleString() : "Begins after release request"}</dd></div></dl><div className="vp-detail-actions">{owner && escrow.status === "funded" && <button type="button" className="vp-button" onClick={() => void transaction("requestRelease")} disabled={busy}><Check size={15} aria-hidden="true" />Request release</button>}{owner && escrow.status === "release-pending" && !challengeOpen && <button type="button" className="vp-button" onClick={() => void transaction("finalizeRelease")} disabled={busy}>Finalize release</button>}{!owner && escrow.status === "release-pending" && challengeOpen && <button type="button" className="vp-button-danger" onClick={() => void transaction("challenge")} disabled={busy}><ShieldAlert size={15} aria-hidden="true" />Challenge release</button>}{owner && escrow.status === "challenged" && <><button type="button" className="vp-button" onClick={() => void transaction("resolveChallenge", true)} disabled={busy}>Resolve in operator&apos;s favor</button><button type="button" className="vp-button-secondary" onClick={() => void transaction("resolveChallenge", false)} disabled={busy}>Refund sponsor</button></>}</div></div>}</section>;
}
