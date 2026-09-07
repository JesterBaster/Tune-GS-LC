import {queueActorAction} from './ability-actions.mjs';
import {transact} from './advancement-ui.mjs';
import {stateFor} from './advancement.mjs';
import {movementState,samePosition} from './movement-state.mjs';

export function tokenTurn(token) {
  const combat=(game.combats?.contents??[game.combat]).find(c=>c?.started&&c.combatant?.token?.uuid===token.uuid);
  return combat?`${combat.id}:${combat.round}:${combat.turn}`:null;
}
const reservations=new Map();
const reserved=actor=>[...reservations.values()].filter(r=>r.actor===actor.uuid).reduce((n,r)=>n+r.cost,0);
const point=p=>({x:p.x,y:p.y,elevation:p.elevation??0});
export function preMovement(token,move,options) {
  if(token.actor?.system.encumbrance?.rooted&&!options.asReverse&&!options.asForced){ui.notifications.warn('Rooted by excess burden. Reduce carried burden before moving.');return false;}
  const turn=tokenTurn(token);if(!turn||!token.actor)return;
  const actor=token.actor,path=[point(move.origin),...move.passed.waypoints.map(point)];
  if(options.asReverse){
    const m=stateFor(actor).movement,last=m?.steps.filter(s=>s.tokenUuid===token.uuid).at(-1);
    if(m?.turn!==turn||last?.id!==options.asReverse||!samePosition(move.origin,last.path.at(-1))||!samePosition(move.destination,last.path[0])){ui.notifications.warn('The previous path is no longer fully reversible.');return false;}
    return;
  }
  if(options.isUndo){ui.notifications.warn('Use Reverse movement on the token to restore movement correctly.');return false;}
  const cost=Math.max(0,Number.isFinite(move.passed.cost)?move.passed.cost:(Number(move.passed.distance)||0));
  if(cost+reserved(actor)>(actor.flags?.angelssword?.movementAvailable??0)+0.001){ui.notifications.warn('Not enough movement. Click Speed to spend 1 AP and gain movement.');return false;}
  reservations.set(move.id,{actor:actor.uuid,cost});
  // Release an abandoned request if another module or the server rejects it.
  setTimeout(()=>reservations.delete(move.id),10000);
}
export async function recordMovement(token,move,options,user) {
  const turn=tokenTurn(token);if(user.id!==game.user.id||!turn||!token.actor)return;
  try{await queueActorAction(token.actor,()=>transact(token.actor,state=>{
    if(tokenTurn(token)!==turn)return;
    const result=movementState(state,{id:move.id,at:new Date().toISOString(),user:user.name,tokenUuid:token.uuid,turn,path:[point(move.origin),...move.passed.waypoints.map(point)],cost:Math.max(0,Number.isFinite(move.passed.cost)?move.passed.cost:(Number(move.passed.distance)||0)),reverseId:options.asReverse});
    const available=Number(token.actor.flags?.angelssword?.movementAvailable??0)-result.cost;
    return {state:result.state,updates:{'flags.angelssword.movementAvailable':Math.max(0,Math.round(available*1000)/1000)}};
  }));}finally{reservations.delete(move.id);drawMovement();}
}
const reversing=new Set();
export async function reverseMovement(token) {
  if(!token?.isOwner||reversing.has(token.uuid))return;
  const m=stateFor(token.actor).movement,last=m?.steps.filter(s=>s.tokenUuid===token.uuid).at(-1);
  if(!last||m.turn!==tokenTurn(token)||!samePosition(token,last.path.at(-1)))throw new Error('No reversible movement remains in this turn.');
  reversing.add(token.uuid);
  try {
    // One checkpoint keeps the reverse atomic; Foundry still animates all intervening waypoints.
    const path=last.path.slice(0,-1).reverse().map((p,i,a)=>({...p,action:token.movementAction,checkpoint:i===a.length-1,explicit:false}));
    if(!await token.move(path,{asReverse:last.id,showRuler:true}))throw new Error('The reverse path is blocked. No movement was refunded.');
  }finally{reversing.delete(token.uuid);}
}
let trail;
export function drawMovement() {
  trail?.destroy();trail=null;
  if(!canvas?.ready||!canvas.interface)return;
  trail=new PIXI.Graphics();trail.eventMode='none';canvas.interface.addChild(trail);
  for(const token of canvas.tokens.placeables){
    const turn=tokenTurn(token.document),m=token.actor?.flags?.angelssword?.advancement?.movement;
    if(!turn||m?.turn!==turn||!token.isVisible||(!token.isOwner&&!game.user.isGM))continue;
    trail.lineStyle(4,0x81c995,.65);
    for(const step of m.steps.filter(s=>s.tokenUuid===token.document.uuid)){
      const path=step.path.map(p=>token.document.getCenterPoint(p));
      path.forEach((p,i)=>i?trail.lineTo(p.x,p.y):trail.moveTo(p.x,p.y));
    }
  }
}
async function clearMovement(combat) {
  drawMovement();
  if(game.users.activeGM?.id!==game.user.id)return;
  const actors=[...new Map([...combat.combatants].filter(c=>c.actor).map(c=>[c.actor.uuid,c.actor])).values()];
  for(const actor of actors)await queueActorAction(actor,()=>transact(actor,state=>{
    state.movement={turn:null,steps:[]};return {state,updates:{'flags.angelssword.movementAvailable':0}};
  }));
}
Hooks.on('preMoveToken',preMovement);
Hooks.on('moveToken',(token,move,options,user)=>recordMovement(token,move,options,user).catch(e=>ui.notifications.error('Movement tracking: '+e.message)));
Hooks.on('updateCombat',(combat,change)=>{if('turn'in change||'round'in change)clearMovement(combat).catch(console.error);});
Hooks.on('deleteCombat',combat=>clearMovement(combat).catch(console.error));
Hooks.on('updateActor',drawMovement);Hooks.on('canvasReady',drawMovement);Hooks.on('refreshToken',drawMovement);
Hooks.on('canvasTearDown',()=>{trail?.destroy();trail=null;});
Hooks.on('renderTokenHUD',(hud,html)=>{
  const token=hud.document??hud.object?.document,root=html[0]??html;
  if(!token?.isOwner||!tokenTurn(token)||root.querySelector('[data-as-reverse]'))return;
  const button=document.createElement('button');button.type='button';button.className='control-icon';button.dataset.asReverse='';button.title='Reverse movement';button.setAttribute('aria-label','Reverse movement');button.innerHTML='<i class="fas fa-rotate-left"></i>';
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();reverseMovement(token).catch(e=>ui.notifications.warn(e.message));});
  (root.querySelector('.col.right')??root).append(button);
});
