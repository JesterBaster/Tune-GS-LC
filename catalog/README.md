# Lyrian rules library

This catalog belongs to the Angels Sword system, outside any single character. The sheet's **Library** button searches it by name. Class, Abilities, Breakthroughs and Inventory also have category-specific browser buttons. Races and sub-races are available through the main Library button.

For character owners, **Add reference to character** saves the selected record's ID on the actor. Referenced races and sub-races appear on the Class tab. Clicking a reference opens its full library entry. Removing a reference does not delete the system record.

These are reference records: adding a reference does not spend EXP, assign a class level, grant stats, execute an ability, or create an owned inventory item. Those game actions can be implemented against the stored data later without importing the rules again.

## Sources and versions

- Supplied workbook: https://docs.google.com/spreadsheets/d/1JrwofPKw-kPY5ev9gWd8Bmu5hASJxZ7udqeChoG-4HA/edit
- Master workbook linked in its reference formulas: https://docs.google.com/spreadsheets/d/1l_IhI6LaEW7eqISHoK2bUYLlMvb9a37JbPhoI-vuXq0/edit
- Current public site data: https://rpg.angelssword.com/game/0.13.1/classes

The main catalog uses website version **0.13.1**. The workbook is a **0.12.3** snapshot. Matching workbook records remain attached under `workbookRecords`; workbook-only entries are marked `archived` and appear when **Include older entries** is checked. Historical text never silently replaces current rules.

Every entry includes a stable ID, category, name, version, original source URL and source identifiers. `data` preserves all source fields with encoded prose decoded to HTML. `sections` preserves prose divisions. Named ability subsections are also separate child records with `parentId` and a subdivision index. Race/ancestry relationships and related abilities use IDs. Classes include all eight ordered levels, including skills, heart and soul. Remote image URLs are retained; images are not downloaded or rehosted. Source content is formatted safely when displayed.

`reference-tables.json` retains all nonempty reference rows from Races and the tabs after it, plus the master tables. It excludes the supplied workbook's personal character, inventory, images, journals, and transaction tabs. `import-report.json` records counts, failed requests, and unresolved references.

## Calling the library from sheet code or macros

```js
const library = game.angelssword.library;
const mage = await library.getByName("Mage", "class");
const abilities = await library.search("barrier", {category: "ability"});
const matches = await library.find("Divine Providence", "ability");
const sameRecord = await library.get(mage.id);
await library.open();
```

`getByName` requires exactly one current match. It throws on ambiguity or a missing name; use `find` or `search` to choose a specific ID. Categories are `race`, `subrace`, `class`, `ability`, `breakthrough`, and `item`. `search` accepts `includeArchived: true`. Results are copies, so changing a returned object does not change the shared catalog.

Character references are stored at `flags.angelssword.libraryReferences` as catalog IDs. Existing Features notes still use `flags.angelssword.features`, now labeled Breakthroughs. Backstory continues to use `system.biography`, preserving existing text.

## Dark mode

Dark mode defaults on for each user. Use the half-circle button beside Library, or the system's **Dark mode** setting, to change it. The choice affects system sheets and edit/library dialogs without changing rules or another user's preference.

## Rebuilding

The workspace retains the public source responses and the fetch/build tools. `tools/fetch-rule-data.mjs` uses the anonymous request format published by the website and caches requests locally; `tools/build-catalog.py` builds the catalog from those responses and the reference workbooks. Use a fresh source cache for a new website version. Do not replace a live catalog without auditing changed IDs, versions, and reference coverage.

Original rules and artwork remain attributed to their authors and linked sources. This import does not assert a separate license over third-party artwork.


## Character progression (September 2026)

The library remains read-only reference data. Player purchases use the Class and Breakthrough selectors; they are not library pins. The full Library button is GM-only. Ability results are grouped by originating race/subrace and class level.

`flags.angelssword.advancement` stores the character's ancestry, class levels, breakthrough purchases, resolved choices, events, journal references, custom abilities and chronological history. Each purchase retains its actual EXP cost, pool, IP cost, source ability IDs and locked grants. Derived actor data rebuilds the managed bonus rows from these records, so refreshing or editing a manual bonus cannot compound a purchased grant.

EXP and Spirit Core are computed from this record. Existing characters keep their prior EXP and Spirit Core as opening balances when they first use progression. Nothing infers purchases from their old pinned references. Creation has a separate 300 EXP breakthrough pool which expires on finishing creation. Unlock IP is not refunded by de-leveling.

Events & Sessions includes backstory and folder-organized journal UUID links. Journal access still follows Foundry's permissions. The small book icon opens history. Owners may record events; only the GM can edit existing history annotations.

AP actions create chat cards with an initiating-user-only action. The AP debit is checked immediately before spending and rapid actions on the same actor are serialized. Basic attack cards additionally roll accuracy and damage. Variable/absent AP fields require the player to enter the selected effect's cost; MP/RP are not spent automatically.

See `ability-resource-review.md` for the full MP/RP classification and `../progression-rules.md` for accounting rules. Story requirements, teachers, conditional passives, unusual overlap/refund adjudication and proficiency choices retain source text for review. Machine-verifiable class mastery, race restrictions, ordered levels, resource affordability, repeat checks and key named breakthrough chains are enforced. This is not a general natural-language rules interpreter.
