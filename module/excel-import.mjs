import {readExcel,readExcelLink} from './excel-reader.mjs';
import {buildCharacterDraft} from './excel-character.mjs';
import {loadCatalog} from './library.mjs';
import {modal,esc} from './advancement-ui.mjs';
import {isEmptyCharacter} from './player-stats.mjs';
import {progressionUpdates} from './advancement.mjs';
import {queueActorAction} from './ability-actions.mjs';

export async function commitCharacterImport(actor,draft,{replace=false,portrait=true,source='Excel workbook'}={}) {
  return queueActorAction(actor,async()=>{
    if(!actor.isOwner)throw new Error('You do not own this character.');
    if(!isEmptyCharacter(actor)&&!replace)throw new Error('Confirm replacement of this character, or import into an empty sheet.');
    if(draft.unmatched.length)throw new Error('Resolve the unmatched catalog names first.');
    if(actor.flags?.angelssword?.advancement?.import?.id===draft.state.import.id)throw new Error('This draft has already been imported.');
    const snapshot=actor.toObject();if(snapshot.flags?.angelssword)delete snapshot.flags.angelssword.lastImportBackup;
    let img=actor.img;
    if(portrait&&draft.image){
      if(draft.image.url)img=draft.image.url;
      else {
        if(!game.user.can('FILES_UPLOAD'))throw new Error('Foundry file-upload permission is required for the embedded portrait. Ask the GM to enable it, or turn off portrait import.');
        const ext=draft.image.name.split('.').at(-1).toLowerCase(),type={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[ext];
        const file=new File([draft.image.bytes],`angelssword-${draft.state.import.id}.${ext}`,{type});
        const picker=foundry.applications?.apps?.FilePicker?.implementation??FilePicker;
        const uploaded=await picker.upload('data','',file,{}, {notify:false});if(!uploaded?.path)throw new Error('The embedded portrait could not be stored.');img=uploaded.path;
      }
    }
    const oldItemIds=actor.items.map(i=>i.id),created=[],createdJournals=[];
    try {
      // New items exist before the actor changes; failures here leave the old character intact.
      const added=await actor.createEmbeddedDocuments('Item',draft.items);created.push(...added.map(i=>i.id));
      if(added.length!==draft.items.length)throw new Error('Foundry did not create every inventory entry. The character import was cancelled.');
      const state=structuredClone(draft.state),oldHistory=actor.flags?.angelssword?.advancement?.history??[];
      state.history=[...structuredClone(oldHistory),...state.history];state.history.at(-1).user=game.user.name;
      state.journals=[];
      for(const [i,journal]of draft.journals.entries()){
        const ref={id:state.import.id+':journal:'+i,...journal};
        if(game.user.can('JOURNAL_CREATE')){
          const doc=await getDocumentClass('JournalEntry').create({name:journal.name,ownership:{default:0,...actor.ownership,[game.user.id]:3},pages:[{name:journal.name,type:'text',text:{content:journal.content,format:1}}]});
          if(!doc)throw new Error('The journal could not be created.');createdJournals.push(doc);ref.uuid=doc.uuid;
        }
        state.journals.push(ref);
      }
      state.import.source=source;
      const updates={name:draft.name,img,...progressionUpdates(state),'flags.angelssword.initialized':true,'flags.angelssword.lastImportBackup':snapshot,'flags.angelssword.movementAvailable':0,'flags.angelssword.loadout':{}};
      for(const [key,value]of Object.entries(draft.system))updates['system.'+key]=structuredClone(value);
      // Replace old sheet notes explicitly; the imported biography and ledger own these sections.
      for(const key of ['classDetails','abilities','features'])updates['flags.angelssword.'+key]='';
      updates['flags.angelssword.libraryReferences']=[];
      const expanded=foundry.utils.expandObject(updates);
      expanded.flags=foundry.utils.mergeObject(structuredClone(snapshot.flags??{}),expanded.flags,{inplace:false});
      expanded.flags.angelssword.advancement=state;
      expanded.system={...structuredClone(snapshot.system),...structuredClone(draft.system)};
      await actor.update(expanded,{diff:false,recursive:false,asExcelImport:true});
    } catch(error) {
      if(created.length)await actor.deleteEmbeddedDocuments('Item',created);
      for(const doc of createdJournals)await doc.delete();
      throw error;
    }
    // Old inventory remains recoverable in lastImportBackup if removal is interrupted.
    if(oldItemIds.length)try{await actor.deleteEmbeddedDocuments('Item',oldItemIds);if(actor.items.some(i=>oldItemIds.includes(i.id)))throw new Error('Some old items remain.');}catch(error){ui.notifications.warn('Character imported, but old inventory could not be fully removed. The previous character is stored in its import backup. '+error.message);}
    actor.sheet?.render(false);
  });
}

export async function openExcelImport(sheet) {
  const actor=sheet.actor;if(!actor.isOwner)return;
  let book,draft,catalog,mappings={},root,source,selectedPortrait=true,replace=false;
  const draftId=foundry.utils.randomID(),at=new Date().toISOString();
  const review=()=>{
    draft=buildCharacterDraft(book,catalog,{mappings,id:draftId,at});
    const missing=draft.unmatched;
    root.querySelector('[data-import-review]').innerHTML=`<h3>${esc(draft.name)}</h3><p>${esc(draft.state.race.name)}${draft.state.race.subraceName?' · '+esc(draft.state.race.subraceName):''} · ${new Set(draft.state.purchases.filter(p=>p.kind==='class').map(p=>p.entryId)).size} classes · ${draft.state.purchases.filter(p=>p.kind==='breakthrough').length} breakthroughs</p><p>${draft.items.length} inventory entries · ${draft.journals.length} journals · ${draft.balance.exp} available EXP</p>${missing.length?'<h4>Match names to the library</h4><p>Choose a current entry, or explicitly retain an unmatched name as a custom record.</p>':''}${missing.map(m=>`<label class="as-adv-field">${esc(m.category)}: ${esc(m.name)}<select data-import-map="${esc(m.key)}"><option value="">Choose…</option><option value="custom">Keep as custom record</option>${catalog.search('',{category:m.category}).map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>`).join('')}<details><summary>Stats and skills</summary><div class="as-import-stats">${Object.entries(draft.targets).map(([path,value])=>`<p>${esc(path.split('.').at(-1).replaceAll('_',' '))}: <strong>${value??'Unavailable'}</strong></p>`).join('')}</div></details><details><summary>Stats and skill adjustments (${draft.adjustments.length})</summary><p>These are the remaining differences after base stats and source grants.</p>${draft.adjustments.map(a=>`<p>${esc(a.name)} ${a.value>=0?'+':''}${a.value} · ${esc(a.source)}</p>`).join('')||'<p>No unexplained differences.</p>'}</details><details><summary>Inventory</summary>${draft.items.map(i=>`<p>${i.system.quantity} × ${esc(i.name)} · ${esc(i.system.kind)} · ${esc(i.system.location)}${i.system.equipped?' · equipped':''}</p>`).join('')}</details><details><summary>Import notes (${draft.warnings.length})</summary>${draft.warnings.map(w=>`<p>${esc(w)}</p>`).join('')||'<p>No import warnings.</p>'}<p>Historical EXP is imported as a snapshot; it is not awarded again. Source notes remain stored with the import. Unresolved class choices are retained as visible stat adjustments or unspent skill points.</p><p>Unmatched custom classes retain their recorded levels; they cannot gain new catalog levels until matched.</p></details>${draft.image?`<label><input type="checkbox" data-import-portrait ${selectedPortrait?'checked':''}> Use the first image from Images as the portrait</label>`:'<p>No supported image found on Images; the portrait will stay unchanged.</p>'}${!isEmptyCharacter(actor)?`<label class="as-import-replace"><input type="checkbox" data-import-replace ${replace?'checked':''}> Replace this character’s name, ancestry, progression, stats, skills, backstory, journals and inventory. Keep a copy of the previous character in its import backup.</label>`:''}<button type="button" data-import-reset>Read another workbook</button>`;
    root.querySelector('[data-import-reset]').onclick=()=>{draft=null;book=null;mappings={};root.querySelector('[data-import-review]').innerHTML='';root.querySelector('[data-import-source]').hidden=false;};
    for(const select of root.querySelectorAll('[data-import-map]'))select.onchange=()=>{selectedPortrait=root.querySelector('[data-import-portrait]')?.checked??true;replace=root.querySelector('[data-import-replace]')?.checked??false;const key=select.dataset.importMap,previous=mappings[key];mappings[key]=select.value;try{review();}catch(error){mappings[key]=previous;select.value=previous??'';ui.notifications.warn(error.message);}};
    root.querySelector('[data-import-source]').hidden=true;
  };
  return modal(actor,'excelImport','Import Excel character',`<div data-import-source><p>Paste a readable Google Sheets / Excel link or choose an exported .xlsx file. The workbook is read without running its formulas.</p><label class="as-adv-field">Excel link<input name="excelLink" type="url" placeholder="https://…"></label><label class="as-adv-field">Or Excel file<input name="excelFile" type="file" accept=".xlsx"></label></div><div data-import-review class="as-import-review"></div>`,async form=>{
    if(!draft){const file=form.elements.excelFile.files[0];source=file?.name??form.elements.excelLink.value.trim();if(!source)throw new Error('Enter a spreadsheet link or choose an .xlsx file.');
      if(file&&file.size>35*1024*1024)throw new Error('Workbook exceeds 35 MB.');
      book=file?await readExcel(await file.arrayBuffer()):await readExcelLink(source);catalog=await loadCatalog();review();return false;
    }
    await commitCharacterImport(actor,draft,{replace:!!root.querySelector('[data-import-replace]')?.checked,portrait:!!root.querySelector('[data-import-portrait]')?.checked,source});
    ui.notifications.info('Character and inventory imported.');
  },{label:'Read / Import',width:760,render:element=>{root=element;}});
}
