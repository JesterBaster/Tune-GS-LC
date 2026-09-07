// Only the active GM writes resets, so every connected client can register these hooks.
export function registerCombatResources(queueActorAction) {
  const report = error => ui.notifications.error(`Combat resources: ${error.message}`);
  const refillRP = (combat, ended = false) => {
    const actors = new Map([...combat.combatants].filter(c => c.actor).map(c => [c.actor.uuid, c.actor]));
    return Promise.all([...actors.values()].map(actor => queueActorAction(actor, () => {
      const rp = actor.system.resources?.rp;
      if (!rp) return;
      const mage=actor.flags?.angelssword?.loadout?.mage;
      return actor.update({'system.resources.rp.value': rp.effectiveMax ?? rp.max,...(mage?.active ? {'flags.angelssword.loadout.mage':{...mage,active:!ended,usedCombat:combat.id}} : {})});
    })));
  };
  Hooks.on('updateCombat', (combat, change) => {
    if (game.users.activeGM?.id !== game.user.id) return;
    const previous = combat.previous;
    const start = 'round' in change && combat.round > 0 && !previous?.round;
    const end = 'round' in change && combat.round === 0 && previous?.round > 0;
    if (start || end) refillRP(combat,end).catch(report);
    // Ignore tracker rendering, initiative reordering and other unrelated updates.
    const turnChanged = ('turn' in change || 'round' in change) &&
      (combat.round !== previous?.round || combat.combatant?.id !== previous?.combatantId);
    const actor = combat.combatant?.actor;
    if (combat.started && turnChanged && actor?.system.resources?.ap) {
      queueActorAction(actor, () => actor.setActionPoints(4)).catch(report);
    }
  });
  Hooks.on('deleteCombat', combat => {
    if (game.users.activeGM?.id !== game.user.id || !combat.started) return;
    refillRP(combat,true).catch(report);
  });
}
