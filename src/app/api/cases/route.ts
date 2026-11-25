import { getDetectorMeta } from "@/lib/checker/fingerprint";
import { VENDOR_LABEL } from "@/lib/composition/facts";
import { caseInfos, defaultSelection } from "@/lib/composition/registry";
import type { Vendor } from "@/lib/composition/types";

export async function GET() {
  const cases = caseInfos();
  const defaults = Object.fromEntries((Object.keys(cases) as Vendor[]).map((v) => [v, defaultSelection(v)]));
  const detector = await getDetectorMeta();
  return Response.json({ cases, defaults, labels: VENDOR_LABEL, detector });
}
