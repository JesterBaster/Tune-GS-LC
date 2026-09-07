/** One allocation and pool representation for race, class, level and creation grants. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isSkillChoice=c=>c.options?.length>0&&c.options.every(o=>/^(skills|specialty)\./.test(o.path));
export function normalizeSkillChoice(c) {return {...c,budget:c.budget??c.value,expertise:true};}
export function resolveSkillChoice(choice,value={rows:[],defer:true}) {
  const c=normalizeSkillChoice(choice);
  if(c.options.length===1)value={rows:[{path:c.options[0].path,points:c.budget}],defer:true};
  const rows=value.rows??[];
  if(rows.length>5)throw new Error('Use at most five allocation rows.');
  const pool={source:c.source,options:structuredClone(c.options),expertise:true,total:c.budget,remaining:c.budget,allocations:[]};
  for(const row of rows) {
    const points=Number(row.points);if(!Number.isSafeInteger(points)||points<0)throw new Error('Use non-negative whole skill points.');
    if(!points)continue;
    if(!c.options.some(o=>o.path===row.path))throw new Error('This source cannot grant the selected skill.');
    if(points>pool.remaining)throw new Error('Not enough skill points remain.');
    if(row.expertise&&!String(row.condition??'').trim())throw new Error('Give each expertise a condition.');
    pool.remaining-=points;pool.allocations.push({path:(row.expertise?'expertise.':'')+row.path,value:points*(row.expertise?2:1),points,source:c.source,locked:true,...(row.expertise?{specialty:row.condition.trim()}: {})});
  }
  
  return pool;
}
export function poolsFor(state) {
  return [state.race,...state.purchases].filter(Boolean).flatMap(owner=>owner.skillPools??[]);
}
export function normalizeSinglePools(state) {
 const next=structuredClone(state);
 for(const pool of poolsFor(next))if(pool.options.length===1&&pool.remaining>0){pool.allocations??=[];pool.allocations.push({path:pool.options[0].path,value:pool.remaining,points:pool.remaining,source:pool.source,locked:true});pool.remaining=0;}
 return next;
}
export function poolGrants(state) {return poolsFor(normalizeSinglePools(state)).flatMap(p=>p.allocations??[]);}
/** Mutate only a draft, consuming the earliest compatible source for each request. */
export function spendPoolRows(state,rows,{validateConditions=true}={}) {
  const next=structuredClone(state);if(rows.length>5)throw new Error('Use at most five allocation rows.');
  for(const row of rows) {
    let left=Number(row.points);if(!Number.isSafeInteger(left)||left<0)throw new Error('Use non-negative whole skill points.');
    if(left&&row.expertise&&validateConditions&&!String(row.condition??'').trim())throw new Error('Give each expertise a condition.');
    for(const pool of poolsFor(next)) {
      if(!left)break;
      if(!pool.options.some(o=>o.path===row.path)||row.expertise&&!pool.expertise)continue;
      const take=Math.min(left,pool.remaining);if(!take)continue;
      pool.remaining-=take;left-=take;
      pool.allocations.push({path:(row.expertise?'expertise.':'')+row.path,value:take*(row.expertise?2:1),points:take,source:pool.source,locked:true,...(row.expertise?{specialty:String(row.condition??'').trim()}: {})});
    }
    if(left)throw new Error('Not enough compatible skill points remain.');
  }return next;
}
export function allocationHTML(choice,key,{poolState=null}={}) {
  const c=normalizeSkillChoice(choice);
  return `<fieldset class="as-allocation-box" data-allocation-key="${esc(key)}" data-allocation-choice="${esc(JSON.stringify(c))}" ${poolState?`data-pool-state="${esc(JSON.stringify(poolState))}"`:''}><legend>Allocate points · ${c.budget}</legend><small>${esc(c.source)}</small><p class="as-allocation-remaining">${c.budget} remaining</p><div data-allocation-rows>${rowHTML(c)}</div><button type="button" class="as-add-allocation" data-add-allocation>Add another…</button>${poolState?'':'<p class="as-defer">Unused points stay in the skill pool.</p>'}<div data-pool-balances>${poolState?poolsFor(poolState).map(p=>`<p>${esc(p.source)}: ${p.remaining} / ${p.total}</p>`).join(''):''}</div></fieldset>`;
}
function rowHTML(c) {return `<div class="as-allocation-row"><select data-allocation-skill aria-label="Skill">${c.options.map(o=>`<option value="${esc(o.path)}">${esc(o.label)}</option>`).join('')}</select><div class="as-point-counter"><button type="button" data-point-minus aria-label="Remove point">−</button><output data-points>0</output><button type="button" data-point-plus aria-label="Add point">+</button></div><label><input type="checkbox" data-expertise> Expertise</label><span data-allocation-bonus>+0</span><button type="button" data-remove-allocation aria-label="Remove allocation">×</button><input type="text" data-expertise-condition placeholder="Condition" aria-label="Expertise condition" hidden></div>`;}
export function readAllocation(box) {return {defer:!!box.querySelector('[data-defer]')?.checked,rows:[...box.querySelectorAll('.as-allocation-row')].map(row=>({path:row.querySelector('[data-allocation-skill]').value,points:Number(row.querySelector('[data-points]').textContent),expertise:row.querySelector('[data-expertise]').checked,condition:row.querySelector('[data-expertise-condition]').value}))};}
export function bindAllocations(root) {
  const valid=(box,rows)=>{
    try{if(box.dataset.poolState)spendPoolRows(JSON.parse(box.dataset.poolState),rows,{validateConditions:false});else if(rows.reduce((n,r)=>n+r.points,0)>JSON.parse(box.dataset.allocationChoice).budget)return false;return true;}catch{return false;}
  };
  const refresh=box=>{
    const value=readAllocation(box),c=JSON.parse(box.dataset.allocationChoice),total=value.rows.reduce((n,r)=>n+r.points,0);
    box.querySelector('.as-allocation-remaining').textContent=`${c.budget-total} remaining`;
    box.querySelector('[data-add-allocation]').disabled=value.rows.length>=5;
    [...box.querySelectorAll('.as-allocation-row')].forEach((row,i)=>{
      const r=value.rows[i];row.querySelector('[data-expertise-condition]').hidden=!r.expertise;
      row.classList.toggle('as-expertise-card',r.expertise);
      row.querySelector('[data-allocation-bonus]').textContent=`+${r.points*(r.expertise?2:1)}`;
      row.querySelector('[data-point-minus]').disabled=!r.points;
      const next=structuredClone(value.rows);next[i].points++;row.querySelector('[data-point-plus]').disabled=!valid(box,next);
    });
    if(box.dataset.poolState){const draft=spendPoolRows(JSON.parse(box.dataset.poolState),value.rows,{validateConditions:false});box.querySelector('[data-pool-balances]').innerHTML=poolsFor(draft).map(p=>`<p>${esc(p.source)}: ${p.remaining} / ${p.total}</p>`).join('');}
  };
  root.addEventListener('click',event=>{
    const box=event.target.closest('[data-allocation-key]');if(!box)return;
    const button=event.target.closest('button');if(!button)return;
    const row=button.closest('.as-allocation-row');
    if(button.hasAttribute('data-add-allocation')&&box.querySelectorAll('.as-allocation-row').length<5)box.querySelector('[data-allocation-rows]').insertAdjacentHTML('beforeend',rowHTML(JSON.parse(box.dataset.allocationChoice)));
    if(button.hasAttribute('data-remove-allocation'))row.remove();
    if(button.hasAttribute('data-point-minus')||button.hasAttribute('data-point-plus')){const out=row.querySelector('[data-points]'),old=Number(out.textContent);out.textContent=Math.max(0,old+(button.hasAttribute('data-point-plus')?1:-1));if(!valid(box,readAllocation(box).rows))out.textContent=old;}
    refresh(box);
  });
  root.addEventListener('change',event=>{const box=event.target.closest('[data-allocation-key]');if(!box)return;const row=event.target.closest('.as-allocation-row');if(row){const out=row.querySelector('[data-points]');while(Number(out.textContent)>0&&!valid(box,readAllocation(box).rows))out.textContent=Number(out.textContent)-1;}refresh(box);});
}
export function expertisesFor(system,key) {
  const groups=new Map();for(const g of system.expertiseGrants??[])if(g.path===`expertise.skills.${key}`){const name=g.specialty??'Expertise';const k=name.toLocaleLowerCase().trim();const group=groups.get(k)??{name,value:0,sources:[]};group.value+=g.value;if(!group.sources.includes(g.source))group.sources.push(g.source);groups.set(k,group);}return [...groups.values()];
}
