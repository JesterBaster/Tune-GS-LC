import {postDefense} from './defense-actions.mjs';
import {INITIATIVE_FORMULA} from './combat-stats.mjs';
import { isEmptyCharacter } from "./player-stats.mjs";
import { numericEntry } from "./resources.mjs";
import {modal,transact,initialize,esc} from './advancement-ui.mjs';
import {loadCatalog} from './library.mjs';
import {stateFor} from './advancement.mjs';
import {inInitiative,queueActorAction} from './ability-actions.mjs';
export const REACTIONS=[
 {id:'dodge',name:'Dodge',cost:1,text:'Use active Dodge against the triggering attack.'},
 {id:'block',name:'Block',cost:1,text:'Use active Block against the triggering damage.'}
];
export function statArrayFields(group,labels,values) {
 return `<fieldset data-stat-array="${group}" data-array-values="${values.join(',')}"><legend>${group==='primary'?'Primary':'Secondary'} stats</legend><div class="as-allocation">${labels.map(label=>`<label class="as-adv-field">${label}<select name="${group}.${label.toLowerCase()}"><option value="">Choose…</option>${[...new Set(values)].sort((a,b)=>b-a).map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label>`).join('')}</div></fieldset>`;
}
export function chooseArrayValue(state,key,value,allowed) {
 const next=structuredClone(state),capacity=allowed.filter(n=>String(n)===String(value)).length;
 next.order=next.order.filter(k=>k!==key);next.values[key]=value;
 if(value!==''){if(!capacity)throw new Error('Invalid stat value.');const previous=next.order.filter(k=>String(next.values[k])===String(value));while(previous.length>=capacity)next.values[previous.shift()]='';next.order.push(key);}
 return next;
}
export function bindStatArrays(root) {
 const states=new WeakMap();root.addEventListener('change',e=>{const box=e.target.closest('[data-stat-array]');if(!box||e.target.tagName!=='SELECT')return;
 const current=states.get(box)??{values:Object.fromEntries([...box.querySelectorAll('select')].map(s=>[s.name,''])),order:[]};
 const next=chooseArrayValue(current,e.target.name,e.target.value,box.dataset.arrayValues.split(',').map(Number));states.set(box,next);
 for(const select of box.querySelectorAll('select'))select.value=next.values[select.name];
 });
}
export function rememberDetails(sheet,root) {
 const saved=game.settings.get('angelssword','collapsedSections')??{};sheet._detailStates??=new Map(Object.entries(saved[sheet.actor.uuid]??{}));
 const key=detail=>{const parents=[];for(let d=detail;d&&root.contains(d);d=d.parentElement?.closest('details'))parents.unshift((d.querySelector(':scope > summary')?.textContent??'').replace(/·\s*Level\s*\d+/gi,'').trim());return (detail.closest('[data-tab]')?.dataset.tab??'')+'|'+(detail.closest('[data-record-id]')?.dataset.recordId??'')+'|'+(detail.closest('.as-race-card')?'race':detail.closest('.as-skill-list')?'skills':'stats')+'|'+parents.join('/');};
 for(const detail of root.querySelectorAll('details')){const k=key(detail);if(sheet._detailStates.has(k))detail.open=sheet._detailStates.get(k);}
 root.addEventListener('toggle',event=>{if(event.target.tagName==='DETAILS'){const k=key(event.target),value=event.target.open;if(sheet._detailStates.get(k)===value)return;sheet._detailStates.set(k,value);clearTimeout(sheet._detailSave);sheet._detailSave=setTimeout(()=>{const saved=foundry.utils.deepClone(game.settings.get('angelssword','collapsedSections')??{});saved[sheet.actor.uuid]=Object.fromEntries(sheet._detailStates);game.settings.set('angelssword','collapsedSections',saved).catch(console.error);},250);}},true);
}
const escapeText=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export async function proficiencyHTML(actor,editMode=false) {
 const state=stateFor(actor),catalog=await loadCatalog();const texts=[];
 if(state.race){for(const [key,values]of Object.entries(state.race.proficiencies??{}))texts.push(key+': '+values);texts.push(...(state.race.notes??[]));const race=catalog.get(state.race.id);if(race?.data.proficiencies)texts.push(race.data.proficiencies);}
 for(const p of state.purchases){texts.push(...(p.notes??[]));for(const [key,values]of Object.entries(p.proficiencies??{}))texts.push(key+': '+values);}
 const groups={Armor:[],Languages:[],Weapons:[],'Elemental masteries':[]};
 for(const [key,values] of Object.entries(state.proficiencies??{}))if(groups[key])groups[key].push(values);
 for(const raw of texts){const text=escapeText(raw);for(const sentence of text.split(/(?<=[.!])\s+/)){
  if(!/armor|weapon|proficien|speak|read and write|language|elemental master|mastery.*element/i.test(sentence))continue;
  if(/armor|armour|shield/i.test(sentence))groups.Armor.push(sentence);
  if(/language|speak|read and write/i.test(sentence))groups.Languages.push(sentence);
  if(/weapon|sword|blade|polearm|lance|bow|crossbow|gun|unarmed|gauntlet|pickaxe|katana|dagger|scythe|spear/i.test(sentence))groups.Weapons.push(sentence);
  if(/elemental master|mastery.*element/i.test(sentence))groups['Elemental masteries'].push(sentence);
 }}
 return `<details class="as-proficiencies"><summary>Proficiencies${editMode?'<button type="button" data-proficiencies-edit aria-label="Edit proficiencies"><i class="fas fa-cog"></i></button>':''}</summary>${Object.entries(groups).map(([name,rows])=>`<details><summary>${name}</summary>${[...new Set(rows)].sort().map(t=>`<p>${esc(t)}</p>`).join('')||'<p>None recorded</p>'}</details>`).join('')}</details>`;
}
const queue=queueActorAction;
export function bindSheetControls(sheet,root) {
 rememberDetails(sheet,root);
 root.querySelector('[data-movement-entry]')?.addEventListener('change',event=>{if(!sheet.isEditable)return;const actor=sheet.actor,value=numericEntry(actor.flags?.angelssword?.movementAvailable??0,event.target.value);if(value!==null)actor.update({'flags.angelssword.movementAvailable':value});});
 root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const d=button.dataset;
 const run=fn=>Promise.resolve().then(fn).catch(e=>ui.notifications.warn(e.message));
 if('requirementsToggle'in d&&game.user.isGM)run(async()=>{await game.settings.set('angelssword','requirementsAutoMet',!game.settings.get('angelssword','requirementsAutoMet'));sheet.render(false);});
 if(!sheet.isEditable)return;
 if('raceChange'in d)run(()=>openRace(sheet));
 if('proficienciesEdit'in d&&sheet._asEditMode){event.preventDefault();event.stopPropagation();run(()=>editProficiencies(sheet));}
 if('initiativeRoll'in d)run(()=>rollSheetInitiative(sheet.actor));
 if('saveRoll'in d)run(()=>new Roll('2d10 + @bonus',{bonus:sheet.actor.system.derived.save}).toMessage({speaker:ChatMessage.getSpeaker({actor:sheet.actor}),flavor:'Save'}));
 if('speedMove'in d)run(()=>queue(sheet.actor,async()=>{const actor=sheet.actor;if(actor.system.encumbrance?.rooted)throw new Error('Rooted by excess burden. Reduce carried burden before moving.');if(actor.system.resources.ap.total<1)throw new Error('Not enough AP to move.');const available=(actor.flags?.angelssword?.movementAvailable??0)+actor.system.derived.speed;await actor.update({'system.resources.ap.total':actor.system.resources.ap.total-1,'flags.angelssword.movementAvailable':available});await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>Move up to <strong>${actor.system.derived.speed} ft</strong> · 1 AP.</p>`});}));
 if(d.basicReaction)run(()=>queue(sheet.actor,async()=>{const r=REACTIONS.find(r=>r.id===d.basicReaction);if(r)await postDefense(sheet.actor,r);}));
 });
}

export function proficiencyFields() {return `<details><summary>Chosen proficiencies</summary>${['Armor','Languages','Weapons','Elemental masteries'].map((label,i)=>`<label class="as-adv-field">${label}<input name="proficiency${i}" placeholder="Choices granted by your source"></label>`).join('')}</details>`;}
export function readProficiencies(form) {return Object.fromEntries(['Armor','Languages','Weapons','Elemental masteries'].map((label,i)=>[label,form.elements.namedItem('proficiency'+i)?.value.trim()??'']).filter(([,v])=>v));}

export async function rollSheetInitiative(actor) {
 if(!actor.isOwner)throw new Error('You do not own this character.');
 // A sheet roll also works before a GM has created an encounter.
 if(!game.combat)return new Roll(INITIATIVE_FORMULA,{derived:{initiative:actor.system.derived.initiative}}).toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:'Initiative · 1d4'});
 const existing=[...game.combat.combatants].filter(c=>actor.isToken?c.token?.uuid===actor.token?.uuid:c.actorId===actor.id);
 if(existing.length)return game.combat.rollInitiative(existing.map(c=>c.id),{formula:INITIATIVE_FORMULA});
 return actor.rollInitiative({createCombatants:true,rerollInitiative:true,initiativeOptions:{formula:INITIATIVE_FORMULA}});
}
export function openRace(sheet) {
 const race=stateFor(sheet.actor).race;
 if(!race)return initialize(sheet,{changeRace:!isEmptyCharacter(sheet.actor)});
 const win=modal(sheet.actor,'raceOverview','Race',`<p>🔒 ${esc(race.name)}${race.subraceName?' · '+esc(race.subraceName):''}</p><p>Your committed choices and allocations are retained.</p>`,async()=>{await win.close();await initialize(sheet,{changeRace:true});},{label:'Change race',width:420});
 return win;
}
export async function editProficiencies(sheet) {
 const state=stateFor(sheet.actor),labels=['Armor','Languages','Weapons','Elemental masteries'];
 return modal(sheet.actor,'proficiencies','Edit proficiencies',`<p>Additional proficiencies. Grants from races and classes remain attached to their sources.</p>${await proficiencyHTML(sheet.actor)}${labels.map((label,i)=>`<label class="as-adv-field">${label}<textarea name="prof${i}">${esc(state.proficiencies?.[label]??'')}</textarea></label>`).join('')}`,form=>transact(sheet.actor,current=>{current.proficiencies=Object.fromEntries(labels.map((label,i)=>[label,form.elements.namedItem('prof'+i).value.trim()]));return current;}),{render:root=>{root.querySelector('form').addEventListener('change',event=>{if(event.target.name?.startsWith('prof'))transact(sheet.actor,current=>{const i=Number(event.target.name.slice(4));current.proficiencies??={};current.proficiencies[labels[i]]=event.target.value.trim();return current;}).catch(e=>ui.notifications.warn(e.message));});}});
}
