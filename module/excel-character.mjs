import {catalogImage,catalogEquipment} from './loadout-rules.mjs';
import {PRIMARY,SECONDARY,SKILLS,statTotal,skillTotal} from './player-stats.mjs';
import {grantPlan,applyGrants,STAT_OPTIONS,starterClasses} from './advancement-grants.mjs';
import {isSkillChoice,resolveSkillChoice,poolsFor} from './skill-allocation.mjs';
import {allGrants,norm,plain,balances} from './advancement.mjs';
import {itemData,inferKind} from './inventory.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=text=>'<p>'+escape(text).replace(/\n/g,'<br>')+'</p>';
const getSheet=(book,name)=>book.sheets.find(s=>norm(s.name)===norm(name));
const val=(sheet,cell)=>sheet?.cells[cell]?.value;
const num=(sheet,cell)=>{const value=val(sheet,cell);return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;};
const pathFor=name=>STAT_OPTIONS.find(o=>norm(o.label)===norm(name)||o.path==='skills.appraise'&&norm(name)==='appraisal')?.path;
const textRows=sheet=>sheet?Array.from({length:sheet.rows},(_,i)=>Object.entries(sheet.cells).filter(([a,c])=>Number(a.match(/\d+/)?.[0])===i+1&&(c.value!==null&&c.value!==undefined||c.note)).sort(([a],[b])=>a.replace(/\d/g,'').length-b.replace(/\d/g,'').length||a.localeCompare(b)).map(([,c])=>[c.value,c.hyperlink,c.note].filter(Boolean).join('\n')).join(' · ')).filter(Boolean):[];
export function notedBonuses(text) {
  const result={};for(const match of String(text??'').matchAll(/([+-]\s*\d+)\s+([a-z][a-z ]*?)(?=,|;|\n|[+-]\s*\d|$)/gi)){
    const path=pathFor(match[2].trim());if(path)result[path]=(result[path]??0)+Number(match[1].replace(/\s/g,''));
  }return result;
}
export function buildCharacterDraft(book,catalog,{mappings={},id='excel',at=new Date().toISOString()}={}) {
  const core=getSheet(book,'Core');if(!core||norm(val(core,'A2'))!=='name'||norm(val(core,'E8'))!=='skill')throw new Error('This importer expects the Lyrian character workbook with its Core, class, skill and inventory sections.');
  const warnings=[],unmatched=[],adjustments=[],plans=[],sources=[];
  const match=(name,category)=>{
    if(!name)return null;const key=category+':'+name,selection=mappings[key];
    if(selection==='custom')return null;
    if(selection){const entry=catalog.get(selection);if(entry?.category===category)return entry;throw new Error('Invalid catalog mapping for '+name);}
    const matches=catalog.find(String(name),category);if(matches.length===1)return matches[0];
    unmatched.push({key,name:String(name),category});return null;
  };
  const state={version:1,initialized:false,imported:true,creation:false,openingEXP:0,openingSpent:0,openingIP:3,events:[],purchases:[],history:[],journals:[],custom:[],race:null};
  const system={primary:{},secondary:{},skills:{},resources:{health:{temp:0},mp:{temp:0},rp:{temp:0},ap:{total:4}},combat:{},biography:''};
  const targets={};
  for(const [group,labels,labelCol,valueCol,start] of [['primary',PRIMARY,'A','B',9],['secondary',SECONDARY,'C','D',9]])for(const label of labels){
    const row=Array.from({length:labels.length},(_,i)=>i+start).find(r=>norm(val(core,labelCol+r))===norm(label));
    if(row!==undefined&&num(core,valueCol+row)!==null)targets[group+'.'+label.toLowerCase()]=num(core,valueCol+row);
    const arrayLabel=group==='primary'?'B':'D',arrayValue=group==='primary'?'A':'C';
    const arrayRow=Array.from({length:labels.length},(_,i)=>i+45).find(r=>norm(val(core,arrayLabel+r))===norm(label));
    if(arrayRow===undefined||num(core,arrayValue+arrayRow)===null)throw new Error('Missing base array value for '+label+'. Export the workbook with calculated values before importing.');
    system[group][label.toLowerCase()]={base:num(core,arrayValue+arrayRow),bonuses:[]};
  }
  for(const skill of SKILLS){const row=Array.from({length:21},(_,i)=>i+9).find(r=>pathFor(val(core,'E'+r))==='skills.'+skill.key);system.skills[skill.key]={points:0,bonuses:[]};if(row!==undefined){
    const total=num(core,'G'+row),bonus=num(core,'H'+row);targets['skills.'+skill.key]=total??(bonus!==null?(targets['secondary.'+skill.stat]??0)+bonus:null);
    if(total===null&&bonus===null)warnings.push('No cached skill value for '+skill.label+'.');
  }}
  const raceName=String(val(core,'D2')??'').trim();if(!raceName)throw new Error('The workbook has no race selected.');
  const race=match(raceName,'race'),subName=String(val(core,'D3')??'').trim();
  const house=race?.name==='Demon'?Object.keys(race.data).find(k=>race.data[k]?.ability&&norm(subName.replace(/house|clan|of/gi,''))===norm(k)):null;
  const sub=subName&&!house?match(subName,'subrace'):null;
  if(sub&&race&&sub.parentId!==race.id)throw new Error(sub.name+' does not belong to '+race.name+'. Check the workbook or mapping.');
  const own=(owner,entry,level)=>{if(!entry)return;const plan=grantPlan(entry,catalog,level);owner.grants.push(...plan.fixed);owner.notes.push(...plan.notes);owner.abilities.push(...plan.abilities);plans.push({owner,plan,entry});};
  state.race={id:race?.id??id+':race',name:race?.name??raceName,subraceId:sub?.id,subraceName:sub?.name??subName,grants:[],skillPools:[],notes:[],abilities:[],proficiencies:{}};
  own(state.race,race);state.race.baseAbilities=[...state.race.abilities];own(state.race,sub);state.race.subAbilities=state.race.abilities.filter(a=>!state.race.baseAbilities.includes(a));
  if(house){state.race.house=house;state.race.notes.push(plain(race.data[house].text));const ref=race.references.find(r=>r.role==='house:'+house);if(ref)state.race.abilities.push(ref.id);}
  const creation=resolveSkillChoice({options:SKILLS.map(s=>({path:'skills.'+s.key,label:s.label})),budget:10,source:'Character creation'},{rows:[]});state.race.skillPools.push(creation);
  let sequence=0,historicalExtra=0;
  for(let row=15;row<=35;row++) {
    const name=String(val(core,'A'+row)??'').trim();if(!name)continue;const entry=match(name,'class'),level=num(core,'C'+row);
    if(state.purchases.some(p=>p.entryId===(entry?.id??id+':class:'+norm(name))))throw new Error('The same class appears more than once: '+name+'. Combine its levels in one workbook row.');
    if(!Number.isInteger(level)||level<1||level>8)throw new Error('Invalid class level at Core!C'+row+'.');
    const recorded=num(core,'D'+row),records=[];
    for(let n=1;n<=level;n++) {
      const step=entry?.levels.find(l=>l.level===n),original=step?.abilityId?state.purchases.find(p=>p.abilityId===step.abilityId):null;
      const p={id:id+':class:'+sequence++,at,kind:'class',entryId:entry?.id??id+':class:'+norm(name),name:entry?.name??name,level:n,step:step??{level:n,text:'Imported class; catalog mapping unavailable.'},abilityId:step?.abilityId??null,cost:original?0:n===1?(Number(entry?.data.tier)||num(core,'B'+row)||1)*100:100,ip:n===1?1:0,pool:'exp',duplicateOf:original?.duplicateOf??original?.id??null,grants:[],skillPools:[],notes:[],abilities:[],proficiencies:{}};
      own(p,entry,step);records.push(p);state.purchases.push(p);
    }
    if(recorded!==null){const computed=records.reduce((n,p)=>n+p.cost,0);if(recorded!==computed){warnings.push(`${name}: spreadsheet cost ${recorded} differs from reconstructed ${computed}. Recorded total is preserved.`);let left=Math.max(0,recorded);for(const p of [...records].reverse()){p.cost=Math.min(p.cost,left);left-=p.cost;}const paid=records.find(p=>!p.duplicateOf);if(paid)paid.cost+=left;else historicalExtra+=left;}}
  }
  const starters=starterClasses(state.race.abilities,catalog);
  for(const note of state.race.notes){const m=note.match(/You start with the (.+?) class unlocked and at level (\d+)/i);if(m){const entry=catalog.find(m[1],'class')[0];if(entry)for(let level=1;level<=Number(m[2]);level++)starters.push({entry,level});}}
  for(const {entry,level}of starters){let p=state.purchases.find(p=>p.entryId===entry.id&&p.level===level);if(p){historicalExtra+=p.cost;p.cost=0;p.ip=0;p.racial=true;continue;}
    const step=entry.levels.find(l=>l.level===level);p={id:id+':class:'+sequence++,at,kind:'class',entryId:entry.id,name:entry.name,level,step,abilityId:step?.abilityId??null,cost:0,ip:0,pool:'exp',racial:true,grants:[],skillPools:[],notes:[],abilities:[],proficiencies:{}};own(p,entry,step);state.purchases.push(p);
  }
  const breakthroughs=getSheet(book,'Breakthrough');
  for(let row=2;row<=(breakthroughs?.rows??0);row++) {
    const name=String(val(breakthroughs,'A'+row)??'').trim();if(!name)continue;const entry=match(name,'breakthrough'),cost=num(breakthroughs,'B'+row)??(Number(entry?.data.cost)||0);
    const p={id:id+':break:'+sequence++,at,kind:'breakthrough',entryId:entry?.id??id+':break:'+norm(name),name:entry?.name??name,cost:Math.max(0,cost),ip:0,pool:cost===0?'creation':'exp',grants:[],skillPools:[],notes:[],abilities:[],proficiencies:{}};
    own(p,entry);if(!entry)p.notes.push(String(val(breakthroughs,'D'+row)??''));state.purchases.push(p);
  }
  // Source notes are evidence of choices; they are not added on top of existing grants.
  const owners=[state.race,...state.purchases],requests=new Map();
  for(const [address,cell] of Object.entries(core.cells))if(cell.note&&/[+-]\s*\d/.test(String(cell.value))){
    const ownerName=cell.note.trim(),owner=owners.find(o=>norm(o.name)===norm(ownerName));if(!owner)continue;
    const req=requests.get(ownerName)??{};for(const [path,n]of Object.entries(notedBonuses(cell.value)))req[path]=(req[path]??0)+n;requests.set(ownerName,req);sources.push({cell:address,source:ownerName,bonuses:cell.value});
  }
  for(const [address,cell]of Object.entries(core.cells))if(cell.note&&typeof cell.value==='number'){
    const owner=owners.find(o=>norm(o.name)===norm(cell.note));if(!owner)continue;
    const row=Number(address.match(/\d+/)?.[0]),column=address.replace(/\d+/,'');
    const label=column==='H'&&row>=9&&row<=29?val(core,'E'+row):column==='F'&&row>=45&&row<=48?val(core,'E'+row):column==='H'&&row>=45&&row<=49?val(core,'G'+row):null;
    const path=pathFor(label);if(!path)continue;const req=requests.get(owner.name)??{};req[path]=(req[path]??0)+cell.value;requests.set(owner.name,req);
  }
  for(const owner of owners)for(const g of owner.grants){const req=requests.get(owner.name);if(req&&req[g.path]>0)req[g.path]=Math.max(0,req[g.path]-g.value);}
  for(const {owner,plan} of plans)for(const choice of plan.choices){
    if(isSkillChoice(choice)){const pool=resolveSkillChoice(choice,{rows:[]});owner.skillPools.push(pool);for(const g of pool.allocations){const req=requests.get(owner.name);if(req&&req[g.path]>0)req[g.path]=Math.max(0,req[g.path]-g.value);}continue;}
    const req=requests.get(owner.name);
    const need=path=>{const [group,key]=path.split('.');return (targets[path]??0)-(system[group]?.[key]?.base??0)-allGrants(state).filter(g=>g.path===path).reduce((n,g)=>n+g.value,0);};
    let option=choice.options.find(o=>(req?.[o.path]??0)>=choice.value&&need(o.path)>=choice.value);
    if(!option){const plausible=choice.options.filter(o=>need(o.path)>=choice.value);if(plausible.length===1){option=plausible[0];warnings.push(`${choice.source}: inferred ${option.label} from the recorded totals; source notes were missing or inconsistent.`);}}
    if(option){owner.grants.push({path:option.path,value:choice.value,source:choice.source,locked:true});if(req)req[option.path]=Math.max(0,(req[option.path]??0)-choice.value);}
    else warnings.push(`${choice.source}: the ${choice.label} choice is not recorded clearly; any visible difference is retained as an imported adjustment.`);
  }
  const prepare=()=>{applyGrants(system,state);};prepare();
  // Match the stat snapshot while retaining the base arrays and identifiable source grants.
  for(const group of ['primary','secondary'])for(const [key,stat] of Object.entries(system[group])){
    const target=targets[group+'.'+key];if(target===undefined)throw new Error('Missing cached stat total: '+key);
    const delta=target-statTotal(stat);if(delta){stat.bonuses.push({value:delta,source:'Excel: unexplained '+key+' difference'});adjustments.push({name:key,value:delta,source:'Imported stat difference'});}
  }
  for(const owner of owners)for(const pool of owner.skillPools)if(pool.remaining)for(const option of pool.options){
    const key=option.path.split('.')[1],skill=SKILLS.find(s=>s.key===key);if(!skill)continue;
    const req=requests.get(owner.name),observed=targets[option.path];if(observed===null||observed===undefined)continue;
    const take=Math.min(pool.remaining,Math.max(0,(req?.[option.path]??0)),Math.max(0,observed-skillTotal(system,skill)));
    if(take){pool.remaining-=take;req[option.path]-=take;pool.allocations.push({path:option.path,value:take,points:take,source:pool.source,locked:true});prepare();}
  }
  for(const skill of SKILLS){const path='skills.'+skill.key,target=targets[path];if(target===null||target===undefined)continue;
    let left=Math.max(0,target-skillTotal(system,skill));
    for(const pool of poolsFor(state)){if(!pool.options.some(o=>o.path===path))continue;const take=Math.min(left,pool.remaining);if(take){pool.remaining-=take;left-=take;pool.allocations.push({path,value:take,points:take,source:pool.source,locked:true});}if(!left)break;}
    prepare();const delta=target-skillTotal(system,skill);if(delta){const row=Array.from({length:21},(_,i)=>i+9).find(r=>pathFor(val(core,'E'+r))===path),note=core.cells['H'+row]?.note;system.skills[skill.key].bonuses.push({value:delta,source:note?`Excel Core!H${row}: ${note}`:'Excel: additional '+skill.label+' bonus'});adjustments.push({name:skill.label,value:delta,source:note??'Imported skill difference'});}
  }
  state.importGrants=[];
  for(let row=9;row<=30;row++){
    const name=String(val(core,'K'+row)??'').trim(),total=num(core,'L'+row);if(!name||total===null)continue;
    const path='specialty.'+norm(name),existing=allGrants(state).filter(g=>g.path===path).reduce((n,g)=>n+g.value,0);
    if(total!==existing)state.importGrants.push({path,value:total-existing,source:'Excel crafting skill: '+name,locked:true});
  }
  // Named proficiencies in notes are attached to their owning race/class, so removals remain conventional.
  for(const [cell,category]of [['J9','Armor'],['J10','Languages'],['J11','Weapons'],['J12','Elemental masteries']])for(const line of String(core.cells[cell]?.note??'').split('\n').map(s=>s.trim()).filter(s=>s&&!/^description$/i.test(s))){
    const colon=line.indexOf(':'),source=colon>=0?line.slice(0,colon).trim():null,value=colon>=0?line.slice(colon+1).trim():line;
    const owner=source?owners.find(o=>norm(o.name)===norm(source)):null;
    const dest=owner?(owner.proficiencies??={}):(state.proficiencies??={});dest[category]=[dest[category],value].filter(Boolean).join('; ');
  }
  // Preserve extra listed abilities without duplicating those already granted by owned levels/race.
  const owned=new Set(owners.flatMap(o=>o.abilities));
  for(const name of ['Abilities','Custom Abilities','Crafting & Gathering Abilities']){const sheet=getSheet(book,name);for(let row=2;row<=(sheet?.rows??0);row++){
    const title=String(val(sheet,'A'+row)??'').trim();if(!title||/ability name|^(active|passive|class|race) abilities$/i.test(title))continue;const found=catalog.find(title,'ability')[0];if(found&&owned.has(found.id))continue;
    const effects=['B','C','D','E','F','G'].map(c=>val(sheet,c+row)).filter(v=>v!==null&&v!==undefined).join('\n');
    state.custom.push({id:id+':ability:'+sequence++,name:title,ap:String(val(sheet,'B'+row)??'').match(/AP:\s*(\d+)/i)?.[1]??null,effects:effects||plain(found?.data.description)||'Imported ability; no cached description.',catalogId:found?.id});if(found)owned.add(found.id);
  }}
  const items=[];
  for(const sheet of book.sheets){if(!/inventory|locker/i.test(sheet.name))continue;
    for(let row=2;row<=sheet.rows;row++){
      const name=String(val(sheet,'A'+row)??'').trim(),quantity=num(sheet,'B'+row);if(!name||quantity===null)continue;
      const entry=catalog.find(name,'item')[0],kind=inferKind(name,String(val(sheet,'C'+row)??entry?.data.type??''));
      const cellNotes=Object.entries(sheet.cells).filter(([a,c])=>Number(a.match(/\d+/)?.[0])===row&&c.note).map(([a,c])=>`${a}: ${c.note}`).join('\n');
      const description=[val(sheet,'F'+row),cellNotes,entry?plain(entry.data.description):''].filter(Boolean).join('\n');
      const rowBurden=num(sheet,'C'+row),perItem=/each|per item|unit/i.test(String(val(sheet,'C1')??''));
      const burden=rowBurden!==null?(perItem?rowBurden:quantity>0?rowBurden/quantity:0):Number(entry?.data.burden)||0;
      const item=itemData({name,kind,quantity:Math.max(0,quantity),burden:Math.max(0,burden??0),price:Math.max(0,num(sheet,'D'+row)??0),location:/locker/i.test(sheet.name)?sheet.name:'Carried',description:html(description),catalogId:entry?.id,source:{sheet:sheet.name,row}});
      if(entry){item.flags.angelssword.catalogData=entry.data;Object.assign(item.system,catalogEquipment(entry));if(catalogImage(entry))item.img=catalogImage(entry);}
      items.push(item);
    }
  }
  // Equipped loadout is recorded separately from carried inventory in this workbook.
  for(let row=37;row<=42;row++)for(const column of ['A','F']) {
    const name=String(val(core,column+row)??'').trim();if(!name)continue;
    let item=items.find(i=>norm(i.name)===norm(name)&&i.system.location==='Carried');
    if(!item){item=itemData({name,kind:column==='A'?'Weapon':inferKind(name),quantity:1,source:{sheet:'Core',cell:column+row}});items.push(item);}
    item.system.equipped=true;
    if(column==='A'){
      const formula=(value,multiplier)=>String(value??'').replace(/\+\s*(\d+)$/,(_,bonus)=>` + ${multiplier===2?'2 * ':''}@primary.power.total${Number(bonus)-multiplier*targets['primary.power']?` + (${Number(bonus)-multiplier*targets['primary.power']})`:''}`);
      item.system.damage=formula(val(core,'D'+row),1);item.system.heavyDamage=formula(val(core,'E'+row),2);
    }
    else {item.system.guard=num(core,'G'+row)??0;item.system.block=num(core,'I'+row)??0;item.system.evasionPenalty=num(core,'H'+row)??0;item.system.initiativePenalty=num(core,'J'+row)??0;}
    if(core.cells[column+row]?.note)item.system.description+=html(core.cells[column+row].note);
  }
  const armor=items.filter(i=>i.system.equipped&&i.system.kind==='Armor');
  if(armor.length===1&&/IF\(\s*G32\s*,\s*15\s*,\s*20\s*\)/i.test(core.cells.H6?.formula??'')&&val(core,'G32')===true)armor[0].system.speedPenalty=5;
  const backstory=getSheet(book,'Backstory');system.biography=textRows(backstory).map(html).join('');
  const journalRows=textRows(getSheet(book,'Journals')),journals=journalRows.map((text,i)=>({name:text.split(' · ')[0].slice(0,120)||'Journal '+(i+1),content:html(text),folder:'Imported journals'}));
  const spend=state.purchases.filter(p=>p.pool==='exp').reduce((n,p)=>n+p.cost,0),available=num(core,'D4');
  if(available===null||available<0)throw new Error('Core!D4 needs a nonnegative cached available EXP value.');
  state.openingEXP=spend+available;state.openingSpent=historicalExtra;state.openingIP=Math.max(3,state.purchases.reduce((n,p)=>n+p.ip,0));
  const starting=1000+(state.race.name==='Human'&&!state.purchases.some(p=>p.name==='Human-Chimera Hybrid (Race)')?100:0)-(state.purchases.some(p=>p.name==='Slow Starter')?200:0);
  state.initialized=true;state.importOpeningEXP=spend+available-starting;
  if(historicalExtra)warnings.push(`${historicalExtra} historical EXP is retained separately from currently free class grants.`);
  if(state.purchases.some(p=>p.name==='Slow Starter')){
    const previousStarting=starting;
    state.slowStarterBaseEarned=Math.min(500,Math.floor(Math.max(0,spend+historicalExtra+available-previousStarting)/2));
    warnings.push(`Slow Starter: ${state.slowStarterBaseEarned} of its 500 base EXP allowance is already consumed, inferred from the imported EXP snapshot.`);
  }
  if(state.openingIP>3)warnings.push('Original Interlude Point history is unavailable. Imported class unlocks are funded; no extra unused IP is assumed.');
  state.history.push({id:id+':history',at,user:'Excel import',action:'Imported character',detail:'Imported workbook snapshot. Source notes retained; prior acquisition dates were unavailable.',exp:0});
  state.import={id,at,notes:book.notes,sources,unmatched,adjustments};
  const derivedSnapshot=structuredClone(system);prepare();
  // Persist only manual additions: managed additions are reconstructed from the ledger.
  for(const group of ['primary','secondary','skills'])for(const stat of Object.values(system[group])){stat.bonuses=stat.bonuses.filter(b=>!b.managed);delete stat.bonus;delete stat.total;}
  delete system.advancementCombat;delete system.advancementResources;delete system.expertiseGrants;
  return {name:String(val(core,'B2')??'Imported character'),state,system,items,journals,image:book.image,warnings,unmatched,adjustments,targets,derivedSnapshot,balance:balances(state)};
}
