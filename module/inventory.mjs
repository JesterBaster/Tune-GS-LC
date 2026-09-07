import {catalogNumber,catalogEquipment,catalogImage} from './loadout-rules.mjs';
export {inventorySummary,equipmentBonuses} from './loadout-rules.mjs';
import {loadCatalog,safeHTML} from './library.mjs';
import {modal,esc} from './advancement-ui.mjs';
export const ITEM_KINDS=['Equipment','Weapon','Armor','Shield','Consumable','Material','Container','Spell','Other'];
export const itemType=kind=>kind==='Weapon'?'weapon':kind==='Spell'?'spell':'item';
export function inferKind(name,category='') {
  const text=category+' '+name;
  if(/material|fuel|\bunits\b/i.test(text))return 'Material';
  if(/potion|elixir|flask|salve|poison|healing pot|food/i.test(text))return 'Consumable';
  if(/container|kit|pack|bag|alchemy rig/i.test(text))return 'Container';
  if(/shield/i.test(text))return 'Shield';if(/armor|armour/i.test(text))return 'Armor';
  if(/weapon|wand|sword|dagger|bow|gun|kanabo|spear|staff/i.test(text))return 'Weapon';
  return 'Equipment';
}
export function itemData({name,kind='Equipment',quantity=1,burden=0,price=0,location='Carried',description='',catalogId=null,source=null}) {
  return {name,type:itemType(kind),img:kind==='Weapon'?'icons/svg/sword.svg':kind==='Armor'||kind==='Shield'?'icons/svg/shield.svg':'icons/svg/item-bag.svg',system:{description,quantity,weight:burden,kind,price,location,equipped:false,handedness:/two.handed/i.test(name)?'two':'one',apCost:null,damage:'',range:'',guard:0,block:0,attributes:{},groups:{}},flags:{angelssword:{catalogId,importSource:source}}};
}
export async function addInventoryItem(sheet,custom=false) {
  const actor=sheet.actor;if(!actor.isOwner)return;
  if(custom)return modal(actor,'customItem','Add custom item',`<label class="as-adv-field">Name<input name="itemName" required></label><label class="as-adv-field">Kind<select name="kind">${ITEM_KINDS.map(k=>`<option>${k}</option>`).join('')}</select></label><label class="as-adv-field">Quantity<input type="number" name="quantity" value="1" min="0" step="any" required></label><label class="as-adv-field">Burden each<input type="number" name="burden" value="0" min="0" step="any" required></label><label class="as-adv-field">Price each (Clim)<input type="number" name="price" value="0" min="0" step="any" required></label><label class="as-adv-field">Storage<input name="location" value="Carried"></label>`,async form=>{
    const data=itemData({name:form.elements.itemName.value.trim(),kind:form.elements.kind.value,quantity:Number(form.elements.quantity.value),burden:Number(form.elements.burden.value),price:Number(form.elements.price.value),location:form.elements.location.value.trim()||'Carried'});
    const [item]=await actor.createEmbeddedDocuments('Item',[data]);item.sheet.render(true);
  },{label:'Add item',width:460});
  const entries=(await loadCatalog()).search('',{category:'item'});
  return modal(actor,'addInventory','Add item from library',`<label class="as-adv-field">Search<input data-item-search></label><label class="as-adv-field">Item<select name="catalogItem" size="8" required>${entries.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label><label class="as-adv-field">Quantity<input name="quantity" type="number" min="0" step="any" value="1" required></label>`,async form=>{
    const entry=entries.find(e=>e.id===form.elements.catalogItem.value);if(!entry)throw new Error('Select an item.');
    const data=itemData({name:entry.name,kind:inferKind(entry.name,entry.data.type+' '+entry.data.subType),quantity:Number(form.elements.quantity.value),burden:catalogNumber(entry.data.burden),price:catalogNumber(entry.data.cost),description:safeHTML(entry.data.description??''),catalogId:entry.id});
    // Keep nonnumeric cost/burden and every other source field available in the item.
    data.flags.angelssword.catalogData=entry.data;
    Object.assign(data.system,catalogEquipment(entry));if(catalogImage(entry))data.img=catalogImage(entry);
    const [item]=await actor.createEmbeddedDocuments('Item',[data]);item.sheet.render(true);
  },{label:'Add item',render:root=>root.querySelector('[data-item-search]').addEventListener('input',e=>{const query=e.target.value.toLowerCase();for(const option of root.querySelector('[name=catalogItem]').options)option.hidden=!option.textContent.toLowerCase().includes(query);})});
}
export function bindInventory(sheet,root) {
  root.addEventListener('click',event=>{const d=event.target.closest('button')?.dataset;if(!d||!sheet.isEditable)return;if('inventoryAdd'in d||'inventoryCustom'in d)addInventoryItem(sheet,'inventoryCustom'in d).catch(e=>ui.notifications.warn(e.message));});
  root.addEventListener('change',event=>{const input=event.target;if(input.matches('[data-action-weapon]'))sheet._asWeaponChoice=input.value;if(!input.matches('[data-item-quantity]')||!sheet.isEditable)return;const value=Number(input.value),item=sheet.actor.items.get(input.dataset.itemQuantity);if(!item)return;if(!Number.isFinite(value)||value<0){input.value=item.system.quantity;return;}item.update({'system.quantity':value}).catch(e=>ui.notifications.warn(e.message));});
}
