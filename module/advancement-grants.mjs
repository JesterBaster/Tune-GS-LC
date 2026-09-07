import { isSkillChoice, resolveSkillChoice } from "./skill-allocation.mjs";
import {PRIMARY,SECONDARY,SKILLS,skillBonusEntries,statBonusEntries} from './player-stats.mjs';
import {plain,norm,allGrants} from './advancement.mjs';
export const STAT_OPTIONS=[...PRIMARY.map(label=>({label,path:`primary.${label.toLowerCase()}`})),...SECONDARY.map(label=>({label,path:`secondary.${label.toLowerCase()}`})),...SKILLS.map(s=>({label:s.label,path:`skills.${s.key}`}))];
const primary=STAT_OPTIONS.filter(s=>s.path.startsWith('primary.')), secondary=STAT_OPTIONS.filter(s=>s.path.startsWith('secondary.')), skills=STAT_OPTIONS.filter(s=>s.path.startsWith('skills.'));
/** Deliberately only compile explicit permanent grants, never combat prose conditions. */
export function grantPlan(entry,catalog,level=null) {
  const plan={fixed:[],choices:[],notes:[],abilities:[]};
  const source=`${entry.name}${level?` · Level ${level.level}`:''}`;
  const add=(path,value)=>plan.fixed.push({path,value,source,locked:true});
  const choice=(label,options,value=1,budget=null)=>plan.choices.push({label,options,value,budget,source});
  const parseStats=text=>{
    const t=plain(text);
    for(const sentence of t.split(/[.!]/)) {
      if(!/^(?:\s*you\s+(?:also\s+)?gain|\s*gain|\s*increase)/i.test(sentence)||!/\+\d/.test(sentence))continue;
      const number=Number(sentence.match(/\+(\d+)/)?.[1]??1);
      const options=[...primary,...secondary].filter(s=>new RegExp(`\\b${s.label}\\b`,'i').test(sentence));
      if(options.length===1)add(options[0].path,number);
      else if(options.length>1) {
        if(/\bor\b|either|choice/i.test(sentence))choice(sentence.trim(),options,number);
        else options.forEach(s=>add(s.path,number));
      }
      else if(/primary|main stat/i.test(sentence))choice(sentence.trim(),primary,number);
      else if(/secondary|substat/i.test(sentence))choice(sentence.trim(),secondary,number);
    }
  };
  const parseSkills=text=>{
    const t=plain(text), expertise=/exchange.*expertise/i.test(t);
    // Split multiple grants in one sentence (Rogue), but keep comma/or allocation lists intact.
    for(const sentence of t.replace(/\s+and\s+(?=\+\d+ skill points)/gi,'. You gain ').split(/[.!]/)) {
      const match=sentence.match(/(?:gain|also gain)\s*\+?(\d+)\s*(?:skill\s*)points?\s+(?:to spend|in)/i);
      if(!match)continue;
      const options=skills.filter(s=>new RegExp(`\\b${s.label.replace(' ','\\s+')}\\b`,'i').test(sentence));
      if(/expertise/i.test(sentence)&&!expertise) {plan.notes.push(`${source}: ${sentence.trim()}`);continue;}
      const pool=options.length?options:skills;
      if(!options.length&&!/any|choice|non.crafting/i.test(sentence)) {
        const label=sentence.replace(/^.*?(?:to spend (?:on|in)|points? in)\s*/i,'').trim();
        choice(sentence.trim(),[{path:'specialty.'+norm(label),label}],1,Number(match[1]));continue;
      }
      if(/either|skill of your choice/i.test(sentence))choice(sentence.trim(),pool,Number(match[1]));
      else {choice(sentence.trim(),pool,1,Number(match[1]));plan.choices.at(-1).expertise=expertise;}
    }
  };
  const includeAbility=(id,seen=new Set())=>{
    if(seen.has(id))return;seen.add(id);const a=catalog.get(id);if(!a)return;
    plan.abilities.push(id);
    if(a.kind==='key-abilities')for(const key of ['benefit1','benefit2','benefit3','benefit4']) {parseStats(a.data[key]);parseSkills(a.data[key]);if(a.data[key])plan.notes.push(`${a.name}: ${plain(a.data[key])}`);}
    for(const ref of a.references??[])includeAbility(ref.id,seen);
    const text=plain(a.data.description);
    const speed=text.match(/(?:your\s+)?base (?:movement )?speed is (\d+)\s*ft/i);
    if(speed)add('combat.speedBase',Number(speed[1]));
    if(a.name==='Expert Scribe')plan.fixed.push({path:'expertise.skills.art',value:5,source,locked:true,specialty:'Calligraphy'});
    if(a.name==='Independent Actor')plan.fixed.push({path:'expertise.skills.art',value:5,source,locked:true,specialty:'Cartography'});
    if(a.name==='Tiny Pixie'){add('primary.toughness',-2);add('primary.agility',2);}
    if(a.name==='Stoneskin'){add('combat.guardBonus',1);add('combat.blockBonus',3);add('combat.evasionBonus',-2);}
    for(const [name,key,specialty,value] of [['Scent','perception','Smell',5],['Antennae','perception','Vibration Sense (creatures within 40ft)',10],['Weighing the Heart','insight','Discerning lies',5]])if(a.name===name)plan.fixed.push({path:'expertise.skills.'+key,value,source,locked:true,specialty});
    if(a.name==="Fighter's Journey")add('resource.health',5);
    if(a.name==='Expanded Circuits')add('resource.mp',2);
    if(a.name==="Gunslinger's Agility")add('combat.initiativeBonus',1);
    if(a.kind!=='key-abilities'&&text)plan.notes.push(`${a.name}: ${text}`);
    for(const child of catalog.search('',{category:'ability'}).filter(x=>x.parentId===id))if(!plan.abilities.includes(child.id))plan.abilities.push(child.id);
  };
  if(entry.category==='race') {
    if(entry.name==='Human'){choice('Human primary stat',primary);choice('Human secondary stat',secondary);}
    else parseStats(entry.data.attributes);
    parseSkills(entry.data.skills);
    plan.notes.push(plain(entry.data.proficiencies));
    // House references are included only after the selected house is resolved.
    for(const ref of entry.references.filter(r=>/^ability\d+$/.test(r.role)))includeAbility(ref.id);
  } else if(entry.category==='subrace')for(const ref of entry.references)includeAbility(ref.id);
  else if(entry.category==='class'&&level) {
    if(level.abilityId)includeAbility(level.abilityId);
    else {parseStats(level.text);parseSkills(level.text);plan.notes.push(plain(level.text));}
  } else if(entry.category==='breakthrough') {
    const name=entry.name;plan.abilities.push(entry.id);
    if(name==='Primary Stat Training'||name==='Universal Training')choice('Primary stat',primary);
    if(name==='Secondary Stat Training'||name==='Universal Training')choice('Secondary stat',secondary);
    if(name==='Skill Training'||name==='Universal Training')choice('Skill points',skills,1,name==='Universal Training'?5:1);
    if(name==='On the draw')add('combat.initiativeBonus',1);
    if(name==='Fast Movement (Centaur)')add('combat.speedBonus',5);
    if(/^Wide Circuits/.test(name))add('resource.mp',1);
    for(const ref of entry.references)includeAbility(ref.id);
    plan.notes.push(plain(entry.data.description));
  }
  plan.abilities=[...new Set(plan.abilities)];return plan;
}
export function resolvePlan(plan,values) {
  const grants=structuredClone(plan.fixed),skillPools=[];
  plan.choices.forEach((c,i)=>{
    if(isSkillChoice(c)){skillPools.push(resolveSkillChoice(c,values[i]));return;}
    const option=c.options.find(o=>o.path===values[i]);if(!option)throw new Error(`Choose ${c.label}.`);
    grants.push({path:option.path,value:c.value,source:c.source,locked:true});
  });return {grants,skillPools,notes:structuredClone(plan.notes),abilities:structuredClone(plan.abilities)};
}
/** Rebuilt from the canonical purchase records on every prepare, never persisted twice. */
export function applyGrants(system,state) {
  for(const group of ['primary','secondary','skills'])for(const stat of Object.values(system[group]??{}))if(Array.isArray(stat.bonuses))stat.bonuses=stat.bonuses.filter(b=>!b.managed);
  system.advancementCombat={};system.advancementResources={};system.expertiseGrants=[];
  for(const grant of allGrants(state)) {
    const [group,key]=grant.path.split('.');
    if(['primary','secondary','skills'].includes(group)&&STAT_OPTIONS.some(o=>o.path===grant.path)) {
      system[group]??={};const stat=system[group][key]??={base:0,bonus:0};stat.bonuses??=group==='skills'?skillBonusEntries(stat):statBonusEntries(stat);
      stat.bonuses.push({value:grant.value,source:grant.source,locked:true,managed:true});
    } else if(group==='combat')system.advancementCombat[key]=key==='speedBase'?grant.value:(system.advancementCombat[key]??0)+grant.value;
    else if(group==='expertise'||group==='specialty')system.expertiseGrants.push(grant);
    else if(group==='resource')system.advancementResources[key]=(system.advancementResources[key]??0)+grant.value;
  }
}

export function starterClasses(abilityIds,catalog) {
  const records=[];
  for(const id of abilityIds){const a=catalog.get(id),match=plain(a?.data.description).match(/You start with the (.+?) class unlocked and at level (\d+)/i);if(!match)continue;
    const entry=catalog.find(match[1],'class')[0];if(!entry)throw new Error('Missing racial starter class: '+match[1]);
    for(let level=1;level<=Number(match[2]);level++)records.push({entry,level,plan:grantPlan(entry,catalog,entry.levels[level-1])});
  }return records;
}
