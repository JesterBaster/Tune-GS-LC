import { statArrayFields, bindStatArrays, proficiencyFields, readProficiencies } from "./sheet-controls.mjs";
import { allocationHTML, readAllocation, bindAllocations, isSkillChoice, poolsFor, spendPoolRows, expertisesFor } from "./skill-allocation.mjs";
import { requirementFailures } from "./advancement-requirements.mjs";
import {loadCatalog,safeHTML} from './library.mjs';
import {PRIMARY,SECONDARY,SKILLS,isEmptyCharacter,skillTotal} from './player-stats.mjs';
import {stateFor,balances,progressionUpdates,quotePurchase,addPurchase,removeLevel,saveEvent,removeEvent,classLevel,plain,logChange,whole} from './advancement.mjs';
import {grantPlan,resolvePlan,starterClasses} from './advancement-grants.mjs';
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const queues=new WeakMap(),windows=new WeakMap();
const meta=()=>({id:foundry.utils.randomID(),at:new Date().toISOString(),user:game.user.name});
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function transact(actor,fn) {
  const run=(queues.get(actor)??Promise.resolve()).catch(()=>{}).then(async()=>{
    if(!actor.isOwner)throw new Error('You do not own this character.');
    const result=await fn(stateFor(actor));if(!result)return;
    const state=result.state??result,updates={...progressionUpdates(state),...(result.updates??{})};
    await actor.update(updates);actor.sheet?.render(false);return state;
  });queues.set(actor,run);return run;
}
/** One modal per actor/key; only closes after a successful awaited commit. */
export function modal(actor,key,title,content,commit,{render,width=650,label='Commit'}={}) {
  let map=windows.get(actor);if(!map)windows.set(actor,map=new Map());
  if(map.has(key)){const win=map.get(key);win.maximize();win.bringToTop();return win;}
  const dialog=new Dialog({title,content:`<form class="as-advancement-form">${content}</form>`,buttons:{commit:{label},cancel:{label:'Close'}},render:html=>{const root=html[0];bindAllocations(root);bindStatArrays(root);root.querySelector('form').addEventListener('submit',e=>e.preventDefault());render?.(root);},close:()=>map.delete(key)}, {width,height:'auto',resizable:true,classes:['dialog','as-system-dialog','as-advancement-window']});
  dialog.submit=async button=>{
    if(dialog._committing)return;
    if(button!==dialog.data.buttons.commit)return dialog.close();
    const form=dialog.element[0].querySelector('form');if(!form.reportValidity())return;
    dialog._committing=true;
    try{if(await commit(form)!==false)await dialog.close();}catch(error){ui.notifications.warn(error.message);}finally{dialog._committing=false;}
  };map.set(key,dialog);dialog.render(true);return dialog;
}
const field=(label,name,value='',type='text')=>`<label class="as-adv-field">${esc(label)}<input type="${type}" name="${esc(name)}" value="${esc(value)}" ${type==='number'?'min="0" step="1"':''}></label>`;
const select=(label,name,options)=>`<label class="as-adv-field">${esc(label)}<select name="${esc(name)}">${options.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>`;
function planHTML(plan,prefix='grant') {
  return `<div class="as-grant-review">${plan.fixed.map(g=>`<p>🔒 ${esc(g.path)}: ${g.value}</p>`).join('')}${plan.choices.map((c,i)=>isSkillChoice(c)?(c.options.length===1?`<p>🔒 ${esc(c.options[0].label)} +${c.budget??c.value} · automatic</p>`:allocationHTML(c,`${prefix}.${i}`)):`<fieldset><legend>${esc(c.label)}</legend>${select('Choose',`${prefix}.${i}`,c.options.map(o=>({id:o.path,name:o.label})))}</fieldset>`).join('')}<details><summary>Full grants and conditions</summary>${plan.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</details></div>`;
}
function readPlan(form,plan,prefix='grant') {
  return resolvePlan(plan,plan.choices.map((c,i)=>isSkillChoice(c)?(c.options.length===1?{rows:[],defer:true}:readAllocation([...form.querySelectorAll('[data-allocation-key]')].find(box=>box.dataset.allocationKey===`${prefix}.${i}`))):form.elements.namedItem(`${prefix}.${i}`).value));
}
const mergePlans=plans=>({fixed:plans.flatMap(p=>p.fixed),choices:plans.flatMap(p=>p.choices),notes:plans.flatMap(p=>p.notes),abilities:[...new Set(plans.flatMap(p=>p.abilities))]});
export async function initialize(sheet,{changeRace=false}={}) {
  if(!sheet.isEditable||!changeRace&&!isEmptyCharacter(sheet.actor))return;
  const actor=sheet.actor,catalog=await loadCatalog(),races=catalog.search('',{category:'race'}),subs=catalog.search('',{category:'subrace'});
  let plan,selectedRace,selectedSub,house,starters=[],raceLocked=false,subLocked=false;
  const statFields=statArrayFields;
  modal(actor,changeRace?'race-change':'initialize',changeRace?'Change race':'Initialize character',`${changeRace?'':statFields('primary',PRIMARY,[5,4,4,3])+statFields('secondary',SECONDARY,[5,4,3,2,1])}${select('Race','race',races)}<label><input type="checkbox" data-choose-subrace> Sub-race</label><button type="button" data-lock-race>Lock race</button><div data-demon-proficiency></div><div data-ancestry></div><div data-race-grants></div>${field('Other racial choices','proficiencies')}${proficiencyFields()}${changeRace?'':'<label><input type="checkbox" name="slowStarter"> Slow Starter (spends the 300 creation breakthrough EXP; reduces starting class EXP by 200)</label><p>1,000 class EXP · 3 Interlude Points · 300 breakthrough-only EXP, excluded from Spirit Core. Human adds 100 class EXP.</p>'}`,async form=>{
    if(!raceLocked||form.querySelector('[data-choose-subrace]').checked&&!subLocked)throw new Error('Lock in your race and selected sub-race first.');
    const updates={};
    for(const [group,labels,expected] of (changeRace?[]:[['primary',PRIMARY,'3,4,4,5'],['secondary',SECONDARY,'1,2,3,4,5']])) {
      const vals=labels.map(l=>whole(form.elements.namedItem(`${group}.${l.toLowerCase()}`).value,'Stat'));
      if([...vals].sort((a,b)=>a-b).join(',')!==expected)throw new Error('Use each stat array exactly as listed.');
      labels.forEach((l,i)=>updates[`system.${group}.${l.toLowerCase()}.base`]=vals[i]);
    }
    const resolved=readPlan(form,plan);resolved.proficiencies=readProficiencies(form);
    const starterGrants=starters.map((s,i)=>readPlan(form,s.plan,'starter'+i));
    await transact(actor,state=>{
      if(!changeRace&&!isEmptyCharacter(actor))throw new Error('Initialize is only available on perfectly empty sheets.');
      if(!changeRace){state.initialized=true;state.creation=true;state.openingIP=3;}
      else {for(const p of state.purchases.filter(p=>p.racial))if(state.purchases.some(q=>q.entryId===p.entryId&&!q.racial))throw new Error('De-level purchased levels of the old racial class before changing race.');state.purchases=state.purchases.filter(p=>!p.racial);}
      if(changeRace&&state.race?.id===selectedRace.id&&state.race?.subraceId===selectedSub?.id&&state.race?.house===house)throw new Error('This race is already committed. Your existing allocations have been kept.');
      const retainedGrants=changeRace?(state.race?.grants??[]).filter(g=>g.source==='Character creation'):[];
      const retainedPools=changeRace?(state.race?.skillPools??[]).filter(p=>p.source==='Character creation'):[];
      resolved.grants.push(...retainedGrants);resolved.skillPools.push(...retainedPools);
      state.race={baseAbilities:grantPlan(selectedRace,catalog).abilities,subAbilities:selectedSub?grantPlan(selectedSub,catalog).abilities:[],id:selectedRace.id,name:selectedRace.name,subraceId:selectedSub?.id,subraceName:selectedSub?.name,house,...resolved,notes:[...resolved.notes,form.elements.proficiencies.value]};
      for(let i=0;i<starters.length;i++)if(classLevel(state,starters[i].entry.id)<starters[i].level)state=addPurchase(state,starters[i].entry,{...starterGrants[i],free:true,racial:true},meta());
      if(!changeRace&&form.elements.slowStarter.checked){const slow=catalog.find('Slow Starter','breakthrough')[0];state=addPurchase(state,slow,{creationPool:true,...resolvePlan(grantPlan(slow,catalog),[])},meta());}
      if(changeRace&&!game.settings.get("angelssword","requirementsAutoMet"))for(const purchase of state.purchases){const entry=catalog.get(purchase.entryId);if(entry&&requirementFailures(state,entry,catalog).length)throw new Error('The new race does not meet requirements for '+purchase.name);}
      logChange(state,meta(),changeRace?'Changed race':'Initialized',`${selectedRace.name}${selectedSub?' · '+selectedSub.name:''}`);
      updates['flags.angelssword.initialized']=true;return {state,updates};
    });
  },{render:root=>{
    if(changeRace){const current=stateFor(actor).race;if(current){root.querySelector('[name=race]').value=current.id;root.querySelector('[data-choose-subrace]').checked=!!current.subraceId;}}
    const build=()=>{
      selectedRace=catalog.get(root.querySelector('[name=race]').value);
      const descendants=subs.filter(e=>e.parentId===selectedRace.id);
      root.querySelector('[data-demon-proficiency]').innerHTML=selectedRace.name==='Demon'?select('Demon proficiency choice','demonChoice',[{id:'weapon',name:'One common weapon'},{id:'skill',name:'+5 skill points related to your clan'}]):'';
      root.querySelector('[name=proficiencies]').required=false;
      root.querySelector('[data-choose-subrace]').disabled=!descendants.length;
      if(!descendants.length)root.querySelector('[data-choose-subrace]').checked=false;
      subLocked=false;
      root.querySelector('[data-ancestry]').innerHTML=descendants.length&&root.querySelector('[data-choose-subrace]').checked?select('Subrace','subrace',descendants)+'<button type="button" data-lock-subrace>Lock sub-race</button>':selectedRace.name==='Demon'?select('Demon house','house',Object.entries(selectedRace.data).filter(([,v])=>v&&typeof v==='object'&&'ability'in v).map(([k])=>({id:k,name:k}))):'';
      const previousSub=changeRace?stateFor(actor).race?.subraceId:null;if(previousSub&&descendants.some(s=>s.id===previousSub)&&root.querySelector('[name=subrace]'))root.querySelector('[name=subrace]').value=previousSub;
      const grants=()=>{
        selectedSub=catalog.get(root.querySelector('[name=subrace]')?.value);house=root.querySelector('[name=house]')?.value;
        const plans=[grantPlan(selectedRace,catalog),...(selectedSub?[grantPlan(selectedSub,catalog)]:[])];
        if(house){const ref=selectedRace.references.find(r=>r.role===house||r.role===`${house}.ability`||r.role===`house:${house}`);if(ref)plans.push({fixed:[],choices:[],notes:[plain(selectedRace.data[house].text)],abilities:[ref.id]});}
        if(root.querySelector('[name=demonChoice]')?.value==='skill')plans.push({fixed:[],choices:[{label:'Demon clan-related skill',options:SKILLS.map(s=>({label:s.label,path:`skills.${s.key}`})),value:5,budget:null,source:'Demon clan proficiency'}],notes:['Chosen clan-related skill instead of common weapon proficiency'],abilities:[]});
        if(!changeRace)plans.push({fixed:[],choices:[{label:'Starting skill points',options:SKILLS.map(s=>({label:s.label,path:`skills.${s.key}`})),value:1,budget:10,source:'Character creation'}],notes:[],abilities:[]});
        plan=mergePlans(plans);starters=starterClasses(plan.abilities,catalog);
        root.querySelector('[data-race-grants]').innerHTML=planHTML(plan)+starters.map((s,i)=>`<h3>Racial grant · ${esc(s.entry.name)} level ${s.level} (free)</h3>${planHTML(s.plan,'starter'+i)}`).join('');
      };
      const subLock=root.querySelector('[data-lock-subrace]');if(subLock)subLock.onclick=()=>{if(!raceLocked){ui.notifications.warn('Lock the race first.');return;}subLocked=true;root.querySelector('[name=subrace]').disabled=true;subLock.disabled=true;subLock.textContent='Sub-race locked';};
      root.querySelector('[data-ancestry]').onchange=grants;root.querySelector('[data-demon-proficiency]').onchange=grants;grants();
    };root.querySelector('[name=race]').addEventListener('change',build);root.querySelector('[data-choose-subrace]').addEventListener('change',build);root.querySelector('[data-lock-race]').onclick=()=>{raceLocked=true;root.querySelector('[name=race]').disabled=true;root.querySelector('[data-choose-subrace]').disabled=true;const house=root.querySelector('[name=house]');if(house)house.disabled=true;root.querySelector('[data-lock-race]').disabled=true;root.querySelector('[data-lock-race]').textContent='Race locked';};build();
  }});
}
export async function purchase(sheet,category,entryId=null) {
  const actor=sheet.actor,catalog=await loadCatalog();let chosen,quote,plan,ancestryPlan,ancestryChoice,houseChoice,hybridStarters=[];
  const entries=catalog.search('',{category}).sort((a,b)=>Number(a.data.tier??0)-Number(b.data.tier??0)||a.name.localeCompare(b.name));
  const choices=entryId?entries.filter(e=>e.id===entryId):entries.filter(e=>category!=='class'||classLevel(stateFor(actor),e.id)===0);
  if(!choices.length)throw new Error('No further entries are available.');
  modal(actor,`purchase:${category}`,category==='class'?'Acquire class level':'Acquire breakthrough',`${select(category==='class'?'Class · sorted by tier':'Breakthrough','entry',choices.map(e=>({id:e.id,name:`${e.category==='class'?`Tier ${e.data.tier} · `:''}${e.name}`})))}<div data-purchase-review></div>`,async form=>{
    if(!chosen||!quote)throw new Error('Choose an available entry.');
    const resolved=readPlan(form,plan);resolved.proficiencies=readProficiencies(form);
    const acknowledgement=form.querySelector('[name=requirements]');if(acknowledgement&&!acknowledgement.checked)throw new Error('Review the requirements before committing.');
    const ruling=form.querySelector('[name=gmRuling]')?.checked;
    const adjudication=ruling&&game.user.isGM?{cost:whole(form.elements.gmCost.value),ip:whole(form.elements.gmIP.value),reason:form.elements.gmReason.value.trim()}:null;
    const ancestry=ancestryPlan?readPlan(form,ancestryPlan,'ancestry'):null;
    const starterGrants=hybridStarters.map((s,i)=>readPlan(form,s.plan,'hybridStarter'+i));
    const extra=form.querySelector('[name=choices]')?.value.trim();if(extra)resolved.notes.push(extra);
    await transact(actor,state=>{
      const failures=game.settings.get("angelssword","requirementsAutoMet")?[]:requirementFailures(state,chosen,catalog);if(failures.length)throw new Error(failures.join(' '));
      const latest=quotePurchase(state,chosen,{creationPool:form.querySelector('[name=creationPool]')?.checked});
      if(latest.level!==quote.level)throw new Error('This class changed while the window was open. Reopen it to review the next level.');
      if(ancestry){
        if(chosen.name==='Faerie-Chimera Hybrid (Race)'){for(const p of state.purchases.filter(p=>p.racial)){if(state.purchases.some(q=>q.entryId===p.entryId&&!q.racial))throw new Error('De-level purchased levels of your old racial class before changing ancestry.');}state.purchases=state.purchases.filter(p=>!p.racial);const old=state.race.subraceName;state.race.grants=state.race.grants.filter(g=>g.source!==old);state.race.skillPools=(state.race.skillPools??[]).filter(p=>p.source!==old);state.race.abilities=state.race.abilities.filter(id=>!state.race.subAbilities.includes(id));}
        resolved.grants.push(...ancestry.grants);resolved.skillPools.push(...ancestry.skillPools);resolved.notes.push(...ancestry.notes);resolved.abilities.push(...ancestry.abilities);
        if(ancestryChoice){state.race.subraceId=ancestryChoice.id;state.race.subraceName=ancestryChoice.name;state.race.subAbilities=ancestry.abilities;state.race.abilities.push(...ancestry.abilities);}
        if(houseChoice)resolved.notes.push('Additional Demon house: '+houseChoice);
      }
      state=addPurchase(state,chosen,{...resolved,adjudication,creationPool:form.querySelector('[name=creationPool]')?.checked,requirements:plain(chosen.data.requirements)},meta());
      for(let i=0;i<hybridStarters.length;i++)if(classLevel(state,hybridStarters[i].entry.id)<hybridStarters[i].level)state=addPurchase(state,hybridStarters[i].entry,{...starterGrants[i],free:true,racial:true},meta());
      return state;
    });
  },{render:root=>{
    const review=()=>{
      chosen=catalog.get(root.querySelector('[name=entry]').value);const state=stateFor(actor);
      try{const failures=game.settings.get("angelssword","requirementsAutoMet")?[]:requirementFailures(state,chosen,catalog);if(failures.length)throw new Error(failures.join(' '));quote=quotePurchase(state,chosen,{creationPool:state.creation&&category==='breakthrough'});plan=grantPlan(chosen,catalog,quote.step);
      root.querySelector('[data-purchase-review]').innerHTML=`<p><strong>${quote.level?`Level ${quote.level} · `:''}${quote.cost} EXP${quote.ip?` · ${quote.ip} IP`:''}${quote.duplicateOf?' · Free identical ability':''}</strong> · Available: ${balances(state).exp} EXP / ${balances(state).ip} IP</p>${state.creation&&category==='breakthrough'?'<label><input name="creationPool" type="checkbox" checked> Use creation breakthrough EXP</label>':''}<details open><summary>Requirements</summary>${safeHTML(chosen.data.requirements??'None')}</details><label><input name="requirements" type="checkbox" required ${game.settings.get("angelssword","requirementsAutoMet")?'checked disabled':''}> Requirements are met, including any GM approval or teacher required by these rules.</label>${planHTML(plan)}<div data-ancestry-extra></div>${field('Other choices / conditions','choices')}${proficiencyFields()}${game.user.isGM?`<details><summary>GM ruling: overlap, unusable ability or mentor</summary><label><input name="gmRuling" type="checkbox"> Apply an exceptional cost</label>${field('EXP cost','gmCost',quote.cost,'number')}${field('IP cost','gmIP',quote.ip,'number')}${field('Reason for the ruling','gmReason')}</details>`:''}<details><summary>Description and guide</summary>${safeHTML(chosen.data.description??'')}${safeHTML(chosen.data.guide??'')}</details>`;
      ancestryPlan=null;ancestryChoice=null;houseChoice=null;hybridStarters=[];
      const box=root.querySelector('[data-ancestry-extra]');
      if(/^(Human-Chimera|Faerie-Chimera) Hybrid/.test(chosen.name)) {
        const other=chosen.name.startsWith('Human')||state.race?.name==='Fae'?'Chimera':'Fae';
        const parent=catalog.find(other,'race')[0];const subs=catalog.search('',{category:'subrace'}).filter(e=>e.parentId===parent.id);
        box.innerHTML=select('Hybrid subrace','hybrid',subs)+'<div data-hybrid-grants></div>';
        const update=()=>{ancestryChoice=catalog.get(box.querySelector('select').value);ancestryPlan=grantPlan(ancestryChoice,catalog);if(chosen.name.startsWith('Faerie')&&ancestryChoice.name==='High Fae'){const first=catalog.find('Faerie Flash','ability').find(a=>a.kind==='true-abilities');ancestryPlan.abilities=ancestryPlan.abilities.filter(id=>catalog.get(id)?.name!=='Faerie Flash II');if(first)ancestryPlan.abilities.push(first.id);}hybridStarters=starterClasses(ancestryPlan.abilities,catalog);box.querySelector('[data-hybrid-grants]').innerHTML=planHTML(ancestryPlan,'ancestry')+hybridStarters.map((s,i)=>`<h3>Racial grant · ${esc(s.entry.name)} level ${s.level}</h3>${planHTML(s.plan,'hybridStarter'+i)}`).join('');};box.querySelector('select').onchange=update;update();
      }
      if(chosen.name==='Mixed House (Demon)') {
        const demon=catalog.find('Demon','race')[0],houses=demon.references.filter(r=>r.role.startsWith('house:')&&r.role!=='house:'+state.race.house);
        box.innerHTML=select('Additional house','house',houses.map(r=>({id:r.role.slice(6),name:r.role.slice(6)+' · '+r.name})))+'<div data-house-grants></div>';
        const update=()=>{houseChoice=box.querySelector('select').value;const ref=houses.find(r=>r.role==='house:'+houseChoice);ancestryPlan={fixed:[],choices:[],notes:[plain(demon.data[houseChoice].text)],abilities:[ref.id]};box.querySelector('[data-house-grants]').innerHTML=planHTML(ancestryPlan,'ancestry');};box.querySelector('select').onchange=update;update();
      }
      }catch(error){quote=null;root.querySelector('[data-purchase-review]').innerHTML=`<p>${esc(error.message)}</p>`;}
    };root.querySelector('[name=entry]').addEventListener('change',review);review();
  }});
}
export function editEvent(sheet,id) {
  const event=stateFor(sheet.actor).events.find(e=>e.id===id)??{date:today(),exp:0,ip:0,kind:'session'};
  modal(sheet.actor,'event:'+ (id??'new'),'Event / session',`${select('Type','kind',[{id:event.kind,name:event.kind},{id:event.kind==='session'?'event':'session',name:event.kind==='session'?'Event':'Session'}])}${field('Name','name',event.name)}${field('Date','date',event.date,'date')}<button type="button" data-current-date>Current date</button>${field('Notes','notes',event.notes)}${field('Interlude Points gained','ip',event.ip,'number')}${field('EXP gained','exp',event.exp,'number')}`,form=>transact(sheet.actor,state=>saveEvent(state,{id,name:form.elements.name.value,date:form.elements.date.value,kind:form.elements.kind.value,notes:form.elements.notes.value,exp:form.elements.exp.value,ip:form.elements.ip.value},meta())),{render:root=>root.querySelector('[data-current-date]').onclick=()=>{root.querySelector('[name=date]').value=today();}});
}
export async function advancementContext(actor) {
  const state=stateFor(actor),b=balances(state),catalog=await loadCatalog();
  const abilityButton=id=>{const a=catalog.get(id);return a?`<button type="button" data-ability="${esc(id)}">${esc(a.name)}</button>`:'';};
  const classes=[...new Set(state.purchases.filter(p=>p.kind==='class').map(p=>p.entryId))].map(id=>{
    const rows=state.purchases.filter(p=>p.entryId===id).sort((a,b)=>a.level-b.level),entry=catalog.get(id);
    return `<details class="as-owned-class" open><summary>${esc(entry?.name??rows[0].name)} · Tier ${esc(entry?.data.tier)} · Level ${rows.length}</summary>${rows.map(p=>{
      const shared=p.abilityId&&state.purchases.filter(x=>x.abilityId===p.abilityId).length>1;
      return `<div data-record-id="${esc(p.id)}" class="as-owned-level ${shared?'as-free-level':''}"><strong>Level ${p.level}</strong> · ${p.cost} EXP${p.duplicateOf?' · free':shared?' · original paid copy; later copies free':''}<div>${p.abilities.map(abilityButton).join('')}</div>${p.step?.text?`<p>${esc(plain(p.step.text))}</p>`:''}<details><summary>Grants and choices</summary>${[...p.grants,...(p.skillPools??[]).flatMap(pool=>pool.allocations)].map(g=>`<p>🔒 ${esc(g.specialty??g.path)} ${g.value>=0?'+':''}${g.value}</p>`).join('')}${p.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</details></div>`;
    }).join('')}<div class="as-level-controls">${entry&&rows.length<8?`<button type="button" data-level-up="${esc(id)}">Level +</button>`:''}${!rows.at(-1).racial?`<button type="button" data-level-down="${esc(rows.at(-1).id)}">De-level −</button>`:''}</div></details>`;
  }).join('');
  const racial=(state.race?.abilities??[]).filter(id=>!(state.purchases.some(p=>p.name==='Human-Chimera Hybrid (Race)')&&catalog.get(id)?.name==='Human Adaptability'));
  return {balance:b,creation:state.creation,
    classHTML:`<p>${state.race?`${esc(state.race.name)}${state.race.subraceName?' · '+esc(state.race.subraceName):''}`:'No race selected'}</p>${state.race?`<details><summary>Racial traits and choices</summary>${(state.race.notes??[]).map(n=>`<p>${esc(n)}</p>`).join('')}${[...state.race.grants,...(state.race.skillPools??[]).flatMap(pool=>pool.allocations)].map(g=>`<p>🔒 ${esc(g.specialty??g.path)} ${g.value>=0?'+':''}${g.value}</p>`).join('')}</details>`:''}<p>${b.exp} EXP · ${b.ip} Interlude Points${state.creation?` · ${b.creationEXP} creation breakthrough EXP`:''}</p>${state.creation?'<button type="button" data-finish-creation>Finish creation</button>':''}<button type="button" data-purchase="class">Select class</button>${classes||'<p>No classes acquired.</p>'}`,
    breakthroughHTML:`<button type="button" data-purchase="breakthrough">Select breakthrough</button>${state.purchases.filter(p=>p.kind==='breakthrough').map(p=>`<details><summary>${esc(p.name)} · ${p.cost} EXP${p.pool==='creation'?' (creation)':''}</summary>${p.abilities.map(abilityButton).join('')}${p.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</details>`).join('')}`,
    abilityHTML:`<section><h3>Race${state.race?' · '+esc(state.race.name):''}</h3>${racial.map(abilityButton).join('')}</section><section><h3>Class</h3>${[...new Set(state.purchases.filter(p=>p.kind==='class').map(p=>p.entryId))].map(id=>{const rows=state.purchases.filter(p=>p.entryId===id).sort((a,b)=>a.level-b.level);return `<details open><summary>${esc(rows[0].name)}</summary>${rows.map(p=>`<div><small>Level ${p.level}</small> ${p.abilities.map(abilityButton).join('')}</div>`).join('')}</details>`;}).join('')}</section><section><h3>Breakthroughs</h3>${state.purchases.filter(p=>p.kind==='breakthrough').map(p=>`<details><summary>${esc(p.name)}</summary>${p.abilities.map(abilityButton).join('')}</details>`).join('')}</section><section><h3>Custom abilities</h3><button type="button" data-custom-add>Add custom ability</button>${state.custom.map(a=>`<button type="button" data-custom-ability="${esc(a.id)}">${esc(a.name)}</button>`).join('')}</section>`,
    eventHTML:`<header class="as-section-heading"><h2>Events & Sessions</h2><button type="button" data-event-add>Add event / session</button></header>${[...state.events].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<div class="as-event-row"><time>${esc(e.date)}</time><button type="button" data-event-edit="${esc(e.id)}">${esc(e.name)}</button><span>+${e.exp} EXP</span><button type="button" data-event-remove="${esc(e.id)}" aria-label="Remove event">×</button></div>`).join('')}`,
    historyHTML:[...state.history].sort((a,b)=>b.at.localeCompare(a.at)).map(h=>`<article class="as-history-row"><time>${esc(h.at.slice(0,16).replace('T',' '))}</time><strong>${esc(h.action)}</strong><p>${esc(h.detail)}${h.exp?` · ${h.exp>0?'+':''}${h.exp} EXP`:''}</p><small>${esc(h.user)}</small>${h.annotation?`<p>${esc(h.annotation)}</p>`:''}${game.user.isGM?`<button type="button" data-history-edit="${esc(h.id)}">Edit note</button>`:''}</article>`).join('')||'<p>No changes recorded yet.</p>',
    journalHTML:`<div class="as-journal-drop" data-journal-drop>Drop a Foundry Journal here to add a reference.</div>${[...new Set(state.journals.map(j=>j.folder))].sort().map(folder=>`<details open><summary>${esc(folder||'Journal')}</summary>${state.journals.filter(j=>j.folder===folder).map(j=>`<div><button type="button" ${j.uuid?`data-journal-open="${esc(j.uuid)}"`:`data-journal-local="${esc(j.id)}"`}>${esc(j.name)}</button><button type="button" data-journal-remove="${esc(j.id)}" aria-label="Remove journal reference">×</button></div>`).join('')}</details>`).join('')}`};
}
export function bindAdvancement(sheet,root) {
  const report=fn=>Promise.resolve().then(fn).catch(e=>ui.notifications.warn(e.message));
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    const d=button.dataset;
    if('historyTab'in d){sheet._tabs[0].activate('history',{triggerCallback:true});return;}
    if(d.journalLocal){const journal=stateFor(sheet.actor).journals.find(j=>j.id===d.journalLocal);if(journal)modal(sheet.actor,'journal:'+journal.id,journal.name,safeHTML(journal.content??''),()=>true,{label:'Done'});return;}
    if(d.journalOpen){report(async()=>{const doc=await fromUuid(d.journalOpen);if(doc?.testUserPermission(game.user,'LIMITED'))doc.sheet.render(true);else throw new Error('This journal is unavailable or you do not have permission.');});return;}
    if(!sheet.isEditable)return;
    if('skillPool'in d)report(()=>openSkillPool(sheet));
    if(d.purchase)report(()=>purchase(sheet,d.purchase));
    if(d.levelUp)report(()=>purchase(sheet,'class',d.levelUp));
    if(d.levelDown)report(async()=>{const catalog=await loadCatalog();await transact(sheet.actor,state=>{const next=removeLevel(state,d.levelDown,meta());for(const p of next.purchases.filter(p=>p.kind==='class'&&p.level===1)){const entry=catalog.get(p.entryId);if(entry&&requirementFailures(next,entry,catalog).length)throw new Error(`This level is required by ${p.name}. De-level that class first.`);}return next;});});
    if('eventAdd'in d)editEvent(sheet);
    if(d.eventEdit)editEvent(sheet,d.eventEdit);
    if(d.eventRemove)report(()=>transact(sheet.actor,state=>removeEvent(state,d.eventRemove,meta())));
    if('finishCreation'in d)report(()=>transact(sheet.actor,state=>{if(balances(state).exp!==0)throw new Error('Spend your remaining class EXP before finishing creation.');state.creation=false;logChange(state,meta(),'Finished creation','Unused creation breakthrough EXP expired.');return state;}));
    if(d.historyEdit&&game.user.isGM){const row=stateFor(sheet.actor).history.find(h=>h.id===d.historyEdit);modal(sheet.actor,'history:'+row.id,'History note',field('GM annotation','annotation',row.annotation),form=>transact(sheet.actor,state=>{if(!game.user.isGM)throw new Error('Only the GM may edit history.');state.history.find(h=>h.id===row.id).annotation=form.elements.annotation.value;return state;}));}
    if('customAdd'in d)modal(sheet.actor,'custom','Custom ability',`${field('Name','name')}${field('AP cost','ap',0,'number')}<label>Effects<textarea name="effects"></textarea></label>`,form=>transact(sheet.actor,state=>{if(!form.elements.name.value.trim())throw new Error('Give the ability a name.');state.custom.push({id:meta().id,name:form.elements.name.value,ap:whole(form.elements.ap.value),effects:form.elements.effects.value});return state;}));
    if(d.journalRemove)report(()=>transact(sheet.actor,state=>{state.journals=state.journals.filter(j=>j.id!==d.journalRemove);return state;}));
  });
  root.querySelector('[data-journal-drop]')?.addEventListener('dragover',event=>event.preventDefault());
  root.querySelector('[data-journal-drop]')?.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();if(!sheet.isEditable)return;report(async()=>{
    const data=JSON.parse(event.dataTransfer.getData('text/plain')),doc=await fromUuid(data.uuid);
    if(!doc||!['JournalEntry','JournalEntryPage'].includes(doc.documentName)||!doc.testUserPermission(game.user,'LIMITED'))throw new Error('Drop a journal you have permission to read.');
    modal(sheet.actor,'journal','Add journal reference',field('Folder','folder',doc.folder?.name??'Journal'),form=>transact(sheet.actor,state=>{if(!state.journals.some(j=>j.uuid===doc.uuid))state.journals.push({id:meta().id,uuid:doc.uuid,name:doc.name,folder:form.elements.folder.value.trim()});return state;}));
  });});
}

export function openSkillPool(sheet) {
  const state=stateFor(sheet.actor),pools=poolsFor(state).filter(p=>p.remaining>0);
  const options=[...new Map(pools.flatMap(p=>p.options).map(o=>[o.path,o])).values()];
  if(!options.length){ui.notifications.info('No unspent skill points.');return;}
  const c={options,budget:pools.reduce((n,p)=>n+p.remaining,0),source:'Skill pool'};
  return modal(sheet.actor,'skillPool','Spend skill points',allocationHTML(c,'pool',{poolState:state}),form=>transact(sheet.actor,current=>{const rows=readAllocation(form.querySelector('[data-allocation-key]')).rows;const next=spendPoolRows(current,rows);logChange(next,meta(),'Allocated skill points',rows.filter(r=>r.points).map(r=>`${r.points} → ${r.path}${r.expertise?' ('+r.condition+')':''}`).join(', '));return next;}));
}
export function rollSkill(sheet,def) {
  const choices=expertisesFor(sheet.actor.system,def.key);
  const roll=expertise=>new Roll('1d20 + @bonus',{bonus:skillTotal(sheet.actor.system,def)+(expertise?.value??0)}).toMessage({speaker:ChatMessage.getSpeaker({actor:sheet.actor}),flavor:`${def.label}${expertise?' · '+expertise.name:''} check`});
  if(!choices.length)return roll();
  return modal(sheet.actor,'skill-roll:'+def.key,def.label,`<p>Does an expertise apply to this check? Use one applicable expertise.</p><label><input type="radio" name="expertise" value="" checked> ${esc(def.label)} · normal check</label>${choices.map((e,i)=>`<label class="as-expertise-card"><input type="radio" name="expertise" value="${i}"><strong>${esc(e.name)}</strong> +${e.value}<small>${esc(e.sources.join(' · '))}</small></label>`).join('')}`,form=>{const value=form.querySelector('[name=expertise]:checked').value;return roll(value===''?null:choices[Number(value)]);},{label:'Roll',width:440});
}
