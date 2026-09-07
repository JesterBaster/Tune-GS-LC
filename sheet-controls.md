# Sheet controls and integrations — 1.2.2

- Initiative uses a self-contained triangular d4 icon; the existing 1d4 initiative formula is retained.
- Speed spends one AP and adds Speed feet to the movement allowance. The underlined remaining allowance accepts the usual absolute or signed adjustment. Unused allowance clears when initiative advances or the combat ends. This does not teleport a token or automatically restrict its drag movement.
- Save rolls 2d10 plus the derived Save value.
- Reactions list passive defense (0 RP), Dodge (1 RP), Block (1 RP), and light (0 RP), heavy (1 RP), or precise (1 RP) opportunity attacks. Their buttons post the reaction rules and spend RP in initiative, taking temporary RP first. Attack resolution/target defenses remain manual.
- Race is shown below AP. Its menu uses explicit race/subrace locks. Changing it replaces racial grants, retaining base stats and creation skill points. Incompatible racial starter class purchases must be de-leveled first. A race change that would create a negative EXP balance is rejected.
- Initialization assigns the primary 5/4/4/3 and secondary 5/4/3/2/1 arrays through dropdowns. A newly selected duplicate clears the earlier assignment; the first of the two existing 4s is cleared when a third 4 is chosen. Creation grants 1,000 base EXP, 3 IP, and 300 breakthrough-only EXP (excluded from Spirit Core). Human's 100 EXP bonus still applies. Slow Starter is available directly during initialization.
- Source proficiency text and recorded choices are grouped into armor, languages, weapons and elemental masteries under the race, skills and action/reaction areas. Conditional text retains its conditions. These are records for reference; equipment enforcement is not implemented.
- The GM-only toolbar toggle defaults on and locks class/breakthrough requirement confirmations to checked. It also bypasses machine-verifiable prerequisite gates for purchases. It does not bypass EXP/IP affordability, level order, repeat limits or creation-only restrictions. Turning it off restores manual confirmations and prerequisite checks.
- Collapsed sheet sections persist in a per-user client setting keyed by actor and section. Unused skill points are always retained; single-skill sources apply automatically.

## Installed module integration

Dice Tray (`dice-calculator` 3.4.5) and Carousel Combat Tracker (`combat-tracker-dock` 4.0.2) are installed locally and declare V13 compatibility. The system uses their public hooks without changing their files or importing D&D 5e. Dice Tray receives the generic dice map. The carousel receives Angels Sword HP, AP, RP, Guard and Evasion attributes and HP portrait/AP resource defaults where not already configured.

On the next GM load, disabled modules are enabled through Foundry's module configuration, preserving other module choices. A further client reload is required if they were disabled. Existing carousel settings are preserved. Once configured, later deliberate module deactivation is respected.
