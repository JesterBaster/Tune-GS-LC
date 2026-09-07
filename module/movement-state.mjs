export const MOVEMENT_HISTORY_LIMIT=12;
export function trimMovementHistory(history) {
  const keep=new Set(history.filter(h=>h.kind==='movement').slice(-MOVEMENT_HISTORY_LIMIT).map(h=>h.id));
  return history.filter(h=>h.kind!=='movement'||keep.has(h.id));
}
export const samePosition=(a,b)=>a&&b&&['x','y','elevation'].every(k=>Math.abs((a[k]??0)-(b[k]??0))<0.01);
export function movementState(state,{id,at,user,tokenUuid,turn,path,cost,reverseId}) {
  const next=structuredClone(state);next.movement??={turn,steps:[]};
  if(next.movement.turn!==turn)next.movement={turn,steps:[]};
  if(reverseId){
    const index=next.movement.steps.findLastIndex(s=>s.tokenUuid===tokenUuid),last=next.movement.steps[index];
    if(!last||last.id!==reverseId||!samePosition(path.at(-1),last.path[0]))throw new Error('The last movement can no longer be reversed.');
    cost=-last.cost;next.movement.steps.splice(index,1);
  }else next.movement.steps.push({id,tokenUuid,path,cost});
  next.history.push({id,at,user,kind:'movement',action:reverseId?'Reversed movement':'Moved',detail:`${Math.abs(cost)} ft${reverseId?' restored':' spent'}`,tokenUuid,path,exp:0});
  next.history=trimMovementHistory(next.history);
  return {state:next,cost};
}
