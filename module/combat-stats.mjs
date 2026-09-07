import { numeric, statTotal } from "./player-stats.mjs";

export const INITIATIVE_FORMULA = "max(0, 1d4 + @derived.initiative)";
export const COMBAT_DEFAULTS = {
  equipmentGuard: 0, armorBlock: 0, shieldBlock: 0,
  evasionBonus: 0, dodgeBonus: 0, guardBonus: 0, blockBonus: 0,
  initiativeBonus: 0, speedBase: 20, speedBonus: 0, potencyBonus: 0, saveBonus: 0
};
export function combatStats(system = {}) {
  const agility = statTotal(system.primary?.agility);
  const toughness = statTotal(system.primary?.toughness);
  const focus = statTotal(system.primary?.focus);
  const settings = {...COMBAT_DEFAULTS, ...system.combat};
  const n = key => key === "speedBase" && system.advancementCombat?.speedBase !== undefined ? numeric(system.advancementCombat.speedBase) : numeric(settings[key]) + numeric(system.advancementCombat?.[key]);
  const floor = value => Math.floor(value);
  return {
    evasion: floor(7 + agility + n("evasionBonus")),
    dodge: floor(20 + agility + n("evasionBonus") + n("dodgeBonus")),
    guard: floor(toughness + n("equipmentGuard") + n("guardBonus")),
    block: floor(2 * toughness + n("armorBlock") + n("shieldBlock") + n("guardBonus") + n("blockBonus")),
    initiative: floor(agility + n("initiativeBonus")),
    speed: Math.max(0, floor(n("speedBase") + n("speedBonus"))),
    potency: floor(11 + focus + n("potencyBonus")),
    save: floor(toughness + n("saveBonus"))
  };
}
export function spiritCore(system = {}) {
  const value = Math.max(0, Math.floor(numeric(system.progression?.expSpent)));
  const exp = Math.max(0, Math.floor(numeric(system.progression?.exp)));
  // These are the two Spirit Core milestones named in the supplied skill rules.
  const target = value < 5000 ? 5000 : 10000;
  return {value, exp, total:value + exp, target, progressValue: Math.min(value, target), pct: Math.min(100, value / target * 100)};
}
