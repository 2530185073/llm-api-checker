import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80")) return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function privateTargetsAllowed(): boolean {
  const flag = process.env.ALLOW_PRIVATE_TARGETS;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Requests to this app's own built-in demo endpoint are sent over loopback, so they work behind
 * any ingress and are exempt from the private-address block.
 */
export async function resolveTarget(baseUrl: string, requestHost: string | null): Promise<string> {
  const url = new URL(baseUrl);
  if (requestHost && url.host === requestHost && url.pathname.startsWith("/api/mock/")) {
    const port = process.env.PORT || "3000";
    return `http://127.0.0.1:${port}${url.pathname}`;
  }
  if (privateTargetsAllowed()) return baseUrl;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("出于安全考虑，公网部署默认禁止访问内网地址（可设置 ALLOW_PRIVATE_TARGETS=1 放开）");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw new Error(`无法解析域名 ${host}`);
  });
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("出于安全考虑，公网部署默认禁止访问内网地址（可设置 ALLOW_PRIVATE_TARGETS=1 放开）");
  }
  return baseUrl;
}
