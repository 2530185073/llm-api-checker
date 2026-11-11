// Downloads the fingerprint reference data (~3.6 MB) into the cache file so the first check does not wait for it.
import { loadDetector } from "lmfpd-sdk";

const cache = process.env.LMFPD_CACHE || "/tmp/lmfpd/data.bin";
const detector = await loadDetector({ cache, ttl: 7 * 86400 });
console.log(`lmfpd reference data ready: built ${detector.builtAt}, cache ${cache}`);
