import { afterEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => dns);
import { assertPublicRepositoryUrl, isPrivateAddress } from "../../lib/production/external-verifier";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("external verifier network policy", () => {
  it.each(["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.2", "172.16.0.1", "192.168.1.1", "100.64.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "invalid"])("rejects non-public address %s", address => {
    expect(isPrivateAddress(address)).toBe(true);
  });
  it.each(["8.8.8.8", "140.82.112.3", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"])("allows public address %s", address => {
    expect(isPrivateAddress(address)).toBe(false);
  });
  it.each(["http://github.com/org/repo", "https://user:password@github.com/org/repo", "https://github.com:444/org/repo", "https://github.com/org/repo#main", "https://github.com/org/repo?redirect=local", "https://github.com.example/org/repo", "https://127.0.0.1/repo"])("rejects unsafe repository URL %s before DNS", async url => {
    await expect(assertPublicRepositoryUrl(url)).rejects.toThrow();
    expect(dns.lookup).not.toHaveBeenCalled();
  });
  it("accepts an allowlisted public dual-stack host", async () => {
    dns.lookup.mockResolvedValue([{ address: "140.82.112.3", family: 4 }, { address: "2606:4700::1111", family: 6 }]);
    expect((await assertPublicRepositoryUrl("https://github.com/org/repo.git")).hostname).toBe("github.com");
  });
  it("rejects mixed public/private DNS answers and empty answers", async () => {
    dns.lookup.mockResolvedValue([{ address: "140.82.112.3", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(assertPublicRepositoryUrl("https://github.com/org/repo")).rejects.toThrow(/private/);
    dns.lookup.mockResolvedValue([]);
    await expect(assertPublicRepositoryUrl("https://github.com/org/repo")).rejects.toThrow(/network/);
  });
});
