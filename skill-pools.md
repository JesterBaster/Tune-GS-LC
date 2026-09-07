# Skill allocations and expertise

Race, starting skill points, class unlocks, class levels and skill-training breakthroughs share `module/skill-allocation.mjs`. Each skill grant creates a source-owned pool with its allowed skills, total, remaining points and allocations. Each panel allows at most five rows. Each row uses a skill selector, minus/count/plus controls, an expertise checkbox and (for expertise) a condition. Expertise gives two bonus points per point spent; ordinary allocation gives one.

The source record commits only with the race or purchase. Unallocated points always remain in the pool. A source restricted to a single skill automatically applies all of its points as a conventional bonus, including remaining points in older single-skill pools. The Home Skills “Pool” control spends stored points in acquisition order, skipping any source that cannot grant the selected skill. Spending is revalidated against the current actor before updating. Removing a level also removes its pools and all bonuses funded by them. Existing allocated grants remain intact; this change does not turn previously spent points back into unspent points.

Expertise remains separate from the normal skill total. Home marks affected skills with an asterisk. A roll offers the normal skill or one expertise. Multiple contributions to the same named condition are combined; different conditions are separate choices. Gold locked cards appear above ordinary source rows in the skill editor.

Race and optional sub-race must be locked before initialization commits. No actor data is changed by these local lock buttons.

Attack cards spend AP only when the actor participates in a started combat and has a non-null initiative value (zero is valid). Outside initiative they resolve without spending AP. The relevant state is checked when Attack is clicked, not when the card is posted.
