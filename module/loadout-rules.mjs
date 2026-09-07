/** Equipment rules are derived from owned Items; no Item is copied into a loadout. */
export const MAGE_ARMOR_IDS=['ability:645192af-84c9-4dee-beb9-491590ae82bf','ability:e837fc6d-f762-4369-84e8-a36bf264c521'];
export const ARMOR_TYPES={light:{guard:1,block:4,initiativePenalty:1,evasionPenalty:2},medium:{guard:2,block:8,initiativePenalty:2,evasionPenalty:4},heavy:{guard:3,block:12,initiativePenalty:3,evasionPenalty:6}};
export const MAGE_FRAMES={none:'None',barrier:'Barrier',fortress:'Fortress (heavy only)',manaweave:'Manaweave',coating:'Protective Coating'};
export const finite=value=>Number.isFinite(Number(value))?Number(value):0;
export const positive=value=>Math.max(0,finite(value));
export const itemId=item=>item.id??item._id;
export const carried=item=>!item.system.location||item.system.location==='Carried';
export const available=item=>carried(item)&&positive(item.system.quantity)>=1;
export function hasMageArmor(actor) {
 const state=actor.flags?.angelssword?.advancement??{};
 const ids=[...(state.race?.abilities??[]),...(state.purchases??[]).flatMap(p=>p.abilities??[]),...(state.custom??[]).map(a=>a.catalogId??a.id)];
 return ids.some(id=>MAGE_ARMOR_IDS.includes(id));
}
export function mageArmor(actor) {
 const armor=actor.flags?.angelssword?.loadout?.mage;
 return armor?.active&&hasMageArmor(actor)&&ARMOR_TYPES[armor.type]?armor:null;
}
export function mageStats(armor) {
 if(!armor)return null;
 const stats={...ARMOR_TYPES[armor.type],speedPenalty:0,mpPenalty:0,fireVulnerability:false};
 const frame=armor.frame;
 if(frame==='barrier'){stats.guard=0;stats.initiativePenalty-=2;stats.evasionPenalty-=4;}
 if(frame==='coating'){stats.block=stats.guard;stats.initiativePenalty--;stats.evasionPenalty-=2;}
 if(frame==='fortress'&&armor.type==='heavy'){stats.initiativePenalty--;stats.evasionPenalty-=2;stats.speedPenalty=5;}
 if(frame==='manaweave'){stats.initiativePenalty--;stats.evasionPenalty-=2;stats.mpPenalty=3;}
 if(armor.spidersilk&&armor.type==='light'){stats.initiativePenalty--;stats.evasionPenalty-=2;stats.fireVulnerability=true;}
 stats.initiativePenalty=Math.max(0,stats.initiativePenalty);stats.evasionPenalty=Math.max(0,stats.evasionPenalty);
 return stats;
}
export function slotAccepts(slot,item) {
 if(!available(item))return false;
 return slot==='body'?['Armor','Equipment'].includes(item.system.kind)&&!containerRule(item):['Weapon','Shield','Equipment'].includes(item.system.kind)||item.type==='weapon';
}
export function effectiveSlots(items,loadout={}) {
 const list=[...items],byId=new Map(list.map(i=>[itemId(i),i])),slots={left:'',right:'',body:''};
 // Legacy equipped flags are read conservatively until the first slot selection is saved.
 if(loadout.slots){for(const slot of Object.keys(slots)){const i=byId.get(loadout.slots[slot]);if(i&&slotAccepts(slot,i)&&!Object.values(slots).includes(itemId(i)))slots[slot]=itemId(i);}}
 else for(const item of list.filter(i=>i.system.equipped)){
  const slot=item.system.kind==='Armor'?'body':!slots.right?'right':'left';
  if(!slots[slot]&&slotAccepts(slot,item))slots[slot]=itemId(item);
 }
 if(byId.get(slots.left)?.system.handedness==='two')slots.right='';
 else if(byId.get(slots.right)?.system.handedness==='two')slots.left='';
 return slots;
}
export function planSlot(items,loadout,slot,id) {
 if(!['left','right','body'].includes(slot))throw Error('Unknown equipment slot.');
 const list=[...items],byId=new Map(list.map(i=>[itemId(i),i])),slots=effectiveSlots(list,loadout),item=byId.get(id),removed=[];
 if(id&&(!item||!slotAccepts(slot,item)))throw Error('Choose a carried item suitable for this slot.');
 if(slot!=='body'){
  const other=slot==='left'?'right':'left',otherItem=byId.get(slots[other]);
  if(otherItem&&(item?.system.handedness==='two'||otherItem.system.handedness==='two'||slots[other]===id)){
   removed.push(otherItem);slots[other]='';
  }
 }
 for(const other of Object.keys(slots))if(other!==slot&&id&&slots[other]===id){const old=byId.get(id);if(!removed.includes(old))removed.push(old);slots[other]='';}
 slots[slot]=id||'';
 return {slots,removed};
}
export function containerRule(item) {
 const name=(item.flags?.angelssword?.catalogData?.name??item.name).toLowerCase();
 if(/^alchemy rig(?: \(deluxe\))?$/.test(name))return {kind:'alchemy',capacity:name.includes('deluxe')?5:2};
 if(/^adventurer'?s kit$/.test(name))return {kind:'adventuring',capacity:5};
 return null;
}
export function suitable(container,item) {
 const rule=containerRule(container);if(!rule||!carried(item)||positive(item.system.quantity)<=0||itemId(container)===itemId(item)||containerRule(item)||item.system.kind==='Container'||/kit|burden reduc/i.test(item.name+' '+(item.flags?.angelssword?.catalogData?.description??'')))return false;
 const source=item.flags?.angelssword?.catalogData??{},tag=item.system.storageCategory;
 if(rule.kind==='alchemy')return tag==='alchemy'||/potion|elixir|flask|salve|poison/i.test(item.name+' '+source.subType);
 return tag==='adventuring'||source.type==='Adventuring Essentials'||/northi lantern|^(backpack|flint and steel|rope|notebook|pen|compass|bedroll|torch(?:es)?|hand mirror)$/i.test(item.name);
}
export function inventorySummary(items,loadout={},limit=10) {
 const list=[...items],byId=new Map(list.map(i=>[itemId(i),i])),claimed=new Map(),containers=[];
 let value=0,burden=0,exempt=0,rigUsed=false;
 for(const item of list){const s=item.system;value+=positive(s.quantity)*positive(s.price);if(carried(item)||(s.location==='Backpack'&&/kit/i.test(item.name)))burden+=positive(s.quantity)*positive(s.weight);}
 for(const [id,rows] of Object.entries(loadout.containers??{})){
  const container=byId.get(id),rule=container&&containerRule(container);if(!rule||!available(container)||(rule.kind==='alchemy'&&rigUsed))continue;
  if(rule.kind==='alchemy')rigUsed=true;
  let remaining=rule.capacity;const accepted=[];
  for(const row of rows){const item=byId.get(row.itemId);if(!item||!suitable(container,item))continue;
   const weight=positive(item.system.weight),left=Math.max(0,positive(item.system.quantity)-(claimed.get(row.itemId)??0));
   const quantity=Math.min(positive(row.quantity),left,weight?Math.floor((remaining+1e-8)/weight):left);
   if(!quantity)continue;claimed.set(row.itemId,(claimed.get(row.itemId)??0)+quantity);remaining-=quantity*weight;exempt+=quantity*weight;accepted.push({itemId:row.itemId,quantity});
  }
  containers.push({id,capacity:rule.capacity,used:rule.capacity-remaining,rows:accepted});
 }
 burden=Math.round(Math.max(0,burden-exempt)*1000)/1000;
 return {value,burden,exempt,limit:positive(limit),rooted:burden>positive(limit),containers};
}
export function validateContainers(items,containers) {
 const list=[...items],byId=new Map(list.map(i=>[itemId(i),i]));let rigs=0;
 for(const [id,rows] of Object.entries(containers)){
  const item=byId.get(id),rule=item&&containerRule(item);if(!rule||!available(item))throw Error('That container is no longer carried.');
  if(rule.kind==='alchemy'&&++rigs>1)throw Error('Only one alchemy rig can be equipped.');
  if(new Set(rows.map(r=>r.itemId)).size!==rows.length)throw Error('An item may only be listed once per container.');
  if(rows.some(r=>!Number.isInteger(Number(r.quantity))||Number(r.quantity)<0))throw Error('Stored quantities must be whole, nonnegative numbers.');
 }
 const summary=inventorySummary(list,{containers});
 for(const [id,rows] of Object.entries(containers))for(const row of rows){const accepted=summary.containers.find(c=>c.id===id)?.rows.find(r=>r.itemId===row.itemId)?.quantity??0;if(accepted!==Number(row.quantity))throw Error('Storage exceeds capacity, repeats an item, or contains an unsuitable/unavailable item.');}
 return summary;
}
export function equipmentBonuses(items,loadout={},mage=null) {
 const list=[...items],slots=effectiveSlots(list,loadout),ids=new Set(Object.values(slots)),bonuses={equipmentGuard:0,armorBlock:0,shieldBlock:0,evasionBonus:0,initiativeBonus:0,speedBonus:0};
 const apply=(s,shield=false)=>{bonuses.equipmentGuard+=finite(s.guard);bonuses[shield?'shieldBlock':'armorBlock']+=finite(s.block);bonuses.evasionBonus-=positive(s.evasionPenalty);bonuses.initiativeBonus-=positive(s.initiativePenalty);bonuses.speedBonus-=positive(s.speedPenalty);};
 for(const item of list){if(!ids.has(itemId(item))||!available(item))continue;if(mage&&itemId(item)===slots.body)continue;apply(item.system,item.system.kind==='Shield');}
 if(mage)apply(mageStats(mage));return bonuses;
}
export function catalogNumber(value) {const match=String(value??'').trim().match(/^([\d,]+(?:\.\d+)?)\s*(?:Clim)?$/i);return match?positive(match[1].replaceAll(',','')):0;}
export function catalogEquipment(entry) {
 const text=String(entry.data.description??'').split(/<h[1-6]|Mods:/i)[0].replace(/<[^>]*>/g,' '),name=entry.name.toLowerCase(),result={};
 const armor=name.match(/^armor \((light|medium|heavy)\)$/);if(armor)Object.assign(result,ARMOR_TYPES[armor[1]]);
 if(entry.data.subType==='Shield'||/shield/.test(name)){const match=text.match(/\+(\d+)\s+(?:Shield bonus to your |to (?:your )?)Block/i);if(match)result.block=Number(match[1]);}
 if(/two.handed/i.test(text+' '+name))result.handedness='two';
 return result;
}
export function catalogImage(entry) {const url=entry.images?.[0]??entry.data.imageLgUrl??entry.data.imageSmUrl;return /^https:\/\//i.test(url??'')?url:null;}
