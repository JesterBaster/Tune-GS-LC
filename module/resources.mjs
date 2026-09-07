import { numeric, statTotal } from "./player-stats.mjs";

export const RESOURCE_LABELS = {health: "HP", ap: "AP", mp: "MP", rp: "RP"};
export function resourceValues(source = {}) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const max = Math.max(0, number(source.max));
  const tempmax = number(source.tempmax);
  const effectiveMax = Math.max(0, max + tempmax);
  const value = Math.min(effectiveMax, number(source.value));
  const temp = Math.max(0, number(source.temp));
  // The visual uses the normal maximum, before temporary maximum overrides.
  const tempPct = max > 0 ? Math.min(20, 20 * temp / max) : temp > 0 ? 20 : 0;
  return {value, max, temp, tempmax, effectiveMax, tempPct, hatchPct: effectiveMax > 0 ? Math.min(30, 60 * temp / effectiveMax) : temp > 0 ? 30 : 0,
    pct: effectiveMax ? Math.max(0, Math.min(100, value / effectiveMax * 100)) : 0};
}

// Character Creation / Derived Stats. Focus does not determine a resource pool.
export const RESOURCE_FORMULAS = {
  health: {stat: "toughness", offset: 20, multiplier: 10, label: "20 + 10 × Toughness"},
  mp: {stat: "power", offset: 6, multiplier: 1, label: "6 + Power"},
  rp: {stat: "agility", offset: 2, multiplier: 1, label: "2 + Agility"}
};

export function derivedResource(key, primary = {}, source = {}, permanentBonus = 0) {
  // MP/RP reserves never increase the main maximum. Adopt the old positive
  // adjustment only when no explicit reserve exists, avoiding double counting.
  if (key === "mp" || key === "rp") source = {...source,
    temp: numeric(source.temp) > 0 ? numeric(source.temp) : Math.max(0, numeric(source.tempmax)), tempmax: 0};
  const formula = RESOURCE_FORMULAS[key];
  const stat = primary[formula.stat] ?? {};
  const calculate = value => Math.max(0, Math.floor(formula.offset + formula.multiplier * value));
  const base = calculate(numeric(stat.base));
  const max = calculate(statTotal(stat)) + permanentBonus;
  const effectiveMax = resourceValues({...source, max}).effectiveMax;
  // Older characters have no spent field. Preserve their deficit; empty default
  // pools (0/0) start full. Once saved, spent survives reloads and stat effects.
  const previous = resourceValues(source);
  const deficit = source.spent != null && Number.isFinite(Number(source.spent))
    ? numeric(source.spent)
    : previous.effectiveMax === 0 && previous.value === 0 ? 0 : previous.effectiveMax - previous.value;
  const spent = Math.max(0, deficit);
  const value = key === "health" ? effectiveMax - spent : Math.max(0, effectiveMax - spent);
  return {...resourceValues({...source, max, value}), base, spent, formula: formula.label};
}

/** AP is one 0–8 count. Green is positions 1–4; gold is positions 5–8. */
export function actionPoints(source = {}) {
  const legacy = !numeric(source.max) && !numeric(source.value) ? 4 : Math.max(0, Math.floor(numeric(source.value)));
  const total = Math.max(0, Math.min(8, Math.floor(numeric(source.total ?? (legacy + Math.max(0, numeric(source.temp)))))));
  return {...resourceValues({...source, max: 4, tempmax: 0, value: Math.min(4, total), temp: Math.max(0, total - 4)}), total};
}

export function changeActionPoints(source, delta) {
  const total = Math.max(0, Math.min(8, actionPoints(source).total + Math.trunc(numeric(delta))));
  return {value: Math.min(4, total), temp: Math.max(0, total - 4)};
}

/** One parser for inline resource and TEMP editors: unsigned sets, signed adjusts. */
export function numericEntry(current, entry, {min = 0, max = Infinity, invalid = null} = {}) {
  const text = String(entry).trim();
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(Number(text))) return invalid;
  const value = /^[+-]/.test(text) ? numeric(current) + Number(text) : Number(text);
  return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : invalid;
}
export function temporaryValue(current, entry) { return numericEntry(current, entry); }
