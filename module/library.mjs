/** Shared, read-only source catalog. Character sheets store only selected catalog IDs. */
export const CATALOG_URL = 'systems/angelssword/catalog/library.json';
const normalized = value => String(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {race:'Races',subrace:'Sub-races',class:'Classes',ability:'Abilities',breakthrough:'Breakthroughs',item:'Items'};
export function indexCatalog(catalog) {
  const ownership = new Map();
  const raw = new Map(catalog.entries.map(e=>[e.id,e]));
  const attach = (id, owner, seen = new Set()) => {
    if (seen.has(id)) return; seen.add(id);
    const entry = raw.get(id); if (!entry) return;
    if (entry.category === 'ability') {
      const owners = ownership.get(id) ?? []; owners.push(owner); ownership.set(id, owners);
      for (const ref of entry.references ?? []) attach(ref.id, owner, seen);
      for (const child of catalog.entries.filter(e=>e.parentId===id)) attach(child.id, owner, seen);
    }
  };
  for (const entry of catalog.entries.filter(e=>!e.archived)) {
    if (entry.category === 'class') for (const level of entry.levels ?? []) if (level.abilityId) attach(level.abilityId,{name:entry.name,category:'Class',tier:Number(entry.data.tier),level:level.level});
    if (['race','subrace'].includes(entry.category)) for (const ref of entry.references ?? []) attach(ref.id,{name:entry.name,category:'Race',parent:raw.get(entry.parentId)?.name ?? entry.name});
  }
  const byId = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const copy = value => value === undefined ? undefined : structuredClone(value);
  return {
    version: catalog.version,
    owners: id => copy(ownership.get(id) ?? []),
    get: id => copy(byId.get(id)),
    find: (name, category, {includeArchived = false} = {}) => copy(catalog.entries.filter(e =>
      (!category || e.category === category) && (includeArchived || !e.archived) && normalized(e.name) === normalized(name))),
    search: (query = '', {category = '', includeArchived = false} = {}) => copy(catalog.entries.filter(e =>
      (!category || e.category === category) && (includeArchived || !e.archived) &&
      normalized(e.name).includes(normalized(query))).sort((a,b)=>a.name.localeCompare(b.name)))
  };
}
let loaded;
export function loadCatalog() {
  return loaded ??= fetch(CATALOG_URL).then(async response => {
    if (!response.ok) throw new Error(`Rules library could not load (${response.status}).`);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error('Unsupported rules library format.');
    return indexCatalog(data);
  }).catch(error => {loaded = undefined; throw error;});
}
export async function getByName(name, category) {
  const matches = (await loadCatalog()).find(name, category);
  if (matches.length !== 1) throw new Error(matches.length ? `Several entries match ${name}; use their catalog IDs.` : `No current library entry matches ${name}.`);
  return matches[0];
}
const fieldLabels = {role1:'Main role',role2:'Secondary role',primaryRace:'Parent race',keyAbility:'Key ability',ultimateAbility:'Ultimate ability',apCost:'AP cost',rpCost:'RP cost',manaCost:'MP cost',trait1:'Trait 1',trait2:'Trait 2',trait3:'Trait 3',ability1:'Ability 1',ability2:'Ability 2',ability3:'Ability 3',associatedAbility:'Associated ability',imageLgUrl:'Image',imageSmUrl:'Thumbnail',heart:'Heart',soul:'Soul',ambition:'Ambition'};
const kindLabel = entry => ({'key-abilities':'Key ability','true-abilities':'Ability','ability-section':'Ability section'}[entry.kind] ?? labels[entry.category]);
const label = key => fieldLabels[key] ?? key.replace(/([a-z])([A-Z0-9])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const safeUrl = url => {try {const parsed=new URL(url);return ['http:','https:'].includes(parsed.protocol) ? parsed.href : '';} catch {return '';}};
/** Source HTML is treated as data. Keep formatting but strip active content and attributes. */
export function safeHTML(markup) {
  const doc=new DOMParser().parseFromString(String(markup),'text/html');
  const allowed=new Set(['P','BR','STRONG','B','EM','I','U','S','UL','OL','LI','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TH','TD','BLOCKQUOTE','HR','A','SPAN','DIV','SUB','SUP']);
  for(const element of [...doc.body.querySelectorAll('*')]) {
    if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SVG','MATH'].includes(element.tagName)){element.remove();continue;}
    if(!allowed.has(element.tagName)){element.replaceWith(...element.childNodes);continue;}
    const href=element.tagName==='A'?safeUrl(element.getAttribute('href')):'';
    for(const attr of [...element.attributes])element.removeAttribute(attr.name);
    if(href){element.setAttribute('href',href);element.setAttribute('target','_blank');element.setAttribute('rel','noopener noreferrer');}
  }
  return doc.body.innerHTML;
}
function valueHTML(value) {
  if (Array.isArray(value)) return `<ul>${value.map(v=>`<li>${valueHTML(v)}</li>`).join('')}</ul>`;
  if (value && typeof value==='object') return `<dl>${Object.entries(value).filter(([,v])=>v!==''&&v!==null).map(([k,v])=>`<dt>${escape(label(k))}</dt><dd>${valueHTML(v)}</dd>`).join('')}</dl>`;
  return typeof value==='string' && /<\/?[a-z][^>]*>/i.test(value) ? safeHTML(value) : escape(value);
}
function refButton(ref) {return `<button type="button" data-library-entry="${escape(ref.id)}">${escape(ref.name)}</button>`;}
export function entryHTML(entry, catalog) {
  const ignored=new Set(['id','indexId','classId','ancestryId','primaryRaceId','abilityId','trueAbilityId','breakthroughId','itemId','name','imageSmUrl','imageLgUrl','imageAlignment']);
  const fields=Object.entries(entry.data).filter(([key,value])=>!ignored.has(key)&&value!==''&&value!==null&&value!==undefined);
  const body=fields.map(([key,value])=>{
    const reference=entry.references.find(r=>r.role===key);
    return `<section class="as-library-field"><h3>${escape(label(key))}</h3>${reference?refButton(reference):valueHTML(value)}</section>`;
  }).join('');
  const levels=entry.levels?`<section><h3>Class levels</h3><ol class="as-class-levels">${entry.levels.map(level=>{
    const ability=level.abilityId&&catalog.get(level.abilityId);
    return `<li><strong>Level ${level.level} · ${escape(level.type)}</strong><div>${ability?refButton(ability):valueHTML(level.text||'No entry in source.')}</div></li>`;
  }).join('')}</ol></section>`:'';
  const parent=entry.parentId&&catalog.get(entry.parentId);
  const links=entry.references.length?`<section><h3>Related abilities</h3>${entry.references.map(ref=>`<div>${escape(label(ref.role))}: ${refButton(ref)}</div>`).join('')}</section>`:'';
  const images=entry.images.filter(safeUrl).map((url,i)=>`<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${i?'Image '+(i+1):'Source image'}</a>`).join(' · ');
  return `<header><h2>${escape(entry.name)}</h2><p>${escape(kindLabel(entry))} · v${escape(entry.version)}${entry.archived?' · Archived workbook entry':''}</p>${images?`<p>${images}</p>`:''}${parent?`<p>${entry.category === "subrace" ? "Parent race" : "Parent ability"}: ${refButton(parent)}</p>`:''}</header>${levels}${body}${links}<footer><a href="${escape(safeUrl(entry.source.url))}" target="_blank" rel="noopener noreferrer">Original source</a></footer>`;
}
const windows=new WeakMap();let generalWindow;
export async function openLibrary({actor = null, category = '', entryId = null} = {}) {
  if (!game.user?.isGM && !entryId) throw new Error("The full library is available to the GM.");
  const existing=actor?windows.get(actor):generalWindow;
  if(existing){if(category)existing.setCategory?.(category);if(entryId)existing.showEntry?.(entryId);await existing.maximize();existing.bringToTop();return existing;}
  const catalog=await loadCatalog();
  // Check again after loading to handle rapid clicks while the catalog was loading.
  const pending=actor?windows.get(actor):generalWindow;
  if(pending){if(category)pending.setCategory?.(category);if(entryId)pending.showEntry?.(entryId);await pending.maximize();pending.bringToTop();return pending;}
  let selected;
  const dialog=new Dialog({title:'Lyrian rules library',content:`<div class="as-library"><div class="as-library-filters"><input type="search" data-library-search placeholder="Search by name…" aria-label="Search library"><select data-library-category aria-label="Category"><option value="">All categories</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${k===category?'selected':''}>${v}</option>`).join('')}</select><label><input type="checkbox" data-library-archive> Include older entries</label></div><div class="as-library-layout"><div class="as-library-results"></div><article class="as-library-detail"><p>Select an entry to read its rules.</p></article></div></div>`,
    render:html=>{
      const root=html[0];const results=root.querySelector('.as-library-results');const detail=root.querySelector('.as-library-detail');
      const show=id=>{selected=catalog.get(id);if(selected)detail.innerHTML=entryHTML(selected,catalog);};
      const search=()=>{const entries=catalog.search(root.querySelector('[data-library-search]').value,{category:root.querySelector('[data-library-category]').value,includeArchived:root.querySelector('[data-library-archive]').checked});const rows=entries.flatMap(e=>e.category==='ability'&&(catalog.owners(e.id).length)?catalog.owners(e.id).map(owner=>({e,owner})): [{e,owner:null}]);
      const group=o=>o?o.category==='Class'?`Class · Tier ${o.tier} · ${o.name}`:`Race · ${o.parent}${o.parent===o.name?'':' · '+o.name}`:'Other entries';
      rows.sort((a,b)=>group(a.owner).localeCompare(group(b.owner),undefined,{numeric:true})||(a.owner?.level??0)-(b.owner?.level??0)||a.e.name.localeCompare(b.e.name));
      let last='';results.innerHTML=`<p>${entries.length} entries</p>`+rows.map(({e,owner})=>{const heading=group(owner),prefix=heading!==last?`<h3>${escape(heading)}</h3>`:'';last=heading;return `${prefix}<button type="button" data-library-entry="${escape(e.id)}">${owner?.level?`Level ${owner.level} · `:''}${escape(e.name)}<small>${escape(kindLabel(e))}${e.parentId?' · '+escape(catalog.get(e.parentId)?.name??''):''}${e.archived?' · v'+escape(e.version):''}</small></button>`;}).join('');};
      root.querySelector('[data-library-search]').addEventListener('input',search);
      root.querySelector('[data-library-category]').addEventListener('change',search);
      root.querySelector('[data-library-archive]').addEventListener('change',search);
      root.addEventListener('click',event=>{const button=event.target.closest('[data-library-entry]');if(button)show(button.dataset.libraryEntry);});
      root.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')){event.preventDefault();event.stopPropagation();}});
      dialog.showEntry=show;dialog.setCategory=value=>{root.querySelector('[data-library-category]').value=value;search();};search();if(entryId)show(entryId);
    },buttons:{...(actor?.isOwner?{add:{label:'Add reference to character'}}:{}),close:{label:'Close'}},default:'close',close:()=>{if(actor)windows.delete(actor);else generalWindow=undefined;}
  },{width:1000,height:740,classes:['dialog','as-system-dialog','as-library-window'],resizable:true});
  dialog.submit=async button=>{
    if(button===dialog.data.buttons.add){
      if(!selected){ui.notifications.warn('Select a library entry first.');return;}
      if(!actor?.isOwner||dialog._adding)return;
      const chosen=selected;
      dialog._adding=true;
      try {
      const references=actor.getFlag('angelssword','libraryReferences')??[];
      if(!references.includes(chosen.id))await actor.setFlag('angelssword','libraryReferences',[...references,chosen.id]);
      actor.sheet?.render(false);
      ui.notifications.info(`${chosen.name} referenced on the character.`);
      } catch(error) {ui.notifications.warn(error.message);}
      finally {dialog._adding=false;}
      return;
    }
    await dialog.close();
  };
  if(actor)windows.set(actor,dialog);else generalWindow=dialog;
  dialog.render(true);return dialog;
}
export const libraryAPI={load:loadCatalog,get:async id=>(await loadCatalog()).get(id),find:async(name,category)=>(await loadCatalog()).find(name,category),getByName,search:async(query,options)=>(await loadCatalog()).search(query,options),open:openLibrary};
