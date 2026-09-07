export const PRIMARY = ["Focus", "Power", "Agility", "Toughness"];
export const SECONDARY = ["Fitness", "Cunning", "Reason", "Awareness", "Presence"];
export const SKILLS = [
  {
    "key": "athletics",
    "label": "Athletics",
    "stat": "fitness"
  },
  {
    "key": "riding",
    "label": "Riding",
    "stat": "fitness"
  },
  {
    "key": "deception",
    "label": "Deception",
    "stat": "cunning"
  },
  {
    "key": "roguecraft",
    "label": "Roguecraft",
    "stat": "cunning"
  },
  {
    "key": "stealth",
    "label": "Stealth",
    "stat": "cunning"
  },
  {
    "key": "appraise",
    "label": "Appraise",
    "stat": "reason"
  },
  {
    "key": "artifice",
    "label": "Artifice",
    "stat": "reason"
  },
  {
    "key": "common_knowledge",
    "label": "Common Knowledge",
    "stat": "reason"
  },
  {
    "key": "flight",
    "label": "Flight",
    "stat": "reason"
  },
  {
    "key": "history",
    "label": "History",
    "stat": "reason"
  },
  {
    "key": "linguistics",
    "label": "Linguistics",
    "stat": "reason"
  },
  {
    "key": "magic",
    "label": "Magic",
    "stat": "reason"
  },
  {
    "key": "medicine",
    "label": "Medicine",
    "stat": "reason"
  },
  {
    "key": "religion",
    "label": "Religion",
    "stat": "reason"
  },
  {
    "key": "insight",
    "label": "Insight",
    "stat": "awareness"
  },
  {
    "key": "perception",
    "label": "Perception",
    "stat": "awareness"
  },
  {
    "key": "survival",
    "label": "Survival",
    "stat": "awareness"
  },
  {
    "key": "animal_husbandry",
    "label": "Animal Husbandry",
    "stat": "awareness"
  },
  {
    "key": "art",
    "label": "Art",
    "stat": "presence"
  },
  {
    "key": "intimidation",
    "label": "Intimidation",
    "stat": "presence"
  },
  {
    "key": "negotiation",
    "label": "Negotiation",
    "stat": "presence"
  }
];
export const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function statTotal(stat = {}) { return numeric(stat.base) + statBonusTotal(stat); }
export function statBonusEntries(stat = {}) {
  if (Array.isArray(stat.bonuses)) return stat.bonuses.map(entry => ({value: numeric(entry?.value), source: String(entry?.source ?? ""), ...(entry?.managed ? {managed:true,locked:true} : {})}));
  return numeric(stat.bonus) ? [{value: numeric(stat.bonus), source: "Previously recorded bonus"}] : [];
}
export function statBonusTotal(stat = {}) {
  return statBonusEntries(stat).reduce((sum, entry) => sum + entry.value, 0);
}
export function skillTotal(system, definition) {
  const skill = system.skills?.[definition.key] ?? {};
  return statTotal(system.secondary?.[definition.stat]) + skillBonusTotal(skill);
}
/** Legacy values become explained entries; an explicit array is authoritative. */
export function skillBonusEntries(skill = {}) {
  if (Array.isArray(skill.bonuses)) return skill.bonuses.map(entry => ({value: numeric(entry?.value), source: String(entry?.source ?? ""), ...(entry?.managed ? {managed:true,locked:true} : {})}));
  const entries = [];
  if (numeric(skill.points)) entries.push({value: numeric(skill.points), source: "Previously recorded skill points"});
  if (numeric(skill.bonus)) entries.push({value: numeric(skill.bonus), source: "Previously recorded bonus"});
  return entries;
}
export function skillBonusTotal(skill = {}) {
  return skillBonusEntries(skill).reduce((sum, entry) => sum + entry.value, 0);
}
export function apClick(current, maximum, dot) {
  return Math.max(0, Math.min(maximum, Math.floor(numeric(dot)) - (numeric(dot) <= numeric(current) ? 1 : 0)));
}

/** Default identity and automatically filled resource pools do not count as content. */
export function isEmptyCharacter(actor) {
  const system = actor.system ?? {};
  if (actor.getFlag?.("angelssword", "initialized") || actor.items?.size || actor.effects?.size) return false;
  if (actor.flags?.angelssword?.advancement && (actor.flags.angelssword.advancement.race || ["events","purchases","history","journals","custom"].some(key=>actor.flags.angelssword.advancement[key]?.length))) return false;
  if (actor.flags?.angelssword?.libraryReferences?.length) return false;
  if (["classDetails", "abilities", "features"].some(key => String(actor.flags?.angelssword?.[key] ?? "").replace(/<[^>]*>/g, "").trim())) return false;
  if (String(system.biography ?? "").replace(/<[^>]*>/g, "").trim()) return false;
  if (Object.keys(system.attributes ?? {}).length || Object.keys(system.groups ?? {}).length) return false;
  for (const group of ["primary", "secondary", "skills"]) {
    for (const stat of Object.values(system[group] ?? {})) {
      if (Array.isArray(stat.bonuses) && stat.bonuses.length) return false;
      if (["base", "bonus", "points"].some(key => numeric(stat[key]) !== 0)) return false;
    }
  }
  if (numeric(system.progression?.exp) || numeric(system.progression?.expSpent)) return false;
  for (const [key, value] of Object.entries(system.combat ?? {})) {
    if (numeric(value) !== (key === "speedBase" ? 20 : 0)) return false;
  }
  for (const resource of Object.values(system.resources ?? {})) {
    if (numeric(resource.temp) || numeric(resource.tempmax) || numeric(resource.spent)) return false;
    if (numeric(resource.value) !== numeric(resource.effectiveMax ?? resource.max)) return false;
  }
  return true;
}
