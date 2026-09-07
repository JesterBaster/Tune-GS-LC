# Angels Sword

Made By tunatunafish

A custom TTRPG game system for **Foundry VTT v13 and v14**.

System ID: `angelssword` (two consecutive `s` characters — the folder name must match exactly).

## Install in Foundry VTT

The manifest declares `minimum: 13`, `verified: 14`, `maximum: 14`, so the system installs
on both generations. Foundry flags it as incompatible on v15 and later, because the sheets
still use the ApplicationV1 framework that is scheduled for removal after v14.

### Option A — install by manifest URL (recommended)

1. Launch Foundry and stay on the **setup / Configuration** screen (not inside a world).
2. Go to **Game Systems → Install System**.
3. Paste this into the *Manifest URL* field and click **Install**:

   ```
   https://raw.githubusercontent.com/JesterBaster/Tune-GS-LC/main/system.json
   ```

Foundry downloads the repository archive, extracts it to `Data/systems/angelssword/`, and
the same URL is used for **Update** later.

### Option B — manual install

1. Download the repository as a ZIP (**Code → Download ZIP** on GitHub).
2. Fully **close Foundry**.
3. Find your Foundry **User Data** directory. It is printed on the setup screen under
   **Configuration → Data Path**. Defaults:
   - Windows: `%LOCALAPPDATA%\FoundryVTT\Data`
   - macOS: `~/Library/Application Support/FoundryVTT/Data`
   - Linux: `~/.local/share/FoundryVTT/Data`
4. Extract the ZIP so that the manifest lands at exactly:

   ```
   <User Data>/Data/systems/angelssword/system.json
   ```

   GitHub's ZIP wraps everything in a `Tune-GS-LC-main/` folder — rename that folder to
   `angelssword`, or move its *contents* into `systems/angelssword/`. There must be no
   extra folder level: `systems/angelssword/Tune-GS-LC-main/system.json` will not load.
5. Restart Foundry. **Angels Sword** now appears under **Game Systems**.

This is a **system**, not a module. It goes in `Data/systems/`, never `Data/modules/`.

## Create a world

1. **Game Worlds → Create World**, and pick **Angels Sword** as the system.
2. Launch the world and create a `hero` actor to check that sheets render.

## First-run checklist

After launching a fresh world, confirm:

- A `hero` actor opens, and edits to health and biography survive a sheet close/reopen
  and a world reload.
- A `weapon` and a `spell` item open, and can be dropped onto a hero.
- A hero token placed on a scene shows resource bars.
- Both compendium packs (**My Monsters**, **My Items**) open without an error. They are
  empty by design — they open, they just contain nothing yet.
- The browser console (F12) shows `Initializing Simple angelssword System` and no red
  errors on load.
- On the **Attributes** tab of a sheet, each attribute's type dropdown (String / Number /
  Boolean / Formula / Resource) lists all five options and shows the current one selected.
  This is the code path that the v14 `select` helper removal broke.

## Upgrading Foundry to v14

If you are moving from v13, note Foundry's own constraints — they are not specific to this
system:

- v14 requires **Node.js 24** for a self-hosted install.
- You cannot upgrade in place. Uninstall v13 and do a clean v14 install.
- **Once a world is opened in v14 it can no longer be opened in v13.** Back up the world
  first, and consider keeping the v13 install alongside v14 until you are satisfied.

Because this system still supports v13, there is no need to rush the Foundry upgrade.

## Optional modules

The system integrates with two optional modules through their public hooks, and will
offer to enable them on first load if they are installed:

- `dice-calculator` (Dice Tray)
- `combat-tracker-dock` (Carousel Combat Tracker)

Neither is required. If they are missing you get a one-time warning notification and the
system runs normally without them.

## Development

`styles/simple.css` is compiled from `styles/simple.less`:

```
npm install
npm run css      # one-shot build
npm run watch    # rebuild on change
```

Do not hand-edit `styles/simple.css` — it is generated.
