import { poolGrants, normalizeSinglePools } from "./skill-allocation.mjs";
/** Pure advancement accounting. No document writes or UI dependencies. */
export const clone = value => structuredClone(value);
export const plain = value => String(value ?? '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export const norm = value => plain(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const fail = message => {throw new Error(message);};
export function whole(value, label='Amount') {
  const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail(`${label} must be a non-negative whole number.`);return n;
}
export function stateFor(actor) {
  return normalizeSinglePools(clone(actor.flags?.angelssword?.advancement ?? {version:1,creation:false,openingEXP:whole(actor.system?.progression?.exp??0),openingSpent:whole(actor.system?.progression?.expSpent??0),openingIP:0,events:[],purchases:[],history:[],journals:[],custom:[],race:null}));
}
export function balances(state) {
  let baseEarned=whole(state.slowStarterBaseEarned??0),earned=0;
  const slow=state.purchases.some(p=>p.name==='Slow Starter');
  for(const event of [...state.events].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))) {
    const gain=whole(event.exp);earned+=gain+(slow?Math.min(gain,Math.max(0,500-baseEarned)):0);baseEarned+=gain;
  }
  const hybrid=state.purchases.some(p=>p.name==='Human-Chimera Hybrid (Race)');
  const human=state.race?.name==='Human'&&!hybrid?100:0;
  const starting=state.initialized?1000+human-(slow?200:0)+(state.importOpeningEXP??0):whole(state.openingEXP);
  const spent=state.purchases.filter(p=>p.pool!=='creation').reduce((n,p)=>n+whole(p.cost),0);
  const creationSpent=state.purchases.filter(p=>p.pool==='creation').reduce((n,p)=>n+whole(p.cost),0);
  return {exp:starting+earned-spent,spent:whole(state.openingSpent)+spent,earned,creationEXP:state.creation?300-creationSpent:0,ip:whole(state.openingIP)+state.events.reduce((n,e)=>n+whole(e.ip??0),0)-state.purchases.reduce((n,p)=>n+whole(p.ip??0),0)-whole(state.retiredIP??0),clim:state.purchases.some(p=>p.name==='Rich Parents')?3000:0};
}
export function validateBalances(state) {
  const b=balances(state);if(b.exp<0)fail('Not enough available EXP.');if(b.creationEXP<0)fail('Not enough creation breakthrough EXP.');if(b.ip<0)fail('Not enough Interlude Points.');return b;
}
export function logChange(state, {id,at,user}, action, detail, exp=0) {
  state.history.push({id,at,user,action,detail,exp});
}
export function classLevel(state,id) {return Math.max(0,...state.purchases.filter(p=>p.kind==='class'&&p.entryId===id).map(p=>p.level));}
export function breakthroughCost(entry,state) {
  let cost=whole(entry.data.cost,'Breakthrough cost');
  if(entry.name==='Primary Stat Training') cost=Math.min(700,400+100*state.purchases.filter(p=>p.entryId===entry.id).length);
  return cost;
}
export function quotePurchase(state,entry,{level,creationPool=false,free=false}={}) {
  if(entry.archived)fail('Archived entries cannot be purchased.');
  if(entry.category==='class') {
    const next=classLevel(state,entry.id)+1;
    if(next>8||level!==undefined&&level!==next)fail('Class levels must be acquired in order, up to level 8.');
    const step=entry.levels.find(l=>l.level===next);if(!step)fail('This class level has no source record.');
    const duplicate=step.abilityId&&state.purchases.find(p=>p.kind==='class'&&p.entryId!==entry.id&&p.abilityId===step.abilityId);
    return {kind:'class',entryId:entry.id,name:entry.name,level:next,abilityId:step.abilityId??null,cost:free||duplicate?0:next===1?whole(entry.data.tier,'Class tier')*100:100,ip:free?0:next===1?1:0,pool:'exp',duplicateOf:duplicate?.duplicateOf??duplicate?.id??null,step:clone(step)};
  }
  if(entry.category!=='breakthrough')fail('Only classes and breakthroughs can be purchased.');
  const text=plain(entry.data.description)+' '+plain(entry.data.requirements);
  if(/(?:character creation|creating your character)/i.test(text)&&/only|must.*(?:creation|creating)/i.test(text)&&!state.creation)fail('This breakthrough is only available during character creation.');
  if(state.purchases.some(p=>p.entryId===entry.id)&&!/(?:multiple times|more than once|repeat|each time|again|stack)/i.test(text))fail('This breakthrough has already been acquired.');
  if(creationPool&&!state.creation)fail('The creation breakthrough pool has expired.');
  return {kind:'breakthrough',entryId:entry.id,name:entry.name,cost:free?0:breakthroughCost(entry,state),ip:0,pool:creationPool?'creation':'exp'};
}
export function addPurchase(state,entry,options,meta) {
  const next=clone(state), purchase={...quotePurchase(next,entry,options),id:meta.id,at:meta.at,grants:clone(options.grants??[]),skillPools:clone(options.skillPools??[]),notes:clone(options.notes??[]),abilities:clone(options.abilities??[]),requirements:options.requirements??'',racial:!!options.racial,proficiencies:clone(options.proficiencies??{})};
  if(options.adjudication) {
    if(!String(options.adjudication.reason??'').trim())fail('Explain the GM ruling.');
    purchase.cost=whole(options.adjudication.cost,'EXP cost');purchase.ip=whole(options.adjudication.ip??purchase.ip,'IP cost');purchase.adjudication=clone(options.adjudication);
  }
  next.purchases.push(purchase);validateBalances(next);
  logChange(next,meta,'Acquired',`${entry.name}${purchase.level?` · Level ${purchase.level}`:''}${purchase.duplicateOf?' · free duplicate':''}${purchase.adjudication?' · GM ruling: '+purchase.adjudication.reason:''}`, -purchase.cost);
  return next;
}
export function removeLevel(state,id,meta) {
  const next=clone(state),purchase=next.purchases.find(p=>p.id===id);
  if(purchase?.racial)fail('This class level is granted by ancestry and cannot be de-leveled.');
  if(!purchase||purchase.kind!=='class')fail('Select a class level.');
  if(purchase.level!==classLevel(next,purchase.entryId))fail('Remove the highest class level first.');
  if(next.purchases.some(p=>p.duplicateOf===id))fail('Remove the later free copies before refunding their original purchase.');
  next.retiredIP=whole(next.retiredIP??0)+whole(purchase.ip??0);
  next.purchases=next.purchases.filter(p=>p.id!==id);validateBalances(next);
  logChange(next,meta,'De-leveled',`${purchase.name} · Level ${purchase.level}`,purchase.cost);return next;
}
export function saveEvent(state,event,meta) {
  const next=clone(state);if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!Number.isFinite(Date.parse(event.date))||new Date(event.date+'T00:00:00Z').toISOString().slice(0,10)!==event.date)fail('Choose a valid date.');
  if(!String(event.name).trim())fail('Give this event or session a name.');
  const row={id:event.id??meta.id,name:String(event.name).trim(),date:event.date,exp:whole(event.exp,'EXP gained'),ip:whole(event.ip??0,'Interlude Points gained'),kind:event.kind==='session'?'session':'event',notes:String(event.notes??'')};
  const index=next.events.findIndex(e=>e.id===row.id);if(index<0)next.events.push(row);else next.events[index]=row;
  validateBalances(next);logChange(next,meta,index<0?'Recorded event':'Updated event',`${row.date} · ${row.name} · ${row.exp} EXP`);return next;
}
export function removeEvent(state,id,meta) {
  const next=clone(state),event=next.events.find(e=>e.id===id);if(!event)fail('Event not found.');next.events=next.events.filter(e=>e.id!==id);validateBalances(next);logChange(next,meta,'Removed event',event.name);return next;
}
export function allGrants(state) {return [...(state.race?.grants??[]),...state.purchases.flatMap(p=>p.grants??[]),...poolGrants(state),...(state.importGrants??[])];}
export function progressionUpdates(state) {
  const b=validateBalances(state);
  return {'flags.angelssword.advancement':state,'system.progression.exp':b.exp,'system.progression.expSpent':b.spent};
}
