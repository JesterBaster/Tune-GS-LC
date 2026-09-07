import {mageArmor,mageStats,inventorySummary} from './loadout-rules.mjs';
import { applyGrants } from "./advancement-grants.mjs";
import { equipmentBonuses } from "./inventory.mjs";
import { balances } from "./advancement.mjs";
import { combatStats, spiritCore } from "./combat-stats.mjs";
import { PRIMARY, SECONDARY, SKILLS, statBonusEntries, statBonusTotal, statTotal, skillTotal, skillBonusEntries, skillBonusTotal } from "./player-stats.mjs";
import { RESOURCE_LABELS, RESOURCE_FORMULAS, derivedResource, resourceValues, actionPoints, changeActionPoints } from "./resources.mjs";
import { EntitySheetHelper } from "./helper.js";

/**
 * Extend the base Actor document to support attributes and groups with a custom template creation dialog.
 * @extends {Actor}
 */
export class SimpleActor extends Actor {

  /** @inheritdoc */
  prepareDerivedData() {
    super.prepareDerivedData();
    const advancement = this.flags?.angelssword?.advancement;
    if (advancement) { applyGrants(this.system, advancement); const b = balances(advancement); this.system.progression = {exp:b.exp, expSpent:b.spent}; }
    for (const [group, labels] of [["primary", PRIMARY], ["secondary", SECONDARY]]) {
      this.system[group] ??= {};
      for (const label of labels) {
        const stat = this.system[group][label.toLowerCase()] ??= {base: 0, bonus: 0};
        stat.bonuses = statBonusEntries(stat);
        stat.bonus = statBonusTotal(stat);
        stat.total = statTotal(stat);
      }
    }
    this.system.skills ??= {};
    for (const definition of SKILLS) {
      const skill = this.system.skills[definition.key] ??= {points: 0, bonus: 0};
      skill.bonuses = skillBonusEntries(skill);
      skill.bonus = skillBonusTotal(skill);
      skill.total = skillTotal(this.system, definition);
    }
    const mage=mageArmor(this),mageEffects=mageStats(mage);
    this.system.resources ??= {};
    for (const key of Object.keys(RESOURCE_LABELS)) {
      const resource = this.system.resources[key] ??= {};
      if (key in RESOURCE_FORMULAS) Object.assign(resource, derivedResource(key, this.system.primary, resource, (this.system.advancementResources?.[key] ?? 0) - (key === "mp" ? mageEffects?.mpPenalty ?? 0 : 0)));
      else Object.assign(resource, actionPoints(resource));
    }
    const equipment=equipmentBonuses(this.items??[],this.flags?.angelssword?.loadout,mage);
    this.system.derived = combatStats({...this.system,advancementCombat:Object.fromEntries([...new Set([...Object.keys(this.system.advancementCombat??{}),...Object.keys(equipment)])].map(key=>[key,(this.system.advancementCombat?.[key]??0)+(equipment[key]??0)]))});
    this.system.encumbrance=inventorySummary(this.items??[],this.flags?.angelssword?.loadout,this.system.combat?.burdenLimit??10);
    this.system.mageArmor=mageEffects;
    if(this.system.encumbrance.rooted)this.system.derived.speed=0;
    this.system.spiritCore = spiritCore(this.system);
    this.system.groups = this.system.groups || {};
    this.system.attributes = this.system.attributes || {};
    EntitySheetHelper.clampResourceValues(this.system.attributes);
  }

  /* -------------------------------------------- */

  /** Keep spent points independent of stat-derived maxima, including token edits. */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;
    const expanded = foundry.utils.expandObject(changed);
    const oldAdvancement=this.flags?.angelssword?.advancement;
    const nextAdvancement=expanded.flags?.angelssword?.advancement;
    if(oldAdvancement && nextAdvancement && !user?.isGM) {
      for(const purchase of nextAdvancement.purchases??[]) {
        const old=oldAdvancement.purchases.find(p=>p.id===purchase.id);
        if(purchase.adjudication && (!old || JSON.stringify(old.adjudication)!==JSON.stringify(purchase.adjudication)))throw new Error("Only the GM may apply an exceptional EXP or IP cost.");
      }
      const permittedPruning=new Set((nextAdvancement.history??[]).filter(h=>h.kind==='movement').slice(-12).map(h=>h.id));
      const cutoff=(nextAdvancement.history??[]).filter(h=>h.kind==='movement').slice(-12)[0]?.at;
      for(const row of oldAdvancement.history) {
        const next=nextAdvancement.history?.find(h=>h.id===row.id);
        if(!next&&row.kind==='movement'&&permittedPruning.size===12&&cutoff&&row.at<=cutoff)continue;
        if(!next || JSON.stringify(next)!==JSON.stringify(row)) throw new Error("Only the GM may edit existing history entries.");
      }
    }
    const ledger=nextAdvancement??oldAdvancement;
    if(ledger) {
      const b=balances(ledger);
      if(b.exp<0||b.ip<0||b.creationEXP<0)throw new Error("Progression cannot create a negative EXP or IP balance.");
      if(changed.system?.progression)delete changed.system.progression;
      changed["system.progression.exp"]=b.exp;changed["system.progression.expSpent"]=b.spent;
    }
    for (const key of Object.keys(RESOURCE_FORMULAS)) {
      const current = this.system.resources[key];
      const submitted = expanded.system?.resources?.[key];
      let spent = options.asExcelImport ? 0 : current.spent;
      if (submitted?.value !== undefined) {
        const value = Number(submitted.value);
        if (Number.isFinite(value)) spent = current.effectiveMax - Math.min(current.effectiveMax, key === "health" ? value : Math.max(0, value));
      }
      // Ignore attempts to manually change the calculated maximum or deficit.
      if (changed.system?.resources?.[key]) {
        delete changed.system.resources[key].max;
        delete changed.system.resources[key].spent;
      }
      delete changed[`system.resources.${key}.max`];
      changed[`system.resources.${key}.spent`] = spent;
      const reserve = key === "mp" || key === "rp";
      const requestedTemp = submitted?.temp ?? (reserve ? submitted?.tempmax : undefined);
      const temp = requestedTemp === undefined ? current.temp : Math.max(0, Number(requestedTemp) || 0);
      if (reserve) {
        if (changed.system?.resources?.[key]) delete changed.system.resources[key].tempmax;
        changed[`system.resources.${key}.tempmax`] = 0;
      }
      changed[`system.resources.${key}.temp`] = temp;

    }
    const ap = expanded.system?.resources?.ap;
    const requestedAP = Number(ap?.value ?? this.system.resources.ap.value) || 0;
    const total = Math.max(0, Math.min(8, Math.floor(Number(ap?.total ?? (requestedAP > 4 ? requestedAP : requestedAP + (Number(ap?.temp ?? this.system.resources.ap.temp) || 0))) || 0)));
    const apValue = Math.min(4, total);
    const apTemp = Math.max(0, total - 4);
    if (changed.system?.resources?.ap) {
      delete changed.system.resources.ap.max;
      delete changed.system.resources.ap.tempmax;
      delete changed.system.resources.ap.value;
      delete changed.system.resources.ap.temp;
      delete changed.system.resources.ap.total;
    }
    changed["system.resources.ap.max"] = 4;
    changed["system.resources.ap.tempmax"] = 0;
    changed["system.resources.ap.value"] = apValue;
    changed["system.resources.ap.temp"] = apTemp;
    changed["system.resources.ap.total"] = total;
  }

  /** Shared entry point for abilities granting or spending AP, including overflow. */
  async modifyActionPoints(delta) {
    const next = changeActionPoints(this.system.resources.ap, delta);
    return this.setActionPoints(next.value + next.temp);
  }

  async setActionPoints(total) {
    const ap = actionPoints({total});
    return this.update({"system.resources.ap.total": ap.total, "system.resources.ap.value": ap.value, "system.resources.ap.temp": ap.temp});
  }

  /** @override */
  static async createDialog(data={}, options={}) {
    return EntitySheetHelper.createDialog.call(this, data, options);
  }

  /* -------------------------------------------- */

  /**
   * Is this Actor used as a template for other Actors?
   * @type {boolean}
   */
  get isTemplate() {
    return !!this.getFlag("angelssword", "isTemplate");
  }

  /* -------------------------------------------- */
  /*  Roll Data Preparation                       */
  /* -------------------------------------------- */

  /** @inheritdoc */
  getRollData() {

    // Copy the actor's system data
    const data = this.toObject(false).system;
    const shorthand = game.settings.get("angelssword", "macroShorthand");
    const formulaAttributes = [];
    const itemAttributes = [];

    // Handle formula attributes when the short syntax is disabled.
    this._applyShorthand(data, formulaAttributes, shorthand);

    // Map all item data using their slugified names
    this._applyItems(data, itemAttributes, shorthand);

    // Evaluate formula replacements on items.
    this._applyItemsFormulaReplacements(data, itemAttributes, shorthand);

    // Evaluate formula attributes after all other attributes have been handled, including items.
    this._applyFormulaReplacements(data, formulaAttributes, shorthand);

    // Remove the attributes if necessary.
    if ( !!shorthand ) {
      delete data.attributes;
      delete data.attr;
      delete data.groups;
    }
    return data;
  }

  /* -------------------------------------------- */

  /**
   * Apply shorthand syntax to actor roll data.
   * @param {Object} data The actor's data object.
   * @param {Array} formulaAttributes Array of attributes that are derived formulas.
   * @param {Boolean} shorthand Whether or not the shorthand syntax is used.
   */
  _applyShorthand(data, formulaAttributes, shorthand) {
    // Handle formula attributes when the short syntax is disabled.
    for ( let [k, v] of Object.entries(data.attributes || {}) ) {
      // Make an array of formula attributes for later reference.
      if ( v.dtype === "Formula" ) formulaAttributes.push(k);
      // Add shortened version of the attributes.
      if ( !!shorthand ) {
        if ( !(k in data) ) {
          // Non-grouped attributes.
          if ( v.dtype ) {
            data[k] = v.value;
          }
          // Grouped attributes.
          else {
            data[k] = {};
            for ( let [gk, gv] of Object.entries(v) ) {
              data[k][gk] = gv.value;
              if ( gv.dtype === "Formula" ) formulaAttributes.push(`${k}.${gk}`);
            }
          }
        }
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Add items to the actor roll data object. Handles regular and shorthand
   * syntax, and calculates derived formula attributes on the items.
   * @param {Object} data The actor's data object.
   * @param {string[]} itemAttributes
   * @param {Boolean} shorthand Whether or not the shorthand syntax is used.
   */
  _applyItems(data, itemAttributes, shorthand) {
    // Map all items data using their slugified names
    data.items = this.items.reduce((obj, item) => {
      const key = item.name.slugify({strict: true});
      const itemData = item.toObject(false).system;

      // Add items to shorthand and note which ones are formula attributes.
      for ( let [k, v] of Object.entries(itemData.attributes) ) {
        // When building the attribute list, prepend the item name for later use.
        if ( v.dtype === "Formula" ) itemAttributes.push(`${key}..${k}`);
        // Add shortened version of the attributes.
        if ( !!shorthand ) {
          if ( !(k in itemData) ) {
            // Non-grouped item attributes.
            if ( v.dtype ) {
              itemData[k] = v.value;
            }
            // Grouped item attributes.
            else {
              if ( !itemData[k] ) itemData[k] = {};
              for ( let [gk, gv] of Object.entries(v) ) {
                itemData[k][gk] = gv.value;
                if ( gv.dtype === "Formula" ) itemAttributes.push(`${key}..${k}.${gk}`);
              }
            }
          }
        }
        // Handle non-shorthand version of grouped attributes.
        else {
          if ( !v.dtype ) {
            if ( !itemData[k] ) itemData[k] = {};
            for ( let [gk, gv] of Object.entries(v) ) {
              itemData[k][gk] = gv.value;
              if ( gv.dtype === "Formula" ) itemAttributes.push(`${key}..${k}.${gk}`);
            }
          }
        }
      }

      // Delete the original attributes key if using the shorthand syntax.
      if ( !!shorthand ) {
        delete itemData.attributes;
      }
      obj[key] = itemData;
      return obj;
    }, {});
  }

  /* -------------------------------------------- */

  _applyItemsFormulaReplacements(data, itemAttributes, shorthand) {
    for ( let k of itemAttributes ) {
      // Get the item name and separate the key.
      let item = null;
      let itemKey = k.split('..');
      item = itemKey[0];
      k = itemKey[1];

      // Handle group keys.
      let gk = null;
      if ( k.includes('.') ) {
        let attrKey = k.split('.');
        k = attrKey[0];
        gk = attrKey[1];
      }

      let formula = '';
      if ( !!shorthand ) {
        // Handle grouped attributes first.
        if ( data.items[item][k][gk] ) {
          formula = data.items[item][k][gk].replace('@item.', `@items.${item}.`);
          data.items[item][k][gk] = Roll.replaceFormulaData(formula, data);
        }
        // Handle non-grouped attributes.
        else if ( data.items[item][k] ) {
          formula = data.items[item][k].replace('@item.', `@items.${item}.`);
          data.items[item][k] = Roll.replaceFormulaData(formula, data);
        }
      }
      else {
        // Handle grouped attributes first.
        if ( data.items[item]['attributes'][k][gk] ) {
          formula = data.items[item]['attributes'][k][gk]['value'].replace('@item.', `@items.${item}.attributes.`);
          data.items[item]['attributes'][k][gk]['value'] = Roll.replaceFormulaData(formula, data);
        }
        // Handle non-grouped attributes.
        else if ( data.items[item]['attributes'][k]['value'] ) {
          formula = data.items[item]['attributes'][k]['value'].replace('@item.', `@items.${item}.attributes.`);
          data.items[item]['attributes'][k]['value'] = Roll.replaceFormulaData(formula, data);
        }
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Apply replacements for derived formula attributes.
   * @param {Object} data The actor's data object.
   * @param {Array} formulaAttributes Array of attributes that are derived formulas.
   * @param {Boolean} shorthand Whether or not the shorthand syntax is used.
   */
  _applyFormulaReplacements(data, formulaAttributes, shorthand) {
    // Evaluate formula attributes after all other attributes have been handled, including items.
    for ( let k of formulaAttributes ) {
      // Grouped attributes are included as `group.attr`, so we need to split them into new keys.
      let attr = null;
      if ( k.includes('.') ) {
        let attrKey = k.split('.');
        k = attrKey[0];
        attr = attrKey[1];
      }
      // Non-grouped attributes.
      if ( data.attributes[k]?.value ) {
        data.attributes[k].value = Roll.replaceFormulaData(String(data.attributes[k].value), data);
      }
      // Grouped attributes.
      else if ( attr ) {
        data.attributes[k][attr].value = Roll.replaceFormulaData(String(data.attributes[k][attr].value), data);
      }

      // Duplicate values to shorthand.
      if ( !!shorthand ) {
        // Non-grouped attributes.
        if ( data.attributes[k]?.value ) {
          data[k] = data.attributes[k].value;
        }
        // Grouped attributes.
        else {
          if ( attr ) {
            // Initialize a group key in case it doesn't exist.
            if ( !data[k] ) {
              data[k] = {};
            }
            data[k][attr] = data.attributes[k][attr].value;
          }
        }
      }
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    const current = foundry.utils.getProperty(this.system, attribute);
    if (isBar && attribute === "resources.ap") {
      const next = isDelta ? changeActionPoints(current, value) : actionPoints({total: value});
      const updates = {"system.resources.ap.total": next.value + next.temp, "system.resources.ap.value": next.value, "system.resources.ap.temp": next.temp};
      return Hooks.call("modifyTokenAttribute", {attribute, value, isDelta, isBar}, updates) !== false ? this.update(updates) : this;
    }
    if (isBar && /^resources\.(health|mp|rp|ap)$/.test(attribute)) {
      const resource = resourceValues(current);
      const next = isDelta ? resource.value + value : value;
      const minimum = attribute === "resources.health" ? -Infinity : 0;
      const updates = {[`system.${attribute}.value`]: Math.max(minimum, Math.min(resource.effectiveMax, next))};
      const allowed = Hooks.call("modifyTokenAttribute", {attribute, value, isDelta, isBar}, updates);
      return allowed !== false ? this.update(updates) : this;
    }

    if ( !isBar || !isDelta || (current?.dtype !== "Resource") ) {
      return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
    }
    const updates = {[`system.${attribute}.value`]: Math.clamp(current.value + value, current.min, current.max)};
    const allowed = Hooks.call("modifyTokenAttribute", {attribute, value, isDelta, isBar}, updates);
    return allowed !== false ? this.update(updates) : this;
  }
}
