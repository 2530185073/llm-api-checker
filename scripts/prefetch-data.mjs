// Downloads the fingerprint reference data (~3.6 MB) into the cache file so the first check does not wait for it.
import { readFile } from "node:fs/promises";
import { loadDetector } from "lmfpd-sdk";

const cache = process.env.LMFPD_CACHE || "/tmp/lmfpd/data.bin";
const ttl = Math.max(60, Number(process.env.LMFPD_TTL_SEC) || 86_400);
const source = process.env.LMFPD_DATA_SOURCE?.trim() || undefined;
const detector = await loadDetector(source ? { source, cache, ttl } : { cache, ttl });

let models = "";
try {
  const bytes = await readFile(cache);
  const len = bytes.readUInt32LE(0);
  const bundle = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len)));
  if (Array.isArray(bundle?.models)) models = `, ${bundle.models.length} models`;
} catch {}

console.log(`lmfpd reference data ready: built ${detector.builtAt}${models}, cache ${cache}`);
