import { CLAUDE_CASES } from "./cases/claude";
import { DEEPSEEK_CASES } from "./cases/deepseek";
import { GEMINI_CASES } from "./cases/gemini";
import { GLM_CASES } from "./cases/glm";
import { KIMI_CASES } from "./cases/kimi";
import { OPENAI_CASES } from "./cases/openai";
import type { CaseDef } from "./engine";
import type { CaseInfo, Vendor } from "./types";

export const CASES: Record<Vendor, CaseDef[]> = {
  claude: CLAUDE_CASES,
  openai: OPENAI_CASES,
  gemini: GEMINI_CASES,
  glm: GLM_CASES,
  kimi: KIMI_CASES,
  deepseek: DEEPSEEK_CASES,
};

export function caseInfos(): Record<Vendor, CaseInfo[]> {
  const out = {} as Record<Vendor, CaseInfo[]>;
  for (const [v, list] of Object.entries(CASES) as [Vendor, CaseDef[]][]) {
    out[v] = list.map(({ id, vendor, section, title, weight, officialWeight, tags, desc, needsRef, needsSecond, protocols }) => ({
      id,
      vendor,
      section,
      title,
      weight,
      officialWeight,
      tags,
      desc,
      needsRef,
      needsSecond,
      protocols,
    }));
  }
  return out;
}

export const defaultSelection = (v: Vendor) => CASES[v].filter((c) => !c.tags.includes("optional")).map((c) => c.id);
