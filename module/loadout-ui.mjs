import {esc,modal} from './advancement-ui.mjs';
import {queueActorAction,inInitiative} from './ability-actions.mjs';
import {loadCatalog,safeHTML} from './library.mjs';
import {ARMOR_TYPES,MAGE_FRAMES,hasMageArmor,mageArmor,mageStats,effectiveSlots,slotAccepts,planSlot,itemId,available,containerRule,suitable,inventorySummary,validateContainers,catalogImage} from './loadout-rules.mjs';
const loadoutFor=actor=>structuredClone(actor.flags?.angelssword?.loadout??{});
const select=(name,options,value,disabled=false)=>`<select data-loadout-control ${name} ${disabled?'disabled':''}>${options.map(([id,label])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
export async function loadoutHTML(actor) {
 const items=[...(actor.items??[])],loadout=loadoutFor(actor),slots=effectiveSlots(items,loadout),byId=new Map(items.map(i=>[itemId(i),i]));
 const mage=mageArmor(actor),summary=inventorySummary(items,loadout,actor.system.combat?.burdenLimit??10);
 const slotHTML=['left','right','body'].map(slot=>{
  const opposite=slot==='left'?'right':'left',blocked=slot!=='body'&&byId.get(slots[opposite])?.system.handedness==='two',item=byId.get(slots[slot]);
  return `<label class="as-loadout-slot ${blocked?'as-slot-blocked':''}"><strong>${slot==='body'?'Body':slot==='left'?'Left hand':'Right hand'}</strong>${item?`<img src="${esc(item.img)}" alt="">`:''}${select(`data-loadout-slot="${slot}"`,[['',blocked?'Occupied by two-handed weapon':'Empty'],...items.filter(i=>slotAccepts(slot,i)).map(i=>[itemId(i),i.name])],slots[slot],blocked||!actor.isOwner)}${slot==='body'&&mage?'<small>Mage Armor replaces this item’s defensive effects.</small>':''}</label>`;
 }).join('');
 let mageHTML='';
 if(hasMageArmor(actor)){
  const saved=mage??{type:'light',frame:'none'},catalog=await loadCatalog(),entry=catalog.get('ability:e837fc6d-f762-4369-84e8-a36bf264c521');
  mageHTML=`<section class="as-mage-armor"><h3>Mage Armor ${mage?'· Active':''}</h3><div class="as-loadout-options"><label>Armor${select('data-mage-type',Object.keys(ARMOR_TYPES).map(k=>[k,k[0].toUpperCase()+k.slice(1)]),saved.type,!actor.isOwner)}</label><label>Frame modification${select('data-mage-frame',Object.entries(MAGE_FRAMES),saved.frame,!!mage||!actor.isOwner)}</label><label><input data-loadout-control type="checkbox" data-mage-spidersilk ${saved.spidersilk?'checked':''} ${mage||!actor.isOwner?'disabled':''}> Spidersilk (light only)</label></div>${actor.isOwner?`<button type="button" data-mage-apply>${mage?'Change armor · 2 AP in combat':'Apply Mage Armor'}</button>${mage?'<button type="button" data-mage-remove>Remove · 2 AP in combat</button>':''}`:''}<p>Frame modifications are exclusive. Modifications are chosen on application and locked until the armor ends. Spidersilk doubles incoming Fire damage.</p><details><summary>Ability and modification effects</summary>${safeHTML(entry?.data.description??'')}<ul><li>Barrier: no passive armor Guard; normal armor Block; initiative penalty −2, evasion/dodge penalty −4.</li><li>Fortress: heavy only; initiative penalty −1, evasion/dodge penalty −2; speed −5 ft.</li><li>Manaweave: initiative penalty −1, evasion/dodge penalty −2; current and maximum MP −3. Requires at least 3 current MP.</li><li>Protective Coating: initiative penalty −1, evasion/dodge penalty −2; armor Block uses only its passive Guard.</li><li>Spidersilk: light only; initiative penalty −1, evasion/dodge penalty −2; double Fire damage.</li></ul></details></section>`;
 }
 const containers=items.filter(i=>available(i)&&containerRule(i)).map(item=>{
  const id=itemId(item),rule=containerRule(item),stored=summary.containers.find(c=>c.id===id),rows=stored?.rows??[];
  return `<section class="as-loadout-container"><header><h3>${esc(item.name)}</h3>${actor.isOwner?`<button type="button" data-container-edit="${esc(id)}">${stored?'Edit contents':'Equip / store items'}</button>${stored?`<button type="button" data-container-remove="${esc(id)}">Unequip container</button>`:''}`:''}</header><p>${stored?`${stored.used} / ${rule.capacity} burden stored without additional burden`:`Capacity: ${rule.capacity} burden · not equipped`}</p>${rows.map(r=>`<p>${r.quantity} × ${esc(byId.get(r.itemId)?.name)}</p>`).join('')}</section>`;
 }).join('');
 const ignored=items.filter(i=>!loadout.slots&&i.system.equipped&&!Object.values(slots).includes(itemId(i))&&!containerRule(i));
 return `<div class="as-loadout-slots">${slotHTML}</div>${ignored.length?`<p class="as-import-warning">Previously marked equipped but outside the available slots: ${ignored.map(i=>esc(i.name)).join(', ')}. Their bonuses are not applied; choose their slots above.</p>`:''}${mageHTML}<section><h3>Carried containers</h3>${containers||'<p>Add an Adventurer’s Kit or Alchemy Rig to use combat-ready storage.</p>'}</section><p class="as-burden-status ${summary.rooted?'as-overburdened':''}">Burden: ${summary.burden} / ${summary.limit}${summary.exempt?` · ${summary.exempt} stored free`:''}${summary.rooted?' · Rooted: cannot move':''}</p>`;
}
export async function equipSlot(actor,slot,id,confirm=message=>foundry.applications.api.DialogV2.confirm({window:{title:'Change equipment'},content:`<p>${esc(message)}</p>`})) {
 if(!actor.isOwner)return;
 return queueActorAction(actor,async()=>{
  const loadout=loadoutFor(actor),plan=planSlot(actor.items,loadout,slot,id);
  if(plan.removed.length&&!await confirm(`Unequip ${plan.removed.map(i=>i.name).join(', ')} to use this item?`))return false;
  loadout.slots=plan.slots;
  // One Actor update is authoritative. Item flags are retained only for legacy imports.
  await actor.update({'flags.angelssword.loadout':loadout});return true;
 });
}
export async function setMageArmor(actor,{type,frame='none',spidersilk=false,remove=false}) {
 if(!actor.isOwner)return;
 return queueActorAction(actor,async()=>{
  if(!hasMageArmor(actor))throw Error('Mage Armor is no longer available on this character.');
  const loadout=loadoutFor(actor),active=mageArmor(actor),combat=(game.combats?.contents??[game.combat]).find(c=>c?.started&&[...c.combatants].some(t=>t.actor?.uuid===actor.uuid));
  if(remove&&!active)return;
  if(!remove){
   if(!ARMOR_TYPES[type])throw Error('Select an armor type.');
   if(active){frame=active.frame;spidersilk=active.spidersilk;}
   if(!(frame in MAGE_FRAMES))throw Error('Select one frame modification.');
   if(frame==='fortress'&&type!=='heavy')throw Error('Fortress requires heavy armor. Remove and reapply armor in a later encounter to change its modifications.');
   if(spidersilk&&type!=='light')throw Error('Spidersilk requires light armor.');
   if(!active&&frame==='manaweave'&&actor.system.resources.mp.value<3)throw Error('Manaweave requires at least 3 current MP.');
   if(active&&active.type===type)return;
   if(!active&&combat&&(combat.round>1||loadout.mage?.usedCombat===combat.id))throw Error('Mage Armor can only be applied at encounter start, once per encounter.');
  }
  const cost=active&&inInitiative(actor)?2:0;
  if(actor.system.resources.ap.total<cost)throw Error('Not enough AP.');
  loadout.mage={active:!remove,type:remove?active.type:type,frame,spidersilk,usedCombat:combat?.id??null};
  await actor.update({'flags.angelssword.loadout':loadout,...(cost?{'system.resources.ap.total':actor.system.resources.ap.total-cost}:{})});
 });
}
async function editContainer(actor,id) {
 const item=actor.items.get(id);if(!item||!available(item))throw Error('Container is no longer carried.');
 const rule=containerRule(item),rows=loadoutFor(actor).containers?.[id]??[],choices=[...actor.items].filter(i=>suitable(item,i));
 return modal(actor,'container-'+id,'Store items · '+item.name,`<p>Choose quantities from carried inventory, up to ${rule.capacity} burden. The container itself still counts toward burden.</p><div class="as-container-editor">${choices.map(i=>`<label>${esc(i.name)} <small>${i.system.quantity} owned · ${i.system.weight} burden each</small><input type="number" data-stored-item="${esc(itemId(i))}" min="0" max="${i.system.quantity}" step="1" value="${rows.find(r=>r.itemId===itemId(i))?.quantity??0}"></label>`).join('')||'<p>No suitable carried items.</p>'}</div>`,form=>queueActorAction(actor,async()=>{
  const loadout=loadoutFor(actor);loadout.containers??={};
  loadout.containers[id]=[...form.querySelectorAll('[data-stored-item]')].map(input=>({itemId:input.dataset.storedItem,quantity:Number(input.value)})).filter(r=>r.quantity!==0);
  validateContainers(actor.items,loadout.containers);await actor.update({'flags.angelssword.loadout':loadout});
 }),{label:'Store items',width:520});
}
export function bindLoadout(sheet,root) {
 const show=tab=>{sheet._asInventoryTab=tab;root.querySelectorAll('[data-inventory-panel]').forEach(el=>el.hidden=el.dataset.inventoryPanel!==tab);root.querySelectorAll('[data-inventory-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.inventoryTab===tab);el.setAttribute('aria-selected',String(el.dataset.inventoryTab===tab));});};
 show(sheet._asInventoryTab??'loadout');
 root.addEventListener('click',event=>{
  const button=event.target.closest('button'),d=button?.dataset;if(!d)return;
  if('inventoryTab'in d){event.preventDefault();show(d.inventoryTab);return;}
  if(!sheet.isEditable)return;
  let task;
  if('mageApply'in d)task=()=>setMageArmor(sheet.actor,{type:root.querySelector('[data-mage-type]').value,frame:root.querySelector('[data-mage-frame]').value,spidersilk:root.querySelector('[data-mage-spidersilk]').checked});
  if('mageRemove'in d)task=()=>setMageArmor(sheet.actor,{remove:true});
  if('containerEdit'in d)task=()=>editContainer(sheet.actor,d.containerEdit);
  if('containerRemove'in d)task=()=>queueActorAction(sheet.actor,async()=>{await sheet.actor.update({[`flags.angelssword.loadout.containers.-=${d.containerRemove}`]:null});});
  if('inventoryImages'in d)task=async()=>{const catalog=await loadCatalog(),updates=[...sheet.actor.items].flatMap(item=>{const entry=catalog.get(item.flags?.angelssword?.catalogId)??catalog.find(item.name,'item')[0],img=entry&&catalogImage(entry);return img&&(!item.img||['icons/svg/item-bag.svg','icons/svg/sword.svg','icons/svg/shield.svg'].includes(item.img))?[{_id:item.id,img,...(!item.flags?.angelssword?.catalogData?{'flags.angelssword.catalogData':entry.data}:{})}]:[];});if(updates.length)await sheet.actor.updateEmbeddedDocuments('Item',updates);};
  if(task){event.preventDefault();Promise.resolve().then(task).catch(e=>ui.notifications.warn(e.message));}
 });
 root.addEventListener('change',event=>{if(!sheet.isEditable||!event.target.matches('[data-loadout-slot]'))return;equipSlot(sheet.actor,event.target.dataset.loadoutSlot,event.target.value).then(()=>sheet.render(false)).catch(e=>{ui.notifications.warn(e.message);sheet.render(false);});});
}
