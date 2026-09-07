import {plain,norm,classLevel} from './advancement.mjs';
/** Enforce machine-verifiable clauses. Unmodelled story/proficiency clauses remain in the review. */
export function requirementFailures(state,entry,catalog) {
  const text=plain(entry.data.requirements),failures=[];
  const classes=catalog.search('',{category:'class'}),mastered=classes.filter(c=>classLevel(state,c.id)===8);
  const race=state.race?.name??'',subrace=state.race?.subraceName??'';
  const n=entry.name;
  const requiredRace=n==='Human-Chimera Hybrid (Race)'||n==='Angelblooded (Human) (Restricted)'?'Human':n==='Mixed House (Demon)'?'Demon':null;
  if(requiredRace&&race!==requiredRace)failures.push(`Requires ${requiredRace}.`);
  if(n==='Faerie-Chimera Hybrid (Race)'&&!['Fae','Chimera'].includes(race))failures.push('Requires Fae or Chimera.');
  if(n==='Small Specimen (Cowfolk)'&&!/cowfolk/i.test(subrace))failures.push('Requires Cowfolk.');
  if(n==='Fast Movement (Centaur)'&&!/centaur|arachne/i.test(subrace))failures.push('Requires Centaur or Arachne.');
  if(n==='Angelblooded (Human) (Restricted)'&&state.purchases.some(p=>/Hybrid/.test(p.name)))failures.push('Requires only Human ancestry.');
  const circuit=n.match(/^Wide Circuits (II|III|IV)$/);if(circuit){const previous={II:'I',III:'II',IV:'III'}[circuit[1]];if(!state.purchases.some(p=>p.name===`Wide Circuits ${previous}`))failures.push(`Requires Wide Circuits ${previous}.`);}
  if(entry.category!=='class')return failures;
  for(const sentence of text.replace(/mastered\s+and\s+/gi,'mastered. ').replace(/,\s*(?=(?:any|one) tier)/gi,'. ').split(/[.;]/).map(s=>s.trim()).filter(Boolean)) {
    // A simple list joined by “or” before “mastered”, including tier alternatives.
    const m=sentence.match(/^(.+?) mastered(?:\s*[,]|$)/i);
    if(m) {
      const prefix=m[1],known=classes.filter(c=>new RegExp(`(?:^|,| or )\\s*${c.name.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\s*,|\\s+or|$)`,'i').test(prefix));
      if(/^(?:any|at least 1|one) class$/i.test(prefix)&&!mastered.length)failures.push('Requires a mastered class.');
      else if(/^(?:any|one) tier (\d+)(?: class)?$/i.test(prefix)){const tier=Number(prefix.match(/\d+/)[0]);if(!mastered.some(c=>Number(c.data.tier)===tier))failures.push(`Requires a mastered tier ${tier} class.`);}
      else if(known.length&&known.map(c=>c.name.trim().toLowerCase()).join(' or ')===prefix.toLowerCase()&&!known.some(c=>classLevel(state,c.id)===8))failures.push(`Requires ${prefix} mastered.`);
      else if(known.length&&/^[\w\s,:-]+$/.test(prefix)&&!prefix.includes(' and ')&&!known.some(c=>classLevel(state,c.id)===8))failures.push(`Requires ${prefix} mastered.`);
    }
    if(/^Two classes mastered/i.test(sentence)&&mastered.length<2)failures.push('Requires two mastered classes.');
    if(/^(?:Human|Fae)(?: only)?$/i.test(sentence)&&norm(race)!==norm(sentence.replace(/ only/i,'')))failures.push(`Requires ${sentence}.`);
    const bt=sentence.match(/(?:must have (?:the )?)[“"]?(.+?)[”"]? breakthrough/i);
    if(bt&&!state.purchases.some(p=>p.kind==='breakthrough'&&(norm(p.name).startsWith(norm(bt[1])))))failures.push(`Requires the ${bt[1]} breakthrough.`);
  }
  return [...new Set(failures)];
}
