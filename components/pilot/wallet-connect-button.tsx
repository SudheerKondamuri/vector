"use client";

import { useEffect, useRef, useState } from "react";
import { WalletCards, LoaderCircle, Unplug } from "lucide-react";
import { BASE_SEPOLIA_HEX_CHAIN_ID } from "../../lib/settlement";

export type Provider = { connect: () => Promise<void>; disconnect: () => Promise<void>; request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (event: string, callback: (...args: unknown[]) => void) => void; removeListener?: (event: string, callback: (...args: unknown[]) => void) => void };
let providerPromise: Promise<Provider> | undefined;

export async function getWalletProvider(): Promise<Provider> {
  if (!providerPromise) providerPromise = (async () => {
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    if (!projectId) throw new Error("WalletConnect is not configured for this deployment.");
    const walletModule = await import("@walletconnect/ethereum-provider");
    return await walletModule.default.init({ projectId, chains: [84532], optionalChains: [84532], showQrModal: true, rpcMap: { 84532: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org" }, metadata: { name: "Vector", description: "Evidence-backed technical work", url: window.location.origin, icons: [] } }) as unknown as Provider;
  })();
  return providerPromise;
}

export function WalletConnectButton() {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listener = useRef<((...args: unknown[]) => void) | null>(null);
  useEffect(() => () => { if (listener.current) void providerPromise?.then(provider => provider.removeListener?.("accountsChanged", listener.current!)); }, []);

  async function connect() {
    setBusy(true); setError("");
    try {
       const provider = await getWalletProvider();
      await provider.connect();
      const chainId = await provider.request({ method: "eth_chainId" });
      if (String(chainId).toLowerCase() !== BASE_SEPOLIA_HEX_CHAIN_ID) {
        try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA_HEX_CHAIN_ID }] }); }
        catch { await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: BASE_SEPOLIA_HEX_CHAIN_ID, chainName: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] }] }); }
      }
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      setAddress(accounts[0] || "");
      listener.current = (next: unknown) => setAddress(Array.isArray(next) ? String(next[0] || "") : "");
      provider.on?.("accountsChanged", listener.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet connection failed."); }
    finally { setBusy(false); }
  }
  async function disconnect() { setBusy(true); setError(""); try { await (await getWalletProvider()).disconnect(); setAddress(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet disconnect failed."); } finally { setBusy(false); } }
  return <div className="vp-wallet-connect"><button type="button" className="vp-button-secondary" onClick={() => void (address ? disconnect() : connect())} disabled={busy}>{busy ? <LoaderCircle className="vp-spin" size={15} aria-hidden="true" /> : address ? <Unplug size={15} aria-hidden="true" /> : <WalletCards size={15} aria-hidden="true" />}{busy ? "Connecting…" : address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect WalletConnect"}</button>{error && <span className="vp-wallet-error" role="alert">{error}</span>}</div>;
}
