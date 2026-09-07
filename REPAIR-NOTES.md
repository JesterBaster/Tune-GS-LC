# Foundation repair 1.0.1

Prepared by Kyo for Thomas from the uploaded angelssword.zip.

This is a repair of the existing Simple Worldbuilding-derived system, not a complete implementation of Angel’s Sword rules. Existing health, power, initiative, and other defaults remain scaffolding, not verified game rules.

## Changes
- Preserved the actual system ID: angelssword (two consecutive s characters).
- Added existing generic defaults to hero, villain, pawn, weapon, and spell types; retained character and item for compatibility.
- Matched rich-text field declarations to the existing sheets.
- Made all document types available in the creation dialog alongside saved templates.
- Updated token attribute discovery to game.model and actor system data.
- Made compendium paths and system IDs explicit; compendium bytes are unchanged.
- Removed unconfirmed copied update/download links and the untested verified-version claim. Target remains Foundry 13, as in the uploaded manifest.

## Installation and first check
1. Confirm your Foundry version is 13 before installing this build.
2. Close Foundry and back up your existing system folder and test world outside the Foundry Data directory.
3. Extract angelssword into your actual User Data directory under Data/systems/. The final path must be Data/systems/angelssword/system.json. It is a system, not a module.
4. Restart Foundry and create a separate test world using Angels Sword.
5. Create a hero. Edit health and biography, close and reopen the sheet, then reload the world and check that both persist.
6. Create a weapon and spell, open their sheets, and add them to the hero.
7. Place the hero on a scene, check token resource bars, and open both compendiums.

Static JSON, JavaScript syntax, local file-reference, type-default, and unchanged-file checks were performed. Foundry itself is unavailable here; startup, sheet rendering, creation-dialog compatibility, and persistence still need testing in your installed version. No world database was migrated.
