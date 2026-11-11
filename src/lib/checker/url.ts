import type { Protocol } from "./types";

const ENDPOINT_SUFFIX = /\/(chat\/completions|responses|messages|models)\/?$/i;

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("请填写 Base URL");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Base URL 只支持 http/https");
  if (url.username || url.password) throw new Error("Base URL 不能包含用户名或密码");
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(ENDPOINT_SUFFIX, "").replace(/\/+$/, "");
  if (!path) path = "/v1";
  return `${url.origin}${path}`;
}

export function endpointUrl(baseUrl: string, protocol: Protocol): string {
  const path = protocol === "chat" ? "/chat/completions" : protocol === "responses" ? "/responses" : "/messages";
  return baseUrl + path;
}

export function modelsUrl(baseUrl: string): string {
  return `${baseUrl}/models`;
}

export function redact(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join("[REDACTED]");
}
