/** Integrate installed system-agnostic modules through their public hooks. */
const attributes=[
 {attr:'resources.health.value',icon:'fas fa-heart',units:'HP'},
 {attr:'resources.ap.total',icon:'fas fa-circle',units:'AP'},
 {attr:'resources.rp.value',icon:'fas fa-shield',units:'RP'},
 {attr:'derived.evasion',icon:'fas fa-person-running',units:'Evasion'},
 {attr:'derived.guard',icon:'fas fa-shield',units:'Guard'}
];
Hooks.on('dice-calculator.keymaps',(maps,Template)=>{maps.angelssword=Template;});
Hooks.on('combat-tracker-dock-init',config=>{const previous=config.defaultAttributesConfig;config.defaultAttributesConfig=()=>({...previous(),angelssword:attributes});});
Hooks.once('init',()=>{
 game.settings.register('angelssword','collapsedSections',{scope:'client',config:false,type:Object,default:{}});
 game.settings.register('angelssword','moduleIntegrationConfigured',{scope:'world',config:false,type:Boolean,default:false});
 game.settings.register('angelssword','requirementsAutoMet',{name:'Requirements automatically met',hint:'Lock class and breakthrough requirement confirmations on. Only the GM can change this.',scope:'world',config:true,type:Boolean,default:true,onChange:enabled=>{
  for(const input of document.querySelectorAll('.as-advancement-form [name=requirements]')){input.checked=enabled;input.disabled=enabled;}
  ui.controls?.render();for(const window of Object.values(ui.windows))if(window.actor)window.render(false);
 }});
});
Hooks.on('getSceneControlButtons',controls=>{
 if(!game.user.isGM||!controls.tokens)return;
 controls.tokens.tools.asRequirements={name:'asRequirements',title:'Requirements automatically met',icon:'fas fa-list-check',toggle:true,active:game.settings.get('angelssword','requirementsAutoMet'),onChange:(_event,active)=>game.settings.set('angelssword','requirementsAutoMet',active)};
});
Hooks.once('ready',async()=>{
 if(!game.user.isGM||game.settings.get('angelssword','moduleIntegrationConfigured'))return;
 try{
  const ids=['dice-calculator','combat-tracker-dock'];const missing=ids.filter(id=>!game.modules.has(id));
  if(missing.length){ui.notifications.warn('Optional sheet integrations are not installed: '+missing.join(', '));return;}
  const inactive=ids.filter(id=>!game.modules.get(id).active);
  if(inactive.length){const config=foundry.utils.deepClone(game.settings.get('core','moduleConfiguration'));for(const id of inactive)config[id]=true;await game.settings.set('core','moduleConfiguration',config);ui.notifications.info('Dice Tray and Carousel Combat Tracker are enabled. Reload Foundry to load them.');return;}
  if(!game.settings.get('angelssword','moduleIntegrationConfigured')){
   if(!game.settings.get('combat-tracker-dock','attributes')?.length)await game.settings.set('combat-tracker-dock','attributes',attributes);
   if(!game.settings.get('combat-tracker-dock','portraitResource'))await game.settings.set('combat-tracker-dock','portraitResource','resources.health');
   if(!game.settings.get('combat-tracker-dock','resource'))await game.settings.set('combat-tracker-dock','resource','resources.ap.total');
   await game.settings.set('angelssword','moduleIntegrationConfigured',true);
  }
 }catch(error){console.error('Angels Sword module integration',error);ui.notifications.warn('The module integration could not finish: '+error.message);}
});
