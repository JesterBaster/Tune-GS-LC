import {loadCatalog,safeHTML} from './library.mjs';
import {stateFor,whole} from './advancement.mjs';
import {esc,modal} from './advancement-ui.mjs';
import {actionPoints} from './resources.mjs';
const busy=new Set(),actorQueues=new Map();
export function queueActorAction(actor,callback) {
  const key=actor.uuid??actor.id??actor;const promise=(actorQueues.get(key)??Promise.resolve()).catch(()=>{}).then(callback);actorQueues.set(key,promise);return promise;
}
export function fixedAP(value) {return /^\d+$/.test(String(value).trim())?Number(value):null;}
export async function postAbility(actor,{name,effects,ap,basic=null,actionLabel='Attack'}) {
  if(!actor.isOwner)throw new Error('You do not own this character.');
  const rp=basic?(basic.heavy||basic.precise?1:0):null;
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<article class="as-ability-card"><h3>${esc(name)}</h3>${safeHTML(effects)}<div class="as-attack-options"><button type="button" data-ability-attack>${esc(actionLabel)}${fixedAP(ap)!==null?` · ${fixedAP(ap)} AP`:''}</button>${basic?`<button type="button" data-ability-reaction>Opportunity attack · ${rp} RP</button>`:''}</div>${basic?'<p>Opportunity: melee only, when a target leaves weapon range. Minimum damage on hit is Power unless blocked.</p>':''}<small data-ability-spent hidden></small></article>`,flags:{angelssword:{abilityAction:{actorUuid:actor.uuid,userId:game.user.id,ap:fixedAP(ap),rp,basic,spent:false}}}});
}
export function bindAbilityActions(sheet,root) {
  root.addEventListener('click',event=>{
    const d=event.target.closest('button')?.dataset;if(!d||!sheet.isEditable)return;
    Promise.resolve().then(async()=>{
      if(d.ability){const a=(await loadCatalog()).get(d.ability);if(a)await postAbility(sheet.actor,{name:a.name,ap:a.data.apCost,effects:Object.entries(a.data).filter(([k,v])=>/^(description|benefit\d|range|requirement|keywords|manaCost|rpCost|otherCosts)$/.test(k)&&v).map(([k,v])=>`<section><strong>${esc(k)}</strong>${safeHTML(v)}</section>`).join('')});}
      if(d.customAbility){const a=stateFor(sheet.actor).custom.find(a=>a.id===d.customAbility);if(a)await postAbility(sheet.actor,{name:a.name,ap:a.ap,effects:esc(a.effects)});}
      if(d.basicAttack){
        const heavy=d.basicAttack==='heavy',precise=d.basicAttack==='precise',selection=root.querySelector('[data-action-weapon]').value;
        const weapon=sheet.actor.items?.get(selection),two=weapon?weapon.system.handedness==='two':selection==='two';
        const damage=(heavy?weapon?.system.heavyDamage:weapon?.system.damage)||(heavy?`${two?'5':'4'}d6 + 2 * @primary.power.total`:'2d4 + @primary.power.total');
        await postAbility(sheet.actor,{name:(heavy?'Heavy Attack':precise?'Precise Attack':'Light Attack')+(weapon?' · '+weapon.name:''),ap:heavy||precise?2:1,effects:`<p>${esc(weapon?.system.range||'Weapon range')}. Accuracy: 1d20 + ${precise?'2 × ':''}Focus. Damage: ${esc(damage.replaceAll('@primary.power.total','Power'))}.</p>${precise?'<p>Pinpoint: ignore Focus points of the target’s Guard (minimum Guard 0).</p>':''}`,basic:{heavy,precise,two,damage}});
      }
    }).catch(e=>ui.notifications.warn(e.message));
  });
}
export function inInitiative(actor) {
  const combats=game.combats?.contents??(game.combat?[game.combat]:[]);
  return combats.some(combat=>combat.started&&[...(combat.combatants??[])].some(c=>((actor.uuid&&c.actor?.uuid===actor.uuid)||(actor.id&&c.actorId===actor.id))&&c.initiative!==null&&c.initiative!==undefined));
}
export async function spendAbilityAction(message,cost,resource='ap') {
  const action=message.flags?.angelssword?.abilityAction;
  if(!action||action.userId!==game.user.id||action.spent||busy.has(message.id))return;
  busy.add(message.id);
  const queue=queueActorAction({uuid:action.actorUuid},async()=>{
    const actor=await fromUuid(action.actorUuid);if(!actor?.isOwner)throw new Error('You no longer own this character.');
    if(action.spent)return;
    if(resource!=='ap'&&!(resource==='rp'&&action.basic))throw new Error('Invalid attack resource.');
    cost=inInitiative(actor)?whole(resource==='rp'?(action.basic.heavy||action.basic.precise?1:0):(action.ap??cost),'Attack cost'):0;
    const rp={...actor.system.resources.rp},total=resource==='ap'?actionPoints(actor.system.resources.ap).total:rp.value+rp.temp;
    if(cost>total)throw new Error(`Not enough ${resource.toUpperCase()}.`);
    if(cost){if(resource==='ap')await actor.setActionPoints(total-cost);else await actor.update({'system.resources.rp.temp':Math.max(0,rp.temp-cost),'system.resources.rp.value':rp.value-Math.max(0,cost-rp.temp)});}
    try{await message.update({'flags.angelssword.abilityAction.spent':true,'flags.angelssword.abilityAction.paidAP':resource==='ap'?cost:0,'flags.angelssword.abilityAction.paidRP':resource==='rp'?cost:0});}
    catch(error){if(cost){if(resource==='ap')await actor.modifyActionPoints(cost);else await actor.update({'system.resources.rp.temp':rp.temp,'system.resources.rp.value':rp.value});}throw error;}
    if(action.basic){const {heavy,two,precise}=action.basic;await new Roll(`1d20 + ${precise?'2 * ':''}@primary.focus.total`,actor.getRollData()).toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:'Attack accuracy'});await new Roll(action.basic.damage||(heavy?`${two?'5':'4'}d6 + 2 * @primary.power.total`:'2d4 + @primary.power.total'),actor.getRollData()).toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:'Attack damage'});}
  });
  try{await queue;}finally{busy.delete(message.id);}
}
export function renderAbilityChat(message,html) {
  const root=html[0]??html,action=message.flags?.angelssword?.abilityAction;
  if(!action)return;
  const button=root.querySelector('[data-ability-attack]');if(!button)return;
  const reaction=root.querySelector('[data-ability-reaction]');
  if(action.spent||game.user.id!==action.userId){button.remove();reaction?.remove();}
  else if(reaction)reaction.onclick=()=>spendAbilityAction(message,action.rp,'rp').catch(e=>ui.notifications.warn(e.message));
  if(action.spent){const label=root.querySelector('[data-ability-spent]');if(label){label.hidden=false;label.textContent=action.paidRP?`${action.paidRP} RP spent`:action.paidAP?`${action.paidAP} AP spent`:'Resolved · no resource spent';}}
  else button.onclick=()=>{
    const run=()=>spendAbilityAction(message,action.ap).catch(e=>ui.notifications.warn(e.message));
    if(action.ap!==null)return run();
    fromUuid(action.actorUuid).then(actor=>!inInitiative(actor)?spendAbilityAction(message,0):modal(actor,'ap:'+message.id,'Ability AP cost','<p>Select the cost for the effect you are using, following the ability above.</p><label>AP<input name="ap" type="number" min="0" step="1" required></label>',form=>spendAbilityAction(message,form.elements.ap.value),{width:380,label:'Attack'})).catch(e=>ui.notifications.warn(e.message));
  };
}
