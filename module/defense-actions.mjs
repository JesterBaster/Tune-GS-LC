import {queueActorAction,inInitiative} from './ability-actions.mjs';
import {esc} from './advancement-ui.mjs';

export function damageAfterGuard(total,guard,blocked,hp) {
  total=Number(total);
  if(!Number.isFinite(total)||total<0)throw new Error('Enter a nonnegative damage total.');
  const damage=total===0?0:Math.max(blocked?0:1,total-Math.max(0,guard));
  const absorbed=Math.min(hp.temp,damage);
  return {damage,absorbed,temp:hp.temp-absorbed,value:hp.value-(damage-absorbed)};
}
export async function postDefense(actor,reaction) {
  const cost=inInitiative(actor)?reaction.cost:0,rp={...actor.system.resources.rp};
  if(rp.value+rp.temp<cost)throw new Error('Not enough RP.');
  const blocked=reaction.id==='block',d=actor.system.derived;
  const guard=blocked?d.block:d.guard,evasion=blocked?d.evasion:d.dodge;
  if(cost)await actor.update({'system.resources.rp.temp':Math.max(0,rp.temp-cost),'system.resources.rp.value':rp.value-Math.max(0,cost-rp.temp)});
  try{return await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<article class="as-defense-card"><h3>${esc(reaction.name)}</h3><p>Evasion: <strong>${evasion}</strong> · Guard: <strong>${guard}</strong></p><p>${cost} RP spent. ${blocked?'Block can reduce damage to 0.':'A hit deals at least 1 damage after Guard.'}</p><div data-defense-input><label>Total incoming damage <input type="number" min="0" step="any" data-defense-damage></label>${actor.system.mageArmor?.fireVulnerability?'<label><input type="checkbox" data-defense-fire> Fire damage (Spidersilk ×2)</label>':''}<button type="button" data-defense-apply>Apply damage after Guard</button></div><small data-defense-result hidden></small></article>`,flags:{angelssword:{defenseAction:{actorUuid:actor.uuid,userId:game.user.id,blocked,guard,evasion,fireVulnerability:!!actor.system.mageArmor?.fireVulnerability,applied:false}}}});}
  catch(error){if(cost)await actor.update({'system.resources.rp.temp':rp.temp,'system.resources.rp.value':rp.value});throw error;}
}
const pending=new Set();
export async function applyDefenseDamage(message,total,fire=false) {
  const d=message.flags?.angelssword?.defenseAction;
  if(!d||d.userId!==game.user.id||d.applied||pending.has(message.id))return;
  if(String(total).trim()==='')throw new Error('Enter the total incoming damage first.');
  pending.add(message.id);
  try {return await queueActorAction({uuid:d.actorUuid},async()=>{
    const actor=await fromUuid(d.actorUuid);if(!actor?.isOwner)throw new Error('You no longer own this character.');
    if(message.flags.angelssword.defenseAction.applied)return;
    const hp={...actor.system.resources.health},result=damageAfterGuard(Number(total)*(fire&&d.fireVulnerability?2:1),d.guard,d.blocked,hp);
    await actor.update({'system.resources.health.temp':result.temp,'system.resources.health.value':result.value});
    try{await message.update({'flags.angelssword.defenseAction.applied':true,'flags.angelssword.defenseAction.result':`${result.damage} damage · ${result.absorbed} temporary HP, ${result.damage-result.absorbed} HP`});}
    catch(error){await actor.update({'system.resources.health.temp':hp.temp,'system.resources.health.value':hp.value});throw error;}
    return result;
  });}finally{pending.delete(message.id);}
}
export function renderDefenseChat(message,html) {
  const root=html[0]??html,d=message.flags?.angelssword?.defenseAction;if(!d)return;
  if(d.applied||d.userId!==game.user.id)root.querySelector('[data-defense-input]')?.remove();
  if(d.applied){const label=root.querySelector('[data-defense-result]');if(label){label.hidden=false;label.textContent=d.result;}return;}
  const button=root.querySelector('[data-defense-apply]');if(button)button.onclick=()=>applyDefenseDamage(message,root.querySelector('[data-defense-damage]').value,!!root.querySelector('[data-defense-fire]')?.checked).catch(e=>ui.notifications.warn(e.message));
}
