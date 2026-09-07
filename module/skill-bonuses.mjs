import { expertisesFor } from "./skill-allocation.mjs";
import { PRIMARY, SECONDARY, SKILLS, numeric, statBonusEntries, statBonusTotal, statTotal, skillBonusEntries, skillBonusTotal } from "./player-stats.mjs";
const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
const signed = value => `${value >= 0 ? "+" : ""}${value}`;
const amount = text => /^[+-]?\d+$/.test(text.trim()) && Number.isSafeInteger(Number(text)) ? Number(text) : null;

export function bonusRow(entry = {value:0, source:""}) {
  if (entry.managed) return `<div class="as-bonus-entry as-managed-bonus" data-managed><input type="text" data-bonus-value value="${escape(signed(entry.value))}" readonly aria-label="Locked bonus"><input type="text" data-bonus-source value="${escape(entry.source)}" readonly aria-label="Locked source"><span title="Granted by progression">🔒</span></div>`;
  return `<div class="as-bonus-entry"><input type="text" data-bonus-value value="${escape(signed(entry.value))}" aria-label="Bonus amount" title="Positive or negative whole number"><input type="text" data-bonus-source value="${escape(entry.source)}" aria-label="Bonus source" placeholder="Source"><button type="button" data-remove-bonus aria-label="Remove bonus/source">×</button></div>`;
}
const definitions = group => group === "skills" ? SKILLS :
  (group === "primary" ? PRIMARY : group === "secondary" ? SECONDARY : []).map(label => ({key:label.toLowerCase(), label}));
export function skillEditorContent(system, group = "skills") {
  return `<form class="as-skill-editor"><div class="as-bonus-tools"><button type="button" data-open-all>Open all</button><button type="button" data-close-all>Close all</button></div><div class="as-skill-edit-heading"><span>${group === "skills" ? "Skill" : "Stat"}</span><span>${group === "skills" ? "Skill base" : "Base"}</span><span>Bonus</span></div>${definitions(group).map(def => {
    const skill = system[group]?.[def.key] ?? {};
    const entries = group === "skills" ? skillBonusEntries(skill) : statBonusEntries(skill);
    const base = group === "skills" ? `<output title="From ${def.stat}">${statTotal(system.secondary?.[def.stat])}</output>` : `<input type="number" step="1" required data-stat-base aria-label="${def.label} base" value="${numeric(skill.base)}">`;
    return `<section class="as-skill-edit-item" data-skill-key="${def.key}"><div class="as-skill-edit-summary"><strong>${def.label}</strong><div class="as-skill-base"><button type="button" data-toggle-bonuses aria-expanded="false" aria-controls="skill-bonuses-${def.key}" aria-label="Show ${def.label} bonus sources">+</button>${base}</div><output data-bonus-total>${signed(group === "skills" ? skillBonusTotal(skill) : statBonusTotal(skill))}</output></div><div class="as-bonus-detail" id="skill-bonuses-${def.key}" hidden><div class="as-bonus-columns"><span>Amount</span><span>Source</span></div><div class="as-bonus-list">${group==='skills'?expertisesFor(system,def.key).map(e=>`<div class="as-expertise-card"><strong>${escape(e.name)}</strong><span>+${e.value} 🔒</span><small>${escape(e.sources.join(" · "))}</small></div>`).join(""):""}${(entries.length ? entries : [{value:0,source:""}]).map(bonusRow).join("")}</div><button type="button" class="as-add-bonus" data-add-bonus>+ Add bonus/source…</button></div></section>`;
  }).join("")}</form>`;
}

function updateBonusTotal(section) {
  let sum = 0;
  for (const input of section.querySelectorAll("[data-bonus-value]")) {
    const value = amount(input.value);
    input.setCustomValidity(value === null ? "Enter a positive or negative whole number." : "");
    if (value !== null) sum += value;
  }
  section.querySelector("[data-bonus-total]").textContent = signed(sum);
}
function setExpanded(section, expanded) {
  section.querySelector(".as-bonus-detail").hidden = !expanded;
  const toggle = section.querySelector("[data-toggle-bonuses]");
  toggle.textContent = expanded ? "−" : "+";
  toggle.setAttribute("aria-expanded", String(expanded));
}
export function bindSkillEditor(form) {
  form.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button?.hasAttribute("data-open-all") || button?.hasAttribute("data-close-all")) {
      for (const item of form.querySelectorAll("[data-skill-key]")) setExpanded(item, button.hasAttribute("data-open-all"));
      return;
    }
    const section = button?.closest("[data-skill-key]");
    if (!section) return;
    if (button.hasAttribute("data-toggle-bonuses")) {
      const detail = section.querySelector(".as-bonus-detail");
      setExpanded(section, detail.hidden);
    }
    if (button.hasAttribute("data-add-bonus")) {
      const list = section.querySelector(".as-bonus-list");
      list.insertAdjacentHTML("beforeend", bonusRow());
      list.lastElementChild.querySelector("input").focus();
      list.scrollTop = list.scrollHeight;
    }
    if (button.hasAttribute("data-remove-bonus")) {
      button.closest(".as-bonus-entry").remove();
      updateBonusTotal(section);
      section.dispatchEvent(new Event("bonuschange", {bubbles:true}));
    }
  });
  form.addEventListener("input", event => {
    if (event.target.hasAttribute("data-bonus-value")) updateBonusTotal(event.target.closest("[data-skill-key]"));
  });
  // Enter in an entry should not accidentally save and close the whole dialog.
  form.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.matches("input")) {event.preventDefault(); event.stopPropagation();}
  });
}
export function collectSkillUpdates(form, group = "skills") {
  const updates = {};
  for (const section of form.querySelectorAll("[data-skill-key]")) {
    const key = section.dataset.skillKey;
    if (!definitions(group).some(def => def.key === key)) continue;
    const bonuses = [];
    for (const row of section.querySelectorAll(".as-bonus-entry")) {
      if (row.hasAttribute?.("data-managed")) continue;
      const input = row.querySelector("[data-bonus-value]");
      const value = amount(input.value);
      if (value === null) { input.focus(); throw new Error("Enter a positive or negative whole number for each bonus."); }
      const source = row.querySelector("[data-bonus-source]").value.trim();
      if (value !== 0 || source) bonuses.push({value,source});
    }
    const total = bonuses.reduce((sum, entry) => sum + entry.value, 0);
    if (!Number.isSafeInteger(total)) throw new Error("The combined bonus is outside the supported number range.");
    if (group === "skills") updates[`system.skills.${key}.points`] = 0;
    else {
      const input = section.querySelector("[data-stat-base]");
      const base = amount(input.value);
      if (base === null) { input.focus(); throw new Error("Enter a whole number for each stat base."); }
      updates[`system.${group}.${key}.base`] = base;
    }
    updates[`system.${group}.${key}.bonuses`] = bonuses;
    updates[`system.${group}.${key}.bonus`] = total;
  }
  return updates;
}
