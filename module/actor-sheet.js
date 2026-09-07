import {bindLoadout,loadoutHTML} from './loadout-ui.mjs';
import {effectiveSlots} from './loadout-rules.mjs';
import {openExcelImport} from './excel-import.mjs';
import {bindInventory,inventorySummary} from './inventory.mjs';
import { bindSheetControls, proficiencyHTML, REACTIONS } from "./sheet-controls.mjs";
import { expertisesFor, poolsFor } from "./skill-allocation.mjs";
import { stateFor } from "./advancement.mjs";
import { initialize, advancementContext, bindAdvancement, rollSkill } from "./advancement-ui.mjs";
import { bindAbilityActions, postAbility } from "./ability-actions.mjs";
import { loadCatalog, openLibrary } from "./library.mjs";
import { skillEditorContent, bindSkillEditor, collectSkillUpdates } from "./skill-bonuses.mjs";
import { combatStats, spiritCore, COMBAT_DEFAULTS, INITIATIVE_FORMULA } from "./combat-stats.mjs";
import { PRIMARY, SECONDARY, SKILLS, statTotal, skillTotal, apClick, isEmptyCharacter, skillBonusTotal } from "./player-stats.mjs";
import { RESOURCE_LABELS, RESOURCE_FORMULAS, resourceValues, actionPoints, temporaryValue, numericEntry } from "./resources.mjs";
import { EntitySheetHelper } from "./helper.js";
import {ATTRIBUTE_TYPES} from "./constants.js";

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
const editDialogs = new WeakMap();
const editSaves = new WeakMap();

export class SimpleActorSheet extends ActorSheet {

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["angelssword", "sheet", "actor"],
      template: "systems/angelssword/templates/actor-sheet.html",
      width: 1100,
      height: 760,
      tabs: [{navSelector: ".sheet-tabs", contentSelector: ".as-tab-content", initial: "home"}],
      scrollY: [".window-content", ".inventory", ".description", ".character"],
      dragDrop: [{dragSelector: ".item-list .item", dropSelector: null}]
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options) {
    const context = await super.getData(options);
    EntitySheetHelper.getAttributeData(context.data);
    context.shorthand = !!game.settings.get("angelssword", "macroShorthand");
    context.systemData = context.data.system;
    context.dtypes = ATTRIBUTE_TYPES;
    context.biographyHTML = await TextEditor.enrichHTML(context.systemData.biography, {
      secrets: this.document.isOwner,
      async: true
    });
    const equippedIds=Object.values(effectiveSlots(this.actor.items??[],this.actor.flags?.angelssword?.loadout));
    const weapons=[...(this.actor.items??[])].filter(i=>equippedIds.includes(i.id)&&(i.type==='weapon'||i.system?.kind==='Weapon')); 
    const selected=weapons.some(i=>i.id===this._asWeaponChoice)?this._asWeaponChoice:weapons[0]?.id??'one';
    context.actionWeapons=[{id:'one',name:'One-handed / ranged'},{id:'two',name:'Two-handed melee'},...weapons.map(i=>({id:i.id,name:i.name}))].map(o=>({...o,selected:o.id===selected}));
    context.inventorySummary=inventorySummary(this.actor.items??[],this.actor.flags?.angelssword?.loadout,this.actor.system.combat?.burdenLimit??10);
    context.loadoutHTML=await loadoutHTML(this.actor);
    for(const item of context.data.items??[])item.system.equipped=equippedIds.includes(item._id);
    context.editMode = this.isEditable && !!this._asEditMode;
    context.characterSections = await Promise.all([
      ["classDetails", "Class"], ["abilities", "Abilities"], ["features", "Breakthroughs"]
    ].map(async ([key, label]) => ({key, label, path: `flags.angelssword.${key}`,
      html: await TextEditor.enrichHTML(this.actor.flags?.angelssword?.[key] ?? "", {
        secrets: this.document.isOwner, async: true
      })
    })));
    context.isGM = !!game.user?.isGM;
    context.requirementsAutoMet = game.settings.get("angelssword","requirementsAutoMet");
    context.raceName = this.actor.flags?.angelssword?.advancement?.race?.name ?? "Select race";
    context.subraceName = this.actor.flags?.angelssword?.advancement?.race?.subraceName;
    context.proficiencies = await proficiencyHTML(this.actor,context.editMode);
    context.reactions = REACTIONS;
    context.movementAvailable = this.actor.flags?.angelssword?.movementAvailable ?? 0;
    context.advancement = await advancementContext(this.actor);
    for (const section of context.characterSections) section.progressionHTML = {classDetails:context.advancement.classHTML, abilities:context.advancement.abilityHTML, features:context.advancement.breakthroughHTML}[section.key];
    context.darkMode = game.settings.get("angelssword", "darkMode");
    context.libraryReferences = [];
    const savedReferences = this.actor.flags?.angelssword?.libraryReferences ?? [];
    if (savedReferences.length) {
      try {
        const catalog = await loadCatalog();
        context.libraryReferences = savedReferences.map(id => catalog.get(id)).filter(Boolean).map(({id,name,category}) => ({id,name,category}));
      } catch (error) { console.warn("Rules library references unavailable", error); }
    }
    for (const section of context.characterSections) {
      section.libraryCategory = {classDetails:"class", abilities:"ability", features:"breakthrough"}[section.key];
      section.references = context.libraryReferences.filter(ref => ref.category === section.libraryCategory || (section.key === "classDetails" && ["race","subrace"].includes(ref.category)));
    }
    context.itemReferences = context.libraryReferences.filter(ref => ref.category === "item");
    context.asResources = Object.entries(RESOURCE_LABELS).map(([key, label]) => ({
      key, label, ...resourceValues(this.actor.system.resources?.[key])
    }));
    for (const [group, labels] of [["primary", PRIMARY], ["secondary", SECONDARY]]) {
      context[group + "Stats"] = labels.map(label => {
        const key = label.toLowerCase();
        const stat = this.actor.system[group]?.[key] ?? {};
        return {key, label, base: stat.base ?? 0, bonus: stat.bonus ?? 0, total: statTotal(stat)};
      });
    }
    context.skillPool = poolsFor(stateFor(this.actor)).reduce((n,p)=>n+p.remaining,0);
    context.playerSkills = SKILLS.map(def => ({...def, hasExpertise:expertisesFor(this.actor.system,def.key).length>0, points: this.actor.system.skills?.[def.key]?.points ?? 0,
      bonus: skillBonusTotal(this.actor.system.skills?.[def.key]), total: skillTotal(this.actor.system, def), statBase: statTotal(this.actor.system.secondary?.[def.stat]),
      signedTotal: `${skillTotal(this.actor.system, def) >= 0 ? "+" : ""}${skillTotal(this.actor.system, def)}`}));
    context.asResources = ["health", "mp", "rp"].map(key => ({key, tempExpanded: !!this._tempReserveExpanded?.[key], isHealth: key === "health", label: RESOURCE_LABELS[key],
      ...resourceValues(this.actor.system.resources?.[key]),
      base: this.actor.system.resources?.[key]?.base, formula: RESOURCE_FORMULAS[key]?.label}));
    context.derived = combatStats(this.actor.system);
    context.spiritCore = spiritCore(this.actor.system);
    context.canInitialize = this.isEditable && isEmptyCharacter(this.actor);
    const ap = actionPoints(this.actor.system.resources?.ap);
    context.ap = {...ap, expanded: this._tempAPExpanded ?? ap.temp > 0, dots: Array.from({length: 4}, (_,i) =>
      ({index: i + 1, filled: i < ap.value})), tempDots: Array.from({length: 4}, (_,i) => ({index: i + 5, filled: i + 4 < ap.total}))};
    return context;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    bindAdvancement(this, html[0]);
    bindSheetControls(this, html[0]);
    bindLoadout(this,html[0]??html);
    bindInventory(this,html[0]);
    html.find("[data-excel-import]").on("click",()=>openExcelImport(this).catch(e=>ui.notifications.warn(e.message)));
    bindAbilityActions(this, html[0]);

    html.find("[data-library-open]").on("click", event => openLibrary({actor:this.actor,
      category:event.currentTarget.dataset.libraryOpen}).catch(error=>ui.notifications.warn(error.message)));
    html.find("[data-library-reference]").on("click", event => openLibrary({actor:this.actor,
      entryId:event.currentTarget.dataset.libraryReference}).catch(error=>ui.notifications.warn(error.message)));
    html.find("[data-theme-toggle]").on("click", async () => {
      await game.settings.set("angelssword", "darkMode", !game.settings.get("angelssword", "darkMode"));
      this.render(false);
    });

    // Everything below here is only needed if the sheet is editable
    if ( !this.isEditable ) return;

    html.find("[data-library-remove]").on("click", async event => {
      if (!this._asEditMode) return;
      const id = event.currentTarget.dataset.libraryRemove;
      await this.actor.setFlag("angelssword", "libraryReferences", (this.actor.getFlag("angelssword", "libraryReferences") ?? []).filter(value=>value!==id));
    });
    html.find(".as-character-name").on("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
    });

    // Inline entries have no form name: commit once on blur/Enter, never during typing.
    html[0].addEventListener("change", event => {
      if (event.target.matches("[data-resource-entry]")) event.stopImmediatePropagation();
    }, true);
    html.find("[data-resource-entry]").on("focus", event => {
      const input = event.currentTarget;
      input.readOnly = false;
      input.dataset.entryDirty = "false";
      input.select();
    }).on("input", event => {
      event.currentTarget.dataset.entryDirty = "true";
      event.currentTarget.style.width = `${Math.max(2, Math.min(8, event.currentTarget.value.length + .5))}ch`;
    }).on("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.dataset.cancelEntry = "true";
        event.currentTarget.blur();
      }
    }).on("blur", async event => {
      const input = event.currentTarget;
      const key = input.dataset.resourceEntry;
      const field = input.dataset.resourceField;
      if (input.dataset.cancelEntry) {
        delete input.dataset.cancelEntry;
        input.value = this.actor.system.resources[key][field];
      } else if (input.dataset.entryDirty === "true") await this._commitResourceEntry(key, field, input.value);
      input.readOnly = true;
    });
    html.find(".as-overlay-meter").on("click", event => {
      const input = event.currentTarget.querySelector("[data-resource-entry]");
      if (input && event.target !== input) input.focus();
    });
    html.find("[data-temp-toggle]").on("click", async event => {
      await this.submit();
      const key = event.currentTarget.dataset.tempToggle;
      if (!["mp", "rp"].includes(key)) return;
      this._tempReserveExpanded ??= {};
      this._tempReserveExpanded[key] = !this._tempReserveExpanded[key];
      this.render(false);
    });
    const applyTemp = async key => {
      if (this._tempReserveBusy || !["mp", "rp"].includes(key)) return;
      const input = html[0].querySelector(`[data-temp-delta="${key}"]`);
      if (!input || !/^[+-]?\d+$/.test(input.value.trim()) || !Number.isSafeInteger(Number(input.value))) {
        ui.notifications.warn("Enter a whole number to set TEMP, or prefix it with + or - to adjust TEMP.");
        return;
      }
      const delta = input.value.trim();
      this._tempReserveBusy = true;
      try {
        await this.submit();
        await this._adjustTemporaryResource(key, delta);
        input.value = "";
      } finally { this._tempReserveBusy = false; }
    };
    html.find("[data-temp-apply]").on("click", event => applyTemp(event.currentTarget.dataset.tempApply));
    html.find("[data-temp-delta]").on("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      applyTemp(event.currentTarget.dataset.tempDelta);
    });
    html.find("[data-combat-edit]").on("click", () => this._configureCombat());
    html.find("[data-initialize]").on("click", () => this._initializeCharacter());
    html.find("[data-toggle-temp-ap]").on("click", async () => {
      await this.submit();
      this._tempAPExpanded = !(this._tempAPExpanded ?? this.actor.system.resources.ap.temp > 0);
      this.render(false);
    });
    html.find("[data-as-section]").on("click", event => this._configureSection(event.currentTarget.dataset.asSection));
    html.find("[data-use-action]").on("click", async event => {
      const item=this.actor.items.get(event.currentTarget.dataset.useAction);if(!item)return;
      try{if(Number(item.system.quantity)<=0)throw Error('There are none of this item left.');if(item.system.location&&item.system.location!=='Carried')throw Error('Retrieve this item into carried inventory first. Retrieving from a backpack in combat costs 4 AP; items left elsewhere may be inaccessible.');await postAbility(this.actor,{name:item.name,ap:item.system.apCost,effects:item.system.description??'',actionLabel:'Use'});}
      catch(error){ui.notifications.warn(error.message);}
    });
    html.find("[data-ap-dot], [data-temp-ap-dot]").on("click", async event => {
      if (this._apBusy) return;
      this._apBusy = true;
      try {
        await this.submit();
        const ap = actionPoints(this.actor.system.resources.ap);
        const dot = Number(event.currentTarget.dataset.apDot ?? event.currentTarget.dataset.tempApDot);
        await this.actor.setActionPoints(apClick(ap.total, 8, dot));
      } finally { this._apBusy = false; }
    });
    html.find("[data-skill-roll]").on("click", async event => {
      const def = SKILLS.find(d => d.key === event.currentTarget.dataset.skillRoll);
      if (!def) return;
      await this.submit();
      await rollSkill(this, def);
    });
    html.find("[data-as-mode]").on("click", async () => {
      await this.submit();
      this._asEditMode = !this._asEditMode;
      this.render(false);
    });
    html.find("[data-as-resource]").on("click", event => {
      this._configureResource(event.currentTarget.dataset.asResource);
    });
    if (!this._asEditMode) {
      html.find('input, select, textarea').each((i, field) => {
        if (field.hasAttribute("data-loadout-control") || field.hasAttribute("data-temp-delta") || field.hasAttribute("data-resource-entry") || field.hasAttribute("data-action-weapon") || field.hasAttribute("data-movement-entry") || field.hasAttribute("data-item-quantity")) return;
        if (/^system\.resources\.(health|ap|mp|rp)\.(value|temp)$/.test(field.name)) return;
        if (field.tagName === "SELECT" || ["checkbox", "radio"].includes(field.type)) field.disabled = true;
        else field.readOnly = true;
      });
      html.find('.attribute-control, .group-control, .item-control[data-action="create"], .item-control[data-action="delete"]').hide();
    }

    // Attribute Management
    html.find(".attributes").on("click", ".attribute-control", EntitySheetHelper.onClickAttributeControl.bind(this));
    html.find(".groups").on("click", ".group-control", EntitySheetHelper.onClickAttributeGroupControl.bind(this));
    html.find(".attributes").on("click", "a.attribute-roll", EntitySheetHelper.onAttributeRoll.bind(this));

    // Item Controls
    html.find(".item-control").click(this._onItemControl.bind(this));
    html.find(".items .rollable").on("click", this._onItemRoll.bind(this));

    // Add draggable for Macro creation
    html.find(".attributes a.attribute-roll").each((i, a) => {
      a.setAttribute("draggable", true);
      a.addEventListener("dragstart", ev => {
        let dragData = ev.currentTarget.dataset;
        ev.dataTransfer.setData('text/plain', JSON.stringify(dragData));
      }, false);
    });
  }

  /* -------------------------------------------- */

  async _commitResourceEntry(key, field, entry) {
    if (!this.isEditable || !["health", "mp", "rp"].includes(key) || !["value", "temp"].includes(field)) return;
    const resource = resourceValues(this.actor.system.resources[key]);
    const value = numericEntry(resource[field], entry, {
      min: key === "health" && field === "value" ? -Infinity : 0,
      max: field === "value" ? resource.effectiveMax : Infinity,
      invalid: key === "health" && field === "temp" ? 0 : null
    });
    if (value === null) {
      ui.notifications.warn("Enter a whole number to set the amount, or prefix it with + or - to adjust it.");
      this.render(false);
      return;
    }
    if (value !== resource[field]) await this.actor.update({[`system.resources.${key}.${field}`]: value});
    else this.render(false);
  }

  async _adjustTemporaryResource(key, delta) {
    if (!this.isEditable || !["mp", "rp"].includes(key)) return;
    const current = resourceValues(this.actor.system.resources?.[key]).temp;
    const value = temporaryValue(current, delta);
    if (value === null) return;
    return this.actor.update({[`system.resources.${key}.temp`]: value});
  }

  /** Reserve the window before any asynchronous work, including rapid repeated clicks. */
  async _openEditDialog(key, create, {submit = true} = {}) {
    let windows = editDialogs.get(this.actor);
    if (!windows) editDialogs.set(this.actor, windows = new Map());
    const existing = windows.get(key);
    if (existing) {
      if (existing.dialog) {
        await existing.dialog.maximize();
        existing.dialog.bringToTop();
      }
      return existing.dialog;
    }
    const entry = {dialog: null};
    windows.set(key, entry);
    try {
      if (submit) await this.submit();
      const dialog = entry.dialog = create();
      dialog.options.classes = [...(dialog.options.classes ?? []), "as-system-dialog"];
      if (key !== "initialize") this._enableLiveDialog(dialog, key);
      const close = dialog.data.close;
      dialog.data.close = (...args) => {
        if (windows.get(key) === entry) windows.delete(key);
        return close?.(...args);
      };
      dialog.render(true);
      return dialog;
    } catch (error) {
      if (windows.get(key) === entry) windows.delete(key);
      throw error;
    }
  }

  /** Commit independent field changes in order and refresh with the prepared actor data. */
  async _saveDialogChanges(updates) {
    const previous = editSaves.get(this.actor) ?? Promise.resolve();
    const saved = previous.catch(() => {}).then(async () => {
      await this.actor.update(updates);
      this.render(false);
    });
    editSaves.set(this.actor, saved);
    return saved;
  }

  /** Live editors commit on field change; Done only waits for pending writes and closes. */
  _enableLiveDialog(dialog, key) {
    let pending = Promise.resolve();
    let failed = false;
    const commit = (form, target) => {
      if (!this.isEditable || !this._asEditMode) return;
      try {
        let updates;
        if (key.startsWith("section:")) {
          const section = target.closest("[data-skill-key]");
          if (!section) return;
          // Save only the changed stat/skill, never stale fields elsewhere in the window.
          updates = collectSkillUpdates({querySelectorAll: () => [section]}, key.slice(8));
        } else {
          if (!target.matches("input") || !target.value.trim() || !target.checkValidity() || !Number.isSafeInteger(target.valueAsNumber)) {
            target.reportValidity();
            throw new Error("Enter a valid whole number.");
          }
          const path = key.startsWith("resource:") ? `system.resources.${key.slice(9)}.${target.name}` : target.name;
          updates = {[path]:target.valueAsNumber};
        }
        failed = false;
        pending = this._saveDialogChanges(updates).catch(error => {
          failed = true;
          ui.notifications.warn(error.message);
        });
        return pending;
      } catch (error) {
        failed = true;
        ui.notifications.warn(error.message);
      }
    };
    const render = dialog.data.render;
    dialog.data.render = html => {
      render?.(html);
      const form = html[0].querySelector("form");
      form.addEventListener("change", event => commit(form, event.target));
      form.addEventListener("bonuschange", event => commit(form, event.target));
      form.addEventListener("keydown", event => {
        if (event.key === "Enter" && event.target.matches("input")) {
          event.preventDefault();
          event.stopPropagation();
          event.target.blur();
        }
      });
    };
    dialog.data.buttons = {done:{label:"Done"}};
    dialog.data.default = "done";
    dialog.submit = async () => {
      const form = dialog.element[0].querySelector("form");
      const focused = form.ownerDocument.activeElement;
      if (form.contains(focused)) focused.blur();
      await pending;
      if (!failed && form.reportValidity()) await dialog.close();
    };
  }

  async _configureCombat() {
    if (!this.isEditable || !this._asEditMode) return;
    return this._openEditDialog("combat", () => {
    const labels = {equipmentGuard: "Equipment Guard value", armorBlock: "Armor Block value", shieldBlock: "Shield Block bonus (normal shield: 4)",
      evasionBonus: "Evasion bonus", dodgeBonus: "Dodge-only bonus", guardBonus: "Guard bonus", blockBonus: "Block-only bonus",
      initiativeBonus: "Initiative bonus", speedBase: "Base Speed (ft)", speedBonus: "Speed bonus", potencyBonus: "Potency bonus", saveBonus: "Save bonus adjustment"};
    const field = (path, label, value, min = "") => `<div class="form-group"><label>${label}</label><input type="number" required step="1" ${min} name="${path}" value="${Number(value) || 0}"></div>`;
    const fields = Object.entries(COMBAT_DEFAULTS).map(([key, value]) => field(`system.combat.${key}`, labels[key], this.actor.system.combat?.[key] ?? value)).join("");
    const core = spiritCore(this.actor.system);
    return new Dialog({title: "Derived stats and Spirit Core", content: `<form class="as-section-config">${fields}<p>EXP and Spirit Core are calculated from events and purchases.</p></form>`}, {width:460});
    });
  }

  async _initializeCharacter() { return initialize(this); }

  async _configureSkills(group = "skills") {
    if (!this.isEditable || !this._asEditMode) return;
    return this._openEditDialog(`section:${group}`, () => {
    return new Dialog({title: `Edit ${group === "skills" ? "skills" : group + " stats"}`, content: skillEditorContent(this.actor.system, group),
      render: html => bindSkillEditor(html[0].querySelector("form"))
    }, {width:560, height:"auto"});
    });
  }

  /** Edit a whole section without exposing base/bonus fields on the sheet. */
  async _configureSection(group) {
    if (!this.isEditable || !this._asEditMode || !["primary", "secondary", "skills"].includes(group)) return;
    return this._configureSkills(group);
  }

  /** Open the same four resource controls used by the 5e HP dialog. */
  async _configureResource(key) {
    if (!this.isEditable || !this._asEditMode || !(key in RESOURCE_FORMULAS)) return;
    return this._openEditDialog(`resource:${key}`, () => {
    const r = resourceValues(this.actor.system.resources?.[key]);
    const formula = RESOURCE_FORMULAS[key];
    const field = (name, label, minimum = "") => `<div class="form-group"><label>${label}</label><div class="form-fields"><input type="number" step="1" ${minimum} name="${name}" value="${r[name]}"></div></div>`;
    return new Dialog({
      title: `${RESOURCE_LABELS[key]} Configuration`,
      content: `<form class="as-resource-config"><p><strong>${r.value} / ${r.effectiveMax}</strong></p>
        <fieldset><legend>Maximum</legend>${formula ? `<p>Base: ${this.actor.system.resources[key].base}. Maximum: <strong>${r.max}</strong> (${formula.label}, including stat bonuses).</p>` : field("max", "Maximum", 'min="0"')}${key === "health" ? field("tempmax", "Temporary maximum adjustment") : ""}</fieldset>
        <fieldset><legend>Current</legend>${field("value", "Current", `max="${r.effectiveMax}" ${key === "health" ? "" : 'min="0"'}`)}${field("temp", "Temporary points", 'min="0"')}</fieldset>
        <p>${key === "health" ? "Effective maximum = maximum + temporary maximum adjustment (minimum 0)." : "Temporary points are a separate reserve and never increase this maximum."}</p></form>`,
    }, {width: 420});
    });
  }

  /**
   * Handle click events for Item control buttons within the Actor Sheet
   * @param event
   * @private
   */
  _onItemControl(event) {
    event.preventDefault();

    // Obtain event data
    const button = event.currentTarget;
    const li = button.closest(".item");
    const item = this.actor.items.get(li?.dataset.itemId);

    // Handle different actions
    switch ( button.dataset.action ) {
      case "create":
        const cls = getDocumentClass("Item");
        return cls.create({name: game.i18n.localize("SIMPLE.ItemNew"), type: "item"}, {parent: this.actor});
      case "edit":
        return item.sheet.render(true);
      case "delete":
        return item.delete();
    }
  }

  /* -------------------------------------------- */

  /**
   * Listen for roll buttons on items.
   * @param {MouseEvent} event    The originating left click event
   */
  _onItemRoll(event) {
    let button = $(event.currentTarget);
    const li = button.parents(".item");
    const item = this.actor.items.get(li.data("itemId"));
    let r = new Roll(button.data('roll'), this.actor.getRollData());
    return r.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `<h2>${item.name}</h2><h3>${button.text()}</h3>`
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getSubmitData(updateData) {
    let formData = super._getSubmitData(updateData);
    const path = "system.resources.health.temp";
    if (Object.hasOwn(formData, path)) {
      const value = temporaryValue(this.actor.system.resources.health.temp, formData[path]);
      if (value === null) {
        delete formData[path];
        ui.notifications.warn("Enter a whole number to set TEMP HP, or prefix it with + or - to adjust it.");
      } else formData[path] = value;
    }
    if (!this._asEditMode) {
      return Object.fromEntries(Object.entries(formData).filter(([key]) =>
        /^system\.resources\.(health|ap|mp|rp)\.(value|temp)$/.test(key)));
    }
    // Attributes have no editor on this sheet; keep stored attributes/groups intact.
    return formData;
  }
}
