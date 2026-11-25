import { CheckerApp } from "@/components/checker/checker-app";
import type { CaseCatalog } from "@/components/checker/case-checklist";
import { VENDOR_LABEL } from "@/lib/composition/facts";
import { caseInfos, defaultSelection } from "@/lib/composition/registry";
import type { Vendor } from "@/lib/composition/types";

export default function Home() {
  const cases = caseInfos();
  const defaults = Object.fromEntries((Object.keys(cases) as Vendor[]).map((v) => [v, defaultSelection(v)])) as Record<Vendor, string[]>;
  const initialCatalog: CaseCatalog = { cases, defaults, labels: VENDOR_LABEL };
  return <CheckerApp initialCatalog={initialCatalog} />;
}
