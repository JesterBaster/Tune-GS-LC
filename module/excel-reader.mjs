/** Read OOXML values, formulas, cell notes and drawings without executing workbook code. */
const decoder=new TextDecoder();
const MAX_FILE=35*1024*1024,MAX_EXPANDED=100*1024*1024;
export function excelURL(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use an HTTPS spreadsheet sharing link or direct .xlsx download link.');
  if(url.hostname==='docs.google.com') {
    const id=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/)?.[1];
    if(!id)throw new Error('Use the full Google Sheets sharing link.');
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  }
  if(/(^|\.)sharepoint\.com$|(^|\.)onedrive\.live\.com$/.test(url.hostname))url.searchParams.set('download','1');
  return url.href;
}
export async function readExcelLink(link) {
  let response;
  try{response=await fetch(excelURL(link),{credentials:'omit',signal:AbortSignal.timeout(45000)});}
  catch(error){throw new Error('The spreadsheet host did not allow the download. Make the link readable, or download it as .xlsx and select the file below. '+error.message);}
  if(!response.ok)throw new Error(`Spreadsheet download failed (${response.status}). Use a readable link or select an .xlsx file.`);
  if(Number(response.headers.get('content-length'))>MAX_FILE)throw new Error('Workbook exceeds 35 MB.');
  const chunks=[];let size=0;const reader=response.body.getReader();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE){await reader.cancel();throw new Error('Workbook exceeds 35 MB.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return readExcel(bytes);
}
export async function unzipExcel(input) {
  const bytes=new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>MAX_FILE)throw new Error('Workbook exceeds 35 MB.');
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('The link did not return an Excel .xlsx workbook. Select an exported .xlsx file instead.');
  const count=view.getUint16(end+10,true);if(count>5000)throw new Error('Workbook has too many archive entries.');
  const entries=new Map();let p=view.getUint32(end+16,true),expanded=0;
  for(let i=0;i<count;i++) {
    if(p+46>bytes.length||view.getUint32(p,true)!==0x02014b50)throw new Error('Invalid Excel archive.');
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),size=view.getUint32(p+20,true),raw=view.getUint32(p+24,true),n=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
    const name=decoder.decode(bytes.subarray(p+46,p+46+n));expanded+=raw;
    if(expanded>MAX_EXPANDED||flags&1||!([0,8].includes(method))||name.split('/').includes('..'))throw new Error('Unsupported, encrypted or oversized workbook.');
    if(local+30>bytes.length||view.getUint32(local,true)!==0x04034b50)throw new Error('Invalid Excel entry.');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);if(start+size>bytes.length)throw new Error('Truncated Excel entry.');
    const data=bytes.subarray(start,start+size);
    entries.set(name,async()=>{
      if(method===0){if(data.length!==raw)throw new Error('Invalid entry size.');return data;}
      const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks=[];let length=0;
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>raw||length>MAX_EXPANDED){await reader.cancel();throw new Error('Invalid expanded workbook size.');}chunks.push(value);}
      if(length!==raw)throw new Error('Truncated workbook entry.');const out=new Uint8Array(length);let i=0;for(const c of chunks){out.set(c,i);i+=c.length;}return out;
    });p+=46+n+extra+comment;
  }
  return entries;
}
const nodes=(element,name)=>[...element.getElementsByTagNameNS('*',name)];
const text=(element,name)=>nodes(element,name).map(n=>n.textContent).join('');
const resolve=(base,target)=>new URL(target,'https://xlsx.invalid/'+base).pathname.slice(1);
export async function readExcel(input) {
  const entries=await unzipExcel(input),cache=new Map();
  const xml=async path=>{if(!entries.has(path))return null;if(cache.has(path))return cache.get(path);const content=decoder.decode(await entries.get(path)());if(/<!DOCTYPE|<!ENTITY/i.test(content))throw new Error('Workbook XML contains unsupported declarations.');const doc=new DOMParser().parseFromString(content,'application/xml');if(nodes(doc,'parsererror').length)throw new Error('Invalid workbook XML.');cache.set(path,doc);return doc;};
  const relationships=async path=>{const slash=path.lastIndexOf('/'),doc=await xml(path.slice(0,slash+1)+'_rels/'+path.slice(slash+1)+'.rels');return new Map(doc?nodes(doc,'Relationship').map(n=>[n.getAttribute('Id'),{path:resolve(path,n.getAttribute('Target')),external:n.getAttribute('TargetMode')==='External',target:n.getAttribute('Target'),type:n.getAttribute('Type')}]):[]);};
  const workbook=await xml('xl/workbook.xml');if(!workbook)throw new Error('This is not an Excel workbook.');
  const rels=await relationships('xl/workbook.xml'),stringsDoc=await xml('xl/sharedStrings.xml'),strings=stringsDoc?nodes(stringsDoc,'si').map(si=>text(si,'t')):[];
  const result={sheets:[],notes:[],image:null};
  for(const node of nodes(workbook,'sheet')) {
    const rel=rels.get(node.getAttribute('r:id'));if(!rel||rel.external)continue;
    const doc=await xml(rel.path);if(!doc)continue;const sheet={name:node.getAttribute('name'),cells:{},rows:0};
    for(const c of nodes(doc,'c')) {
      const address=c.getAttribute('r'),type=c.getAttribute('t'),raw=text(c,'v');
      let value=raw===''?null:raw;
      if(type==='s')value=raw===''?null:strings[Number(raw)]??'';
      else if(type==='inlineStr')value=text(c,'t');
      else if(type==='b')value=raw==='1';
      else if(type==='e')value=null;
      else if(raw!==''&&type!=='str'&&Number.isFinite(Number(raw)))value=Number(raw);
      const formula=text(c,'f');if(value!==null||formula)sheet.cells[address]={value,formula};
      sheet.rows=Math.max(sheet.rows,Number(address?.match(/\d+/)?.[0])||0);
    }
    const sheetRels=await relationships(rel.path);
    for(const link of nodes(doc,'hyperlink')){const target=sheetRels.get(link.getAttribute('r:id'));if(target?.external&&/^https?:\/\//i.test(target.target)){const address=link.getAttribute('ref').split(':')[0];(sheet.cells[address]??={value:link.getAttribute('display')||target.target,formula:''}).hyperlink=target.target;}}
    for(const related of sheetRels.values())if(!related.external&&related.type.endsWith('/comments')) {
      const comments=await xml(related.path);if(comments)for(const c of nodes(comments,'comment')){const address=c.getAttribute('ref'),note=text(c,'t');(sheet.cells[address]??={value:null,formula:''}).note=note;result.notes.push({sheet:sheet.name,cell:address,note});}
    }
    if(/^images?$/i.test(sheet.name)) {
      for(const drawing of nodes(doc,'drawing')) {
        const dr=sheetRels.get(drawing.getAttribute('r:id'));if(!dr||dr.external)continue;
        const dd=await xml(dr.path),drRels=await relationships(dr.path);if(!dd)continue;
        for(const blip of nodes(dd,'blip')) {
          const media=drRels.get(blip.getAttribute('r:embed')||blip.getAttribute('r:link'));if(!media)continue;
          if(media.external){if(/^https:\/\//i.test(media.target))result.image={url:media.target};}
          else if(entries.has(media.path)&&/\.(png|jpe?g|gif|webp)$/i.test(media.path))result.image={name:media.path.split('/').at(-1),bytes:await entries.get(media.path)()};
          if(result.image)break;
        }
        if(result.image)break;
      }
      if(!result.image)for(const cell of Object.values(sheet.cells)){const url=cell.formula?.match(/^IMAGE\(\s*"(https:\/\/[^"\s]+)"/i)?.[1];if(url){result.image={url};break;}}
    }
    result.sheets.push(sheet);
  }
  return result;
}
