// Feature processing utilities for the 5e (2024) ruleset.
// Contains functions for proficiency handling, one-time modifiers, provides items,
// attribute bonuses, HP recalc, choice processing, ability groups, and origin features.
// Ported from the Level Up ruleset, with Level-Up-specific mechanics removed
// (prestige, exertion, maneuvers, expertise dice) and origins adapted to 5e
// (Species + Background).
//
// Dependencies (from common.js, loaded before this file alphabetically):
//   checkForReplacements, evaluateMath, setModifier, getHpForLevel,
//   getTotalValueFromFields, getEffectsAndModifiers, getAbilityScoreIncrease, capitalize

// ─── Spellcasting Ability Helper ────────────────────────────────────────────

// Returns the character's spellcasting ability from their class(es).
// Picks the first class that has a spellcastingAbility set.
// Falls back to "charisma" if no class or no ability configured.
function getCharacterSpellcastingAbility(characterRecord) {
  const classes = characterRecord?.data?.classes || [];
  for (const c of classes) {
    const ability = c?.data?.spellcastingAbility;
    if (ability) return ability;
  }
  return "charisma";
}

// Returns the BEST spellcasting ability across all of a character's classes —
// i.e. the distinct spellcastingAbility values from every class, reduced to
// whichever currently has the highest modifier. Falls back to charisma when no
// class has one configured. Used to resolve an attackCalculation modifier whose
// field is the sentinel "Spellcasting Ability" (e.g. Pact of the Blade — "you
// use your spellcasting ability for attack and damage rolls").
function getBestSpellcastingAbility(characterRecord) {
  const classes = characterRecord?.data?.classes || [];
  const abilities = [];
  for (const c of classes) {
    const ability = c?.data?.spellcastingAbility;
    if (ability && !abilities.includes(ability)) abilities.push(ability);
  }
  if (abilities.length === 0) return "charisma";
  if (abilities.length === 1) return abilities[0];
  return getHighestAbilityOf(characterRecord, abilities);
}

// Resolves an attackCalculation modifier's field. Normally the field IS the
// ability name; the sentinel "Spellcasting Ability" (case/space-insensitive)
// instead resolves to the character's best class spellcasting ability.
function resolveAttackCalculationAbility(field, characterRecord) {
  if (!field) return field;
  if (field.replace(/\s+/g, "").toLowerCase() === "spellcastingability") {
    return getBestSpellcastingAbility(characterRecord);
  }
  return field;
}

// Returns the ability with the highest modifier from the given list.
// Ties are broken by the order of the abilities array (first wins).
function getHighestAbilityOf(characterRecord, abilities) {
  let best = abilities[0];
  let bestMod = -999;
  for (const ability of abilities) {
    const mod = parseInt(characterRecord?.data?.[ability + "Mod"] || "0", 10);
    if (mod > bestMod) {
      bestMod = mod;
      best = ability;
    }
  }
  return best;
}

// Resolves a "highest_x_y" spellcasting ability value to the actual ability.
// Returns the value as-is if it's not a "highest" combo.
function resolveHighestAbility(characterRecord, value) {
  if (value === "highest")
    return getHighestAbilityOf(characterRecord, [
      "intelligence",
      "wisdom",
      "charisma",
    ]);
  if (value === "highest_int_cha")
    return getHighestAbilityOf(characterRecord, ["intelligence", "charisma"]);
  if (value === "highest_wis_cha")
    return getHighestAbilityOf(characterRecord, ["wisdom", "charisma"]);
  if (value === "highest_int_wis")
    return getHighestAbilityOf(characterRecord, ["intelligence", "wisdom"]);
  return value;
}

// NOTE: generateId(), safeAddValue(), and processDeferredAbilityGroups() are
// provided by common.js (loaded first). They are intentionally NOT redefined
// here to avoid duplicate global definitions across the two rollhandler scripts.

// ─── Proficiency & Tool Proficiency ──────────────────────────────────────────

// Merges new comma-separated values into an existing comma-separated string,
// skipping duplicates (case-insensitive) and "None" entries.
function mergeCommaSeparated(existing, toAdd) {
  if (!toAdd || toAdd === "None") return existing || "";
  const current = existing && existing !== "None" ? existing : "";
  const currentItems = current
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const currentLower = currentItems.map((s) => s.toLowerCase());
  const newItems = toAdd
    .split(",")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s !== "" && s !== "None" && !currentLower.includes(s.toLowerCase()),
    );
  if (newItems.length === 0) return current;
  return currentItems.length > 0
    ? currentItems.join(", ") + ", " + newItems.join(", ")
    : newItems.join(", ");
}

// Merge weapon-proficiency lists with 5e-specific category superseding.
// A FULL category ("Martial Weapons") subsumes any LIMITED form of it
// ("Martial weapons that have the Finesse or Light property"), and likewise for
// the simple category. Entries may be comma-separated and/or joined with " and "
// (e.g. "Simple weapons and Martial weapons that have the Finesse or Light
// property"), so e.g. that list + "Martial weapons" normalizes to
// "Simple Weapons, Martial Weapons". Output is normalized, deduped, comma-joined.
function mergeWeaponProficiencies(existing, toAdd) {
  const splitEntries = (s) =>
    (s || "")
      .split(",")
      .flatMap((part) => part.split(/\s+and\s+/i))
      .map((e) => e.trim())
      .filter((e) => e !== "" && e.toLowerCase() !== "none");

  const entries = [...splitEntries(existing), ...splitEntries(toAdd)];
  if (entries.length === 0) return existing && existing !== "None" ? existing : "";

  let hasFullSimple = false;
  let hasFullMartial = false;
  const seen = new Set();
  const normalized = [];

  entries.forEach((entry) => {
    const lower = entry.toLowerCase();
    let canonical = entry;
    let kind = "other"; // fullSimple | fullMartial | limitedSimple | limitedMartial | other

    if (/^simple weapons?$/.test(lower)) {
      canonical = "Simple Weapons";
      kind = "fullSimple";
      hasFullSimple = true;
    } else if (/^martial weapons?$/.test(lower)) {
      canonical = "Martial Weapons";
      kind = "fullMartial";
      hasFullMartial = true;
    } else if (/^simple weapons?\b/.test(lower)) {
      canonical = entry.replace(/^simple weapons?/i, "Simple Weapons");
      kind = "limitedSimple";
    } else if (/^martial weapons?\b/.test(lower)) {
      canonical = entry.replace(/^martial weapons?/i, "Martial Weapons");
      kind = "limitedMartial";
    }

    const dedupKey = canonical.toLowerCase();
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    normalized.push({ canonical, kind });
  });

  return normalized
    .filter((e) => {
      if (e.kind === "limitedMartial" && hasFullMartial) return false;
      if (e.kind === "limitedSimple" && hasFullSimple) return false;
      return true;
    })
    .map((e) => e.canonical)
    .join(", ");
}

function guessAbility(tool) {
  const lower = tool.toLowerCase();
  if (lower.includes("thieve")) return "dexterity";
  if (lower.includes("alchemist")) return "intelligence";
  if (lower.includes("brewer")) return "intelligence";
  if (lower.includes("calligrapher")) return "dexterity";
  if (lower.includes("carpenter")) return "strength";
  if (lower.includes("cartographer")) return "wisdom";
  if (lower.includes("cobbler")) return "dexterity";
  if (lower.includes("cook")) return "wisdom";
  if (lower.includes("glassblower")) return "intelligence";
  if (lower.includes("jeweler")) return "intelligence";
  if (lower.includes("leatherworker")) return "dexterity";
  if (lower.includes("mason")) return "strength";
  if (lower.includes("painter")) return "wisdom";
  if (lower.includes("potter")) return "intelligence";
  if (lower.includes("smith")) return "strength";
  if (lower.includes("tinker")) return "dexterity";
  if (lower.includes("weaver")) return "dexterity";
  if (lower.includes("woodcarver")) return "dexterity";
  if (lower.includes("disguise")) return "charisma";
  if (lower.includes("forgery")) return "dexterity";
  if (
    lower.includes("gaming") ||
    lower.includes("dice") ||
    lower.includes("card")
  )
    return "wisdom";
  if (lower.includes("herbalism")) return "intelligence";
  if (lower.includes("navigator")) return "wisdom";
  if (lower.includes("poisoner")) return "intelligence";
  if (lower.includes("vehicle")) return "wisdom";
  if (
    lower.includes("instrument") ||
    lower.includes("lute") ||
    lower.includes("harp") ||
    lower.includes("lyre") ||
    lower.includes("flute") ||
    lower.includes("drum") ||
    lower.includes("horn") ||
    lower.includes("bagpipe") ||
    lower.includes("dulcimer") ||
    lower.includes("sing")
  )
    return "charisma";
  return "intelligence";
}

// Tool/instrument lists for expanding "Choose" patterns in tool proficiencies
const TOOL_LISTS = {
  artisans: [
    "Alchemist's Supplies",
    "Brewer's Supplies",
    "Calligrapher's Supplies",
    "Carpenter's Tools",
    "Cartographer's Tools",
    "Cobbler's Tools",
    "Cook's Utensils",
    "Glassblower's Tools",
    "Jeweler's Tools",
    "Leatherworker's Tools",
    "Mason's Tools",
    "Painter's Supplies",
    "Potter's Tools",
    "Smith's Tools",
    "Tinker's Tools",
    "Weaver's Tools",
    "Woodcarver's Tools",
  ],
  instruments: [
    "Bagpipes",
    "Drum",
    "Dulcimer",
    "Flute",
    "Harp",
    "Horn",
    "Lute",
    "Lyre",
    "Pan Flute",
    "Shawm",
    "Trombone",
    "Viol",
    "Violin",
  ],
  gaming: ["Dice Set", "Board Game Set", "Playing Card Set"],
};

const ALL_KNOWN_TOOLS = [
  ...TOOL_LISTS.artisans,
  ...TOOL_LISTS.instruments,
  ...TOOL_LISTS.gaming,
  "Disguise Kit",
  "Forgery Kit",
  "Herbalism Kit",
  "Navigator's Tools",
  "Poisoner's Kit",
  "Smith's Tools",
  "Thieves' Tools",
  "Vehicles (Land)",
  "Vehicles (Water)",
];

// Category keywords that should be skipped when parsing specific tool names from "from" clauses
const TOOL_CATEGORY_KEYWORDS = [
  "artisan",
  "instrument",
  "musical",
  "gaming",
  "tool",
];

// Parse a tool proficiency string and return { options, numChoices } or null if not a choice pattern.
// Pure function — no side effects, no API calls.
function parseToolProficiencyChoices(proficienciesString, existingToolNames) {
  const raw = (proficienciesString || "").trim();
  const existingTools = (existingToolNames || []).map((s) => s.toLowerCase());

  // Detect choice patterns like:
  //   "Choose one type of artisan's tools or one musical instrument"
  //   "Choose one from: Alchemist's Supplies, Brewer's Supplies"
  //   "Two musical instruments of your choice, or 1 musical instrument and any other tool"
  const chooseMatch = raw.match(/^[Cc]hoose\s+(.+)/);
  const isToolChoice =
    !chooseMatch &&
    (/\bof your choice\b/i.test(raw) ||
      /\bany\s+(?:other\s+)?tool\b/i.test(raw)) &&
    (/\binstrument/i.test(raw) ||
      /\bartisan/i.test(raw) ||
      /\btool\b/i.test(raw));
  if (!chooseMatch && !isToolChoice) return null;

  const chooseText = (chooseMatch ? chooseMatch[1] : raw).toLowerCase();

  // Build the list of options. A "from"/":" clause is authoritative — it
  // restricts the category (e.g. "one artisan's tool of your choice from
  // alchemist's supplies, calligrapher's supplies, or cartographer's tools"
  // should offer those three, not all 16 artisan tools). Only fall back to
  // expanding category keywords when no "from" clause is present.
  let allOptions = [];
  const fromMatch = raw.match(/(?:from\s*:?|:)\s*(.+)/i);

  if (fromMatch) {
    const pushUnique = (tool) => {
      if (!allOptions.some((o) => o.toLowerCase() === tool.toLowerCase())) {
        allOptions.push(tool);
      }
    };
    fromMatch[1]
      .split(/,|\band\b|\bor\b/)
      .map((s) => s.replace(/^(an?|the)\s+/i, "").trim())
      .filter((s) => s !== "")
      .forEach((t) => {
        const tLower = t.toLowerCase();

        // Specific known tool — add it (canonical casing)
        const knownMatch = ALL_KNOWN_TOOLS.find(
          (k) => k.toLowerCase() === tLower,
        );
        if (knownMatch) {
          pushUnique(knownMatch);
          return;
        }

        // Category references — expand to that category's list
        if (/\bany\s+(?:other\s+)?tool\b/.test(tLower)) {
          ALL_KNOWN_TOOLS.forEach(pushUnique);
          return;
        }
        if (tLower.includes("artisan")) {
          TOOL_LISTS.artisans.forEach(pushUnique);
          return;
        }
        if (tLower.includes("instrument")) {
          TOOL_LISTS.instruments.forEach(pushUnique);
          return;
        }
        if (tLower.includes("gaming")) {
          TOOL_LISTS.gaming.forEach(pushUnique);
          return;
        }

        // Unknown bare category keyword (e.g. just "tool") — skip
        if (TOOL_CATEGORY_KEYWORDS.some((kw) => tLower.includes(kw))) return;

        // Otherwise add as-is — might be a tool not in our known list
        pushUnique(t);
      });
  } else {
    // "any tool" / "any other tool" means all categories
    const anyTool = /\bany\s+(?:other\s+)?tool\b/.test(chooseText);
    if (chooseText.includes("artisan") || anyTool) {
      TOOL_LISTS.artisans.forEach((t) => allOptions.push(t));
    }
    if (
      chooseText.includes("musical instrument") ||
      chooseText.includes("instrument") ||
      anyTool
    ) {
      TOOL_LISTS.instruments.forEach((t) => allOptions.push(t));
    }
    if (chooseText.includes("gaming") || anyTool) {
      TOOL_LISTS.gaming.forEach((t) => allOptions.push(t));
    }
    if (anyTool) {
      [
        "Disguise Kit",
        "Forgery Kit",
        "Herbalism Kit",
        "Navigator's Tools",
        "Poisoner's Kit",
        "Smith's Tools",
        "Thieves' Tools",
        "Vehicles (Land)",
        "Vehicles (Water)",
      ].forEach((t) => {
        if (!allOptions.some((o) => o.toLowerCase() === t.toLowerCase())) {
          allOptions.push(t);
        }
      });
    }
  }

  // Filter out already-proficient tools
  allOptions = allOptions.filter(
    (t) => !existingTools.includes(t.toLowerCase()),
  );

  if (allOptions.length === 0) return null;

  // Parse how many to choose (default 1)
  const numWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const countMatch = chooseText.match(/^(\w+)/);
  let numChoices = 1;
  if (countMatch) {
    const n = parseInt(countMatch[1], 10);
    if (!isNaN(n)) {
      numChoices = n;
    } else if (numWords[countMatch[1]]) {
      numChoices = numWords[countMatch[1]];
    }
  }
  numChoices = Math.min(numChoices, allOptions.length);

  return { options: allOptions, numChoices };
}

// Add tool proficiencies as other skills on the character, skipping duplicates.
// Detects "Choose..." patterns and shows a prompt for the player to pick.
function addToolProficiency(proficienciesString, recordOverride, callback) {
  const rec = recordOverride || record;
  const raw = (proficienciesString || "").trim();
  const existingToolNames = (rec?.data?.otherSkills || []).map(
    (s) => s?.name || "",
  );
  const parsed = parseToolProficiencyChoices(raw, existingToolNames);
  if (parsed) {
    const { options: allOptions, numChoices } = parsed;

    const options = allOptions.map((t) => ({ label: t, value: t }));
    api.showPrompt(
      "Tool Proficiency",
      "Tool Proficiency",
      `${raw}`,
      options,
      null,
      (values) => {
        if (values && values.length > 0) {
          const chosen = values.map((v) => v.value || v);
          addToolsToOtherSkills(chosen, rec, callback);
        } else {
          if (callback) callback();
        }
      },
      "OK",
      "Cancel",
      numChoices,
    );
    return;
  }

  // Non-"Choose" path: direct comma-separated tool names
  const toolProficiencies = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "None");
  addToolsToOtherSkills(toolProficiencies, rec, callback);
}

// Helper: add an array of tool names to other skills, skipping duplicates
function addToolsToOtherSkills(toolNames, rec, callback) {
  const existingTools = (rec?.data?.otherSkills || []).map((s) =>
    (s?.name || "").toLowerCase(),
  );
  const toolsToAdd = [];
  toolNames.forEach((tool) => {
    if (!existingTools.includes(tool.toLowerCase())) {
      const toolAbility = guessAbility(tool);
      const abilityMod = parseInt(rec?.data?.[`${toolAbility}Mod`] || "0", 10);
      const proficiencyBonus = parseInt(rec?.data?.proficiencyBonus || "2", 10);
      toolsToAdd.push({
        name: tool,
        data: {
          skillProf: "true",
          ability: toolAbility,
          skillMod: abilityMod + proficiencyBonus,
        },
      });
      existingTools.push(tool.toLowerCase());
    }
  });
  if (toolsToAdd.length > 0) {
    let index = 0;
    const addNext = () => {
      if (index >= toolsToAdd.length) {
        if (callback) callback();
        return;
      }
      safeAddValue(
        "data.otherSkills",
        toolsToAdd[index],
        () => {
          index++;
          addNext();
        },
        rec,
      );
    };
    addNext();
  } else {
    if (callback) callback();
  }
}

// Add tool proficiency with expertise fallback: if the tool already exists in
// otherSkills, add an expertise die feature instead. Otherwise grant proficiency.
// Entry: { value, expertise, featureName, sourceName, portrait, level }
function addToolProficiencyWithExpertise(entry, recordOverride, callback) {
  const rec = recordOverride || record;
  const raw = (entry.value || "").trim();

  // Resolve the tool names (handles "Choose..." patterns and comma-separated)
  const existingToolNames = (rec?.data?.otherSkills || []).map(
    (s) => s?.name || "",
  );
  const parsed = parseToolProficiencyChoices(raw, existingToolNames);

  const processTools = (toolNames) => {
    const existing = (rec?.data?.otherSkills || []).map((s) =>
      (s?.name || "").toLowerCase(),
    );
    const toAdd = [];
    const toExpertise = [];

    toolNames.forEach((tool) => {
      if (existing.includes(tool.toLowerCase())) {
        // Already has this tool — queue expertise die
        toExpertise.push(tool);
      } else {
        // New tool — add with proficiency
        const toolAbility = guessAbility(tool);
        const abilityMod = parseInt(
          rec?.data?.[`${toolAbility}Mod`] || "0",
          10,
        );
        const proficiencyBonus = parseInt(
          rec?.data?.proficiencyBonus || "2",
          10,
        );
        toAdd.push({
          name: tool,
          data: {
            skillProf: "true",
            ability: toolAbility,
            skillMod: abilityMod + proficiencyBonus,
          },
        });
        existing.push(tool.toLowerCase());
      }
    });

    // Chain: first add new tools, then add expertise features
    const addExpertiseFeatures = () => {
      if (toExpertise.length === 0) {
        if (callback) callback();
        return;
      }
      let eIdx = 0;
      const addNextExpertise = () => {
        if (eIdx >= toExpertise.length) {
          if (callback) callback();
          return;
        }
        const toolName = toExpertise[eIdx++];
        // Find the camelCase key for the tool in otherSkills for the expertiseDie field
        const otherSkill = (rec?.data?.otherSkills || []).find(
          (s) => (s?.name || "").toLowerCase() === toolName.toLowerCase(),
        );
        const skillField = otherSkill?.name || toolName;
        safeAddValue(
          "data.features",
          {
            name: skillField + " Expertise (" + entry.featureName + ")",
            portrait: entry.portrait,
            recordType: "feats",
            data: {
              source: entry.sourceName,
              type: "feature",
              featureType: "feat",
              level: entry.level,
              prerequisites: entry.featureName,
              description:
                skillField +
                " expertise, granted by " +
                entry.featureName +
                ".",
              modifiers: [
                {
                  _id: generateId(),
                  name: "Modifier",
                  data: {
                    type: "expertiseDie",
                    field: skillField,
                    valueType: "string",
                    active: true,
                    value: "1d4",
                  },
                },
              ],
            },
          },
          () => addNextExpertise(),
          rec,
        );
      };
      addNextExpertise();
    };

    if (toAdd.length > 0) {
      let aIdx = 0;
      const addNextTool = () => {
        if (aIdx >= toAdd.length) {
          addExpertiseFeatures();
          return;
        }
        safeAddValue(
          "data.otherSkills",
          toAdd[aIdx++],
          () => addNextTool(),
          rec,
        );
      };
      addNextTool();
    } else {
      addExpertiseFeatures();
    }
  };

  if (parsed) {
    const { options: allOptions, numChoices } = parsed;
    const options = allOptions.map((t) => ({ label: t, value: t }));
    api.showPrompt(
      "Tool Proficiency",
      "Tool Proficiency",
      `${raw}`,
      options,
      null,
      (values) => {
        if (values && values.length > 0) {
          processTools(values.map((v) => v.value || v));
        } else {
          if (callback) callback();
        }
      },
      "OK",
      "Cancel",
      numChoices,
    );
    return;
  }

  // Non-"Choose" path: direct comma-separated tool names
  const toolNames = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "None");
  processTools(toolNames);
}

// Collect proficiency modifiers from a feature/item into a fieldsToSet object.
// Armor/weapon proficiencies are merged into the fieldsToSet object.
// Tool proficiency strings are collected into fieldsToSet._pendingToolProficiencies
// (an internal array) — callers must process these via applyPendingToolProficiencies()
// in the callback chain to avoid fire-and-forget race conditions.
function collectProficiencyFields(featureOrItem, fieldsToSet, recordOverride) {
  const rec = recordOverride || record;
  const modifiers = featureOrItem?.data?.modifiers || [];
  modifiers.forEach((mod) => {
    const modType = mod?.data?.type || "";
    const rawValue = mod?.data?.value;
    const modValue =
      typeof rawValue === "string" ? rawValue.trim() : String(rawValue || "");
    if (modType === "skillProficiency") {
      const skillField = normalizeSkillField((mod?.data?.field || "").trim());
      if (skillField) {
        // Value defaults to "true" (proficient) if not specified
        const profValue = (modValue || "true").trim();
        const profRank = { false: 0, half: 1, true: 2 };

        // "all" applies to every standard skill (e.g., field: "all", value: "half")
        const ALL_STANDARD_SKILLS = [
          "acrobatics",
          "animalHandling",
          "arcana",
          "athletics",
          "culture",
          "deception",
          "engineering",
          "history",
          "insight",
          "intimidation",
          "investigation",
          "medicine",
          "nature",
          "perception",
          "performance",
          "persuasion",
          "religion",
          "sleightOfHand",
          "stealth",
          "survival",
        ];
        const skillsToApply =
          skillField === "all" ? ALL_STANDARD_SKILLS : [skillField];

        skillsToApply.forEach((sf) => {
          const currentProf =
            fieldsToSet[`data.${sf}Prof`] ||
            rec?.data?.[`${sf}Prof`] ||
            "false";

          // "expertise": add expertiseDie feature if already proficient, otherwise grant full prof
          if (profValue === "expertise") {
            if (currentProf === "true") {
              // Already proficient — queue a one-off expertise feature
              if (!fieldsToSet._pendingExpertiseFeatures) {
                fieldsToSet._pendingExpertiseFeatures = [];
              }
              fieldsToSet._pendingExpertiseFeatures.push({
                skillField: sf,
                featureName: featureOrItem?.name || "Expertise",
                sourceName:
                  featureOrItem?.data?.source ||
                  featureOrItem?.name ||
                  "Feature",
                portrait: featureOrItem?.portrait || "",
                level: featureOrItem?.data?.level || 1,
              });
            } else {
              // Not proficient — grant full proficiency
              fieldsToSet[`data.${sf}Prof`] = "true";
              const skillAbility =
                rec?.data?.[`${sf}Ability`] || getAbilityFromSkill(sf);
              const abilityMod = parseInt(
                fieldsToSet[`data.${skillAbility}Mod`] ||
                  rec?.data?.[`${skillAbility}Mod`] ||
                  "0",
                10,
              );
              const profBonus = Math.max(
                parseInt(rec?.data?.proficiencyBonus || "0", 10),
                2,
              );
              fieldsToSet[`data.${sf}Mod`] = abilityMod + profBonus;
            }
            return;
          }

          // "specialty": add a skill specialty if already proficient, otherwise
          // grant full proficiency. Mirrors the "expertise" branch above but
          // queues a (blank, player-named) specialty in that skill instead of
          // an expertise-die feature. Used by feats like Skillful: "if you
          // already have proficiency in a chosen skill, you instead gain a
          // skill specialty with that skill."
          if (profValue === "specialty") {
            if (currentProf === "true" || currentProf === "expertise") {
              // Already (at least) proficient — queue a skill specialty.
              if (!fieldsToSet._pendingSkillSpecialties) {
                fieldsToSet._pendingSkillSpecialties = [];
              }
              fieldsToSet._pendingSkillSpecialties.push({
                skill: sf,
                specialty: "",
              });
            } else {
              // Not proficient (false/half) — grant full proficiency.
              fieldsToSet[`data.${sf}Prof`] = "true";
              const skillAbility =
                rec?.data?.[`${sf}Ability`] || getAbilityFromSkill(sf);
              const abilityMod = parseInt(
                fieldsToSet[`data.${skillAbility}Mod`] ||
                  rec?.data?.[`${skillAbility}Mod`] ||
                  "0",
                10,
              );
              const profBonus = Math.max(
                parseInt(rec?.data?.proficiencyBonus || "0", 10),
                2,
              );
              fieldsToSet[`data.${sf}Mod`] = abilityMod + profBonus;
            }
            return;
          }

          if ((profRank[profValue] ?? 0) > (profRank[currentProf] ?? 0)) {
            fieldsToSet[`data.${sf}Prof`] = profValue;
            const skillAbility =
              rec?.data?.[`${sf}Ability`] || getAbilityFromSkill(sf);
            const abilityMod = parseInt(
              fieldsToSet[`data.${skillAbility}Mod`] ||
                rec?.data?.[`${skillAbility}Mod`] ||
                "0",
              10,
            );
            const profBonus = Math.max(
              parseInt(rec?.data?.proficiencyBonus || "0", 10),
              2,
            );
            let skillMod = abilityMod;
            if (profValue === "half") {
              skillMod = abilityMod + Math.floor(profBonus / 2);
            } else if (profValue === "true") {
              skillMod = abilityMod + profBonus;
            }
            fieldsToSet[`data.${sf}Mod`] = skillMod;
          }
        });
      }
      return;
    }
    if (modType === "saveProficiency") {
      const saveAbility = (mod?.data?.field || "").trim().toLowerCase();
      const VALID_SAVES = [
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
      ];
      if (saveAbility && VALID_SAVES.includes(saveAbility)) {
        const currentProf =
          fieldsToSet[`data.${saveAbility}Prof`] ||
          rec?.data?.[`${saveAbility}Prof`] ||
          "false";
        if (currentProf !== "true") {
          fieldsToSet[`data.${saveAbility}Prof`] = "true";
          const abilityMod = parseInt(
            fieldsToSet[`data.${saveAbility}Mod`] ||
              rec?.data?.[`${saveAbility}Mod`] ||
              "0",
            10,
          );
          const profBonus = Math.max(
            parseInt(rec?.data?.proficiencyBonus || "0", 10),
            2,
          );
          fieldsToSet[`data.${saveAbility}Save`] = abilityMod + profBonus;
        }
      }
      return;
    }
    if (!modValue) return;
    if (modType === "armorProficiency") {
      const current =
        fieldsToSet["data.armorTraining"] || rec?.data?.armorTraining || "";
      fieldsToSet["data.armorTraining"] = mergeCommaSeparated(
        current,
        modValue,
      );
    } else if (modType === "weaponProficiency") {
      const current =
        fieldsToSet["data.weaponProficiencies"] ||
        rec?.data?.weaponProficiencies ||
        "";
      fieldsToSet["data.weaponProficiencies"] = mergeWeaponProficiencies(
        current,
        modValue,
      );
    } else if (modType === "toolProficiency") {
      // Collect for deferred processing — DO NOT call addToolProficiency here
      // as it fires async api.addValue calls that race with feature adds
      if (!fieldsToSet._pendingToolProficiencies) {
        fieldsToSet._pendingToolProficiencies = [];
      }
      const modField = (mod?.data?.field || "").trim().toLowerCase();
      if (modField === "expertise") {
        // "Expertise" mode: grant proficiency, or expertise die if already proficient
        fieldsToSet._pendingToolProficiencies.push({
          value: modValue,
          expertise: true,
          featureName: featureOrItem?.name || "Expertise",
          sourceName:
            featureOrItem?.data?.source || featureOrItem?.name || "Feature",
          portrait: featureOrItem?.portrait || "",
          level: featureOrItem?.data?.level || 1,
        });
      } else {
        fieldsToSet._pendingToolProficiencies.push(modValue);
      }
    } else if (modType === "creatureType") {
      const current =
        fieldsToSet["data.creatureType"] || rec?.data?.creatureType || "";
      fieldsToSet["data.creatureType"] = mergeCommaSeparated(current, modValue);
    }
  });
}

// Process any pending tool proficiencies collected by collectProficiencyFields,
// then call the callback. Safe to call even if no pending tools exist.
function applyPendingToolProficiencies(fieldsToSet, recordOverride, callback) {
  const pending = fieldsToSet._pendingToolProficiencies || [];
  delete fieldsToSet._pendingToolProficiencies;
  if (pending.length === 0) {
    if (callback) callback();
    return;
  }
  // Chain tool proficiency adds sequentially
  let idx = 0;
  const addNext = () => {
    if (idx >= pending.length) {
      if (callback) callback();
      return;
    }
    const entry = pending[idx++];
    if (typeof entry === "object" && entry.expertise) {
      addToolProficiencyWithExpertise(entry, recordOverride, addNext);
    } else {
      addToolProficiency(
        typeof entry === "string" ? entry : entry.value,
        recordOverride,
        addNext,
      );
    }
  };
  addNext();
}

// Extract pending tool proficiencies from fieldsToSet BEFORE passing to api.setValues.
// Returns the pending array. Removes the internal key from fieldsToSet.
function extractPendingToolProficiencies(fieldsToSet) {
  const pending = fieldsToSet._pendingToolProficiencies || [];
  delete fieldsToSet._pendingToolProficiencies;
  return pending;
}

// Extract pending skill specialties from fieldsToSet BEFORE passing to api.setValues.
// Returns the pending array. Removes the internal key from fieldsToSet.
function extractPendingSkillSpecialties(fieldsToSet) {
  const pending = fieldsToSet._pendingSkillSpecialties || [];
  delete fieldsToSet._pendingSkillSpecialties;
  return pending;
}

// Apply pending skill specialties by appending each to data.skillSpecialties via safeAddValue.
// Fetches a fresh record to check for duplicates, then chains adds sequentially.
function applyPendingSkillSpecialties(pending, recordOverride, callback) {
  if (!pending || pending.length === 0) {
    if (callback) callback();
    return;
  }
  const rec = recordOverride || record;
  const allSkillKeys = [
    "acrobatics",
    "animalHandling",
    "arcana",
    "athletics",
    "culture",
    "deception",
    "engineering",
    "history",
    "insight",
    "intimidation",
    "investigation",
    "medicine",
    "nature",
    "perception",
    "performance",
    "persuasion",
    "religion",
    "sleightOfHand",
    "stealth",
    "survival",
  ];
  let idx = 0;
  const addNext = () => {
    if (idx >= pending.length) {
      if (callback) callback();
      return;
    }
    const { skill, specialty } = pending[idx++];
    // Fetch fresh record each time to avoid duplicates from concurrent adds
    api.getRecord(rec.recordType || "characters", rec._id, (freshRec) => {
      const existing = freshRec?.data?.skillSpecialties || [];
      const exists = existing.some(
        (s) => s.data?.skill === skill && s.data?.specialty === specialty,
      );
      if (exists) {
        addNext();
        return;
      }
      const fields = {};
      const isStandard = allSkillKeys.includes(skill);
      allSkillKeys.forEach((s) => {
        fields[`box_${s}`] = { hidden: s !== skill };
      });
      fields["box_other"] = { hidden: isStandard };
      safeAddValue(
        "data.skillSpecialties",
        {
          _id: generateId(),
          name: "Specialty",
          unidentifiedName: "Specialty",
          recordType: "records",
          identified: true,
          data: { skill, specialty, active: false },
          fields: fields,
        },
        () => addNext(),
        rec,
      );
    });
  };
  addNext();
}

// Extract pending expertise features from fieldsToSet BEFORE passing to api.setValues.
function extractPendingExpertiseFeatures(fieldsToSet) {
  const pending = fieldsToSet._pendingExpertiseFeatures || [];
  delete fieldsToSet._pendingExpertiseFeatures;
  return pending;
}

// Apply pending expertise features by adding a one-off feature with an expertiseDie modifier
// for each queued entry. Chains safeAddValue calls sequentially.
function applyPendingExpertiseFeatures(pending, recordOverride, callback) {
  if (!pending || pending.length === 0) {
    if (callback) callback();
    return;
  }
  const rec = recordOverride || record;
  let idx = 0;
  const addNext = () => {
    if (idx >= pending.length) {
      if (callback) callback();
      return;
    }
    const entry = pending[idx++];
    const skillLabel = capitalize(
      entry.skillField.replace(/([A-Z])/g, " $1").trim(),
    );
    safeAddValue(
      "data.features",
      {
        name: skillLabel + " Expertise (" + entry.featureName + ")",
        portrait: entry.portrait,
        recordType: "feats",
        data: {
          source: entry.sourceName,
          type: "feature",
          featureType: "feat",
          level: entry.level,
          prerequisites: entry.featureName,
          description:
            skillLabel + " expertise, granted by " + entry.featureName + ".",
          modifiers: [
            {
              _id: generateId(),
              name: "Modifier",
              data: {
                type: "expertiseDie",
                field: entry.skillField,
                valueType: "string",
                active: true,
                value: "1d4",
              },
            },
          ],
        },
      },
      () => addNext(),
      rec,
    );
  };
  addNext();
}

// Extract all pending deferred items from fieldsToSet BEFORE passing to api.setValues.
function extractAllPending(fieldsToSet) {
  return {
    pendingToolProfs: extractPendingToolProficiencies(fieldsToSet),
    pendingSkillSpecialties: extractPendingSkillSpecialties(fieldsToSet),
    pendingExpertiseFeatures: extractPendingExpertiseFeatures(fieldsToSet),
  };
}

// Apply all pending deferred items sequentially.
function applyAllPending(pending, recordOverride, callback) {
  const afterExpertise = () => {
    if (callback) callback();
  };
  const afterSpecialties = () => {
    if ((pending.pendingExpertiseFeatures || []).length > 0) {
      applyPendingExpertiseFeatures(
        pending.pendingExpertiseFeatures,
        recordOverride,
        afterExpertise,
      );
    } else {
      afterExpertise();
    }
  };
  const afterTools = () => {
    if (pending.pendingSkillSpecialties.length > 0) {
      applyPendingSkillSpecialties(
        pending.pendingSkillSpecialties,
        recordOverride,
        afterSpecialties,
      );
    } else {
      afterSpecialties();
    }
  };
  if (pending.pendingToolProfs.length > 0) {
    applyPendingToolProficiencies(
      { _pendingToolProficiencies: pending.pendingToolProfs },
      recordOverride,
      afterTools,
    );
  } else {
    afterTools();
  }
}

// Returns true if there are any pending deferred items.
function hasAnyPending(pending) {
  return (
    pending.pendingToolProfs.length > 0 ||
    pending.pendingSkillSpecialties.length > 0 ||
    (pending.pendingExpertiseFeatures || []).length > 0
  );
}

// ─── One-Time Modifiers ─────────────────────────────────────────────────────

// Shared alias map: display names, camelCase, lowercase, plurals → canonical camelCase key.
// Used by skillProficiency and skillSpecialty modifiers to normalize user input.
const SKILL_ALIASES = {
  acrobatics: "acrobatics",
  animalhandling: "animalHandling",
  "animal handling": "animalHandling",
  animalHandling: "animalHandling",
  arcana: "arcana",
  athletics: "athletics",
  culture: "culture",
  deception: "deception",
  engineering: "engineering",
  history: "history",
  insight: "insight",
  intimidation: "intimidation",
  investigation: "investigation",
  medicine: "medicine",
  nature: "nature",
  perception: "perception",
  performance: "performance",
  persuasion: "persuasion",
  religion: "religion",
  "sleight of hand": "sleightOfHand",
  sleightofhand: "sleightOfHand",
  sleightOfHand: "sleightOfHand",
  stealth: "stealth",
  survival: "survival",
  strengthSave: "strengthSave",
  strengthsave: "strengthSave",
  "strength save": "strengthSave",
  "strength saves": "strengthSave",
  strengthsaves: "strengthSave",
  dexteritySave: "dexteritySave",
  dexteritysave: "dexteritySave",
  "dexterity save": "dexteritySave",
  "dexterity saves": "dexteritySave",
  dexteritysaves: "dexteritySave",
  constitutionSave: "constitutionSave",
  constitutionsave: "constitutionSave",
  "constitution save": "constitutionSave",
  "constitution saves": "constitutionSave",
  constitutionsaves: "constitutionSave",
  intelligenceSave: "intelligenceSave",
  intelligencesave: "intelligenceSave",
  "intelligence save": "intelligenceSave",
  "intelligence saves": "intelligenceSave",
  intelligencesaves: "intelligenceSave",
  wisdomSave: "wisdomSave",
  wisdomsave: "wisdomSave",
  "wisdom save": "wisdomSave",
  "wisdom saves": "wisdomSave",
  wisdomsaves: "wisdomSave",
  charismaSave: "charismaSave",
  charismasave: "charismaSave",
  "charisma save": "charismaSave",
  "charisma saves": "charismaSave",
  charismasaves: "charismaSave",
};

// Normalize a skill field value using the shared alias map.
// Falls back to camelCase normalization for unknown values (e.g., custom other-skills).
function normalizeSkillField(raw) {
  return (
    SKILL_ALIASES[raw] ||
    SKILL_ALIASES[raw.toLowerCase()] ||
    raw.toLowerCase().replace(/\s+(.)/g, (m, c) => c.toUpperCase())
  );
}

// Resolve a modifier's value to an integer, handling number/string/field valueTypes.
// For string: runs checkForReplacements then evaluateMath. For field: reads from record.
function resolveModifierValue(mod, recordOverride) {
  const rec = recordOverride || record;
  const valueType = mod?.data?.valueType || "number";
  const rawValue = mod?.data?.value || "";
  if (valueType === "number") {
    const v = parseInt(rawValue, 10);
    return isNaN(v) ? 0 : v;
  } else if (valueType === "string") {
    const replaced = checkForReplacements(rawValue, {}, rec);
    return evaluateMath(replaced);
  } else if (valueType === "field") {
    const fieldValue = rec?.data?.[rawValue] || "0";
    const v = parseInt(fieldValue, 10);
    return isNaN(v) ? 0 : v;
  }
  return 0;
}

// Apply one-time modifiers from a feature or item.
// Folds proficiency modifiers into fieldsToSet. Returns { needsHpRecalc }.
// Does NOT handle attribute bonuses — call recalcAttributeBonuses separately after
// features/items have been added/removed (it re-derives from current state).
function applyOneTimeModifiers(featureOrItem, fieldsToSet, recordOverride) {
  const rec = recordOverride || record;
  collectProficiencyFields(featureOrItem, fieldsToSet, recordOverride);
  const modifiers = featureOrItem?.data?.modifiers || [];
  const needsHpRecalc = modifiers.some((m) => m?.data?.type === "hitpoints");

  // Process language modifiers — merge language(s) into data.languages
  modifiers.forEach((mod) => {
    if (mod?.data?.type === "language") {
      const lang = (mod?.data?.value || "").trim();
      if (lang) {
        const current =
          fieldsToSet["data.languages"] || rec?.data?.languages || "";
        fieldsToSet["data.languages"] = mergeCommaSeparated(current, lang);
      }
    }
  });

  // Process setValue modifiers — set arbitrary data fields on the character
  modifiers.forEach((mod) => {
    if (mod?.data?.type === "setValue") {
      const field = (mod?.data?.field || "").trim();
      const val = mod?.data?.value ?? "";
      if (field) {
        fieldsToSet[`data.${field}`] = val;
      }
    }
  });

  // Process toggle modifiers — add toggles to data.toggles array (deduplicated by field)
  modifiers.forEach((mod) => {
    if (mod?.data?.type === "toggle") {
      const toggleField = (mod?.data?.field || "").trim();
      const toggleName = (mod?.data?.value || toggleField || "").trim();
      if (!toggleField) return;
      const existingToggles =
        fieldsToSet["data.toggles"] || rec?.data?.toggles || [];
      const alreadyExists = existingToggles.some(
        (t) => t?.data?.field === toggleField,
      );
      if (!alreadyExists) {
        const newToggles = [...existingToggles];
        newToggles.push({
          _id: generateId(),
          name: toggleName,
          unidentifiedName: toggleName,
          recordType: "records",
          identified: true,
          data: { field: toggleField, active: false },
        });
        fieldsToSet["data.toggles"] = newToggles;
      }
    }
  });

  // Process senses modifiers — merge sense entries into data.senses string,
  // keeping the higher distance if the same sense type already exists.
  // Value formats:
  //   "Darkvision 60"        — set if higher than existing (or add if new)
  //   "Darkvision 120/60"    — set to 120 if sense exists; else add at 60 (fallback)
  //   "Darkvision +30"       — add 30 to existing range; else add at 30
  //   "Darkvision +30/30"    — add 30 to existing range; else add at 30 (explicit fallback)
  modifiers.forEach((mod) => {
    if (mod?.data?.type === "senses") {
      const newSense = (mod?.data?.value || "").trim();
      if (!newSense) return;
      // Parse sense name and distance, with optional + prefix (additive) and optional /fallback
      const match = newSense.match(/^(.+?)\s+(\+?)(\d+)(?:\/(\d+))?$/);
      const newName = match ? match[1].trim() : newSense;
      const isAdditive = match ? match[2] === "+" : false;
      const primaryDist = match ? parseInt(match[3], 10) : 0;
      const fallbackDist = match && match[4] ? parseInt(match[4], 10) : null;
      // Get current senses (may already be partially built up in fieldsToSet)
      const currentSenses =
        fieldsToSet["data.senses"] !== undefined
          ? fieldsToSet["data.senses"]
          : rec?.data?.senses || "";
      // Parse existing senses into entries
      const entries = currentSenses
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      // Check if this sense type already exists
      const existingIdx = entries.findIndex((e) => {
        const eMatch = e.match(/^(.+?)\s+(\d+)$/);
        const eName = eMatch ? eMatch[1].trim() : e;
        return eName.toLowerCase() === newName.toLowerCase();
      });
      if (existingIdx >= 0) {
        // Same sense type exists
        if (isAdditive) {
          // Additive: add primary distance to existing
          const eMatch = entries[existingIdx].match(/^(.+?)\s+(\d+)$/);
          const existingDist = eMatch ? parseInt(eMatch[2], 10) : 0;
          entries[existingIdx] = `${newName} ${existingDist + primaryDist}`;
        } else if (primaryDist === 0) {
          skillOrToolExpertise;
          // No range specified = unlimited, always overwrite
          entries[existingIdx] = `${newName} ${primaryDist}`;
        } else {
          // Set-if-higher
          const eMatch = entries[existingIdx].match(/^(.+?)\s+(\d+)$/);
          const existingDist = eMatch ? parseInt(eMatch[2], 10) : 0;
          if (existingDist > 0 && primaryDist > existingDist) {
            entries[existingIdx] = `${newName} ${primaryDist}`;
          }
        }
      } else {
        // New sense type — use fallback distance if provided, otherwise primary
        // (for additive form without explicit fallback, primary doubles as the base)
        const dist = fallbackDist !== null ? fallbackDist : primaryDist;
        entries.push(dist > 0 ? `${newName} ${dist}` : newName);
      }
      fieldsToSet["data.senses"] = entries.join(", ");
    }
  });

  // Process skillSpecialty modifiers — collect entries to add via safeAddValue later.
  // Deferred like tool proficiencies to avoid overwriting specialties added by other paths.
  modifiers.forEach((mod) => {
    if (mod?.data?.type === "skillSpecialty") {
      const rawSkill = (mod?.data?.field || "").trim();
      const specialty = (mod?.data?.value || "").trim();
      if (!rawSkill || !specialty) return;
      let skill = normalizeSkillField(rawSkill);
      if (!fieldsToSet._pendingSkillSpecialties) {
        fieldsToSet._pendingSkillSpecialties = [];
      }
      fieldsToSet._pendingSkillSpecialties.push({ skill, specialty });
    }
  });

  // Process speed modifiers — apply bonus/penalty to current speed string
  const hasSpeedMod = modifiers.some(
    (m) =>
      m?.data?.type === "speedBonus" ||
      m?.data?.type === "speedPenalty" ||
      m?.data?.type === "baseSpeed",
  );
  if (hasSpeedMod) {
    // Base speed comes from species, default 30 ft
    const species = (rec?.data?.species || [])[0];
    const speciesSpeed = String(species?.data?.speed || "30 ft");
    const match = speciesSpeed.match(/(\d+)/);
    if (match) {
      let speedValue = parseInt(match[1], 10);
      const unit = speciesSpeed.replace(match[1], "").trim() || "ft";
      const additionalModes = [];
      // Apply baseSpeed modifiers first — sets the base (only upgrades, never downgrades)
      modifiers.forEach((mod) => {
        if (mod?.data?.active === false) return;
        if (mod?.data?.type === "baseSpeed") {
          const newBase = parseInt(mod?.data?.value, 10) || 0;
          if (newBase > speedValue) {
            speedValue = newBase;
          }
        }
      });
      // Then apply bonuses and penalties on top
      modifiers.forEach((mod) => {
        if (mod?.data?.active === false) return;
        if (mod?.data?.type === "speedPenalty") {
          speedValue -= Math.abs(parseInt(mod?.data?.value, 10) || 0);
        } else if (mod?.data?.type === "speedBonus") {
          const bonusValue = mod?.data?.value;
          const numericBonus = parseInt(bonusValue, 10);
          if (
            !isNaN(numericBonus) &&
            String(numericBonus) === String(bonusValue).trim()
          ) {
            speedValue += numericBonus;
          } else if (bonusValue) {
            additionalModes.push(bonusValue);
          }
        }
      });
      speedValue = Math.max(0, speedValue);
      let finalSpeed = `${speedValue} ${unit}`;
      if (additionalModes.length > 0) {
        finalSpeed += ", " + additionalModes.join(", ");
      }
      fieldsToSet["data.speed"] = finalSpeed;
    }
  }

  return { needsHpRecalc };
}

// ─── Provides Items ─────────────────────────────────────────────────────────

// Apply "Provides Items" from a feature — adds items, spells, abilities, or feats
// to the character's appropriate lists. Chains async api.addValue calls sequentially.
function applyProvidesItems(feature, characterRecord, callback) {
  const providesItems = feature?.data?.providesItems || [];
  if (providesItems.length === 0) {
    if (callback) callback();
    return;
  }

  const charRecType = characterRecord?.recordType || "characters";
  const charRecId = characterRecord?._id;

  // Fetch a fresh record so level and other fields reflect the latest persisted state
  api.getRecord(charRecType, charRecId, (freshRec) => {
    // Track existing feature names so we don't double-add feats that are already
    // on the character (e.g. mutually-referencing providesItems chains).
    const existingFeatureNames = new Set(
      (freshRec?.data?.features || [])
        .map((f) => (f?.name || "").toLowerCase())
        .filter(Boolean),
    );

    let index = 0;

    function addNext() {
      if (index >= providesItems.length) {
        if (callback) callback();
        return;
      }

      const item = providesItems[index];
      index++;

      // Level gating: skip items whose levelRequirement exceeds the character's current level
      const levelReq = parseInt(item?.data?.levelRequirement || "0", 10);
      if (levelReq > 0) {
        const charLevel = Math.max(
          parseInt(freshRec?.data?.level || "1", 10),
          1,
        );
        if (charLevel < levelReq) {
          addNext();
          return;
        }
      }

      const recordType = item?.recordType || "";

      // Skip feats already present on the character (by name, case-insensitive).
      // Prevents duplicate adds when two features provide each other at the same
      // level gate (e.g. Hunter's Target ⇄ Swift Feet).
      if (recordType === "feats") {
        const itemName = (item?.name || "").toLowerCase();
        if (itemName && existingFeatureNames.has(itemName)) {
          addNext();
          return;
        }
        if (itemName) existingFeatureNames.add(itemName);
      }

      const charRec = { recordType: charRecType, _id: charRecId };
      if (recordType === "items") {
        safeAddValue(
          "data.inventory",
          {
            ...item,
            // Fresh _id so the added inventory item doesn't collide with the
            // compendium source (or other copies from the same source); the
            // original is preserved as data.fromId.
            _id: generateId(),
            data: {
              ...item?.data,
              fromId: item._id,
              count: item?.data?.count || 1,
              carried: "equipped",
            },
          },
          () => addNext(),
          charRec,
        );
      } else if (recordType === "spells") {
        const spellLevel = item?.data?.level || "0";
        const spellLevelNum =
          spellLevel === "Cantrip" || spellLevel === "0"
            ? 0
            : parseInt(spellLevel, 10) || 0;
        const spellPath =
          spellLevelNum === 0 ? "data.cantrips" : `data.spells${spellLevelNum}`;
        let spellAbility = item?.data?.spellcastingAbility;
        if (spellAbility && spellAbility.startsWith("highest")) {
          spellAbility = resolveHighestAbility(characterRecord, spellAbility);
        } else if (!spellAbility) {
          spellAbility = getCharacterSpellcastingAbility(characterRecord);
        }
        const spellType = item?.data?.spellType || "";
        const spellData = { ...item?.data, ability: spellAbility };
        if (spellType === "atwill") {
          spellData.prepared = "atwill";
        } else if (spellType === "daily") {
          spellData.prepared = "daily";
          spellData.maxDailyUses = spellData.maxDailyUses || 1;
          spellData.dailyUses = 0;
          spellData.restoreOnRest = spellData.restoreOnRest || "long";
        }
        const spellToAdd = {
          ...item,
          _id: generateId(),
          data: spellData,
        };
        safeAddValue(
          spellPath,
          spellToAdd,
          (updatedRecord) => {
            // Ensure maxSpellLevel is at least this spell's level
            const curMax = updatedRecord?.data?.maxSpellLevel || "";
            const curMaxNum =
              curMax === "Cantrip" ? 0 : parseInt(curMax, 10) || 0;
            const fieldsToSet = {};
            if (spellLevelNum > curMaxNum) {
              fieldsToSet["data.maxSpellLevel"] = `${spellLevelNum}`;
              fieldsToSet["fields.cantripsOpen.hidden"] = false;
              for (let i = 1; i <= spellLevelNum; i++) {
                fieldsToSet[`fields.level${i}spellsOpen.hidden`] = false;
              }
            } else if (spellLevelNum === 0 && !curMax) {
              fieldsToSet["data.maxSpellLevel"] = "Cantrip";
              fieldsToSet["fields.cantripsOpen.hidden"] = false;
            }

            // Unhide daily/atwill fields on the newly added spell
            if (spellType === "atwill" || spellType === "daily") {
              const spellList =
                spellLevelNum === 0
                  ? updatedRecord?.data?.cantrips
                  : updatedRecord?.data?.[`spells${spellLevelNum}`];
              const spellIdx = (spellList || []).length - 1;
              if (spellIdx >= 0) {
                const basePath = `${spellPath}.${spellIdx}.fields`;
                fieldsToSet[`${basePath}.saveDc.hidden`] = false;
                fieldsToSet[`${basePath}.attackMod.hidden`] = false;
                if (spellType === "daily") {
                  fieldsToSet[`${basePath}.maxDailyUses.hidden`] = false;
                  fieldsToSet[`${basePath}.dailyUses.hidden`] = false;
                  fieldsToSet[`${basePath}.restoreOnRest.hidden`] = false;
                }
              }
            }

            if (Object.keys(fieldsToSet).length > 0) {
              api.setValues(fieldsToSet, () => addNext());
            } else {
              addNext();
            }
          },
          charRec,
        );
      } else if (recordType === "abilities") {
        // Combat Maneuvers and Focus Feature Abilities default to the shared
        // "Combat Maneuvers" group so their exertion costs share one pool.
        // A feature can opt out by setting `providesAbilitiesToOwnGroup: true`,
        // which routes the ability into the feature's own `abilityGroupName`
        // (useful when the group has its own uses-per-day pool).
        const isCombatManeuver =
          item?.data?.type === "Combat Maneuver" ||
          item?.data?.type === "Focus Feature Ability";
        const ownGroupName = (feature?.data?.abilityGroupName || "").trim();
        const ownGroupFlag =
          item?.data?.providesAbilitiesToOwnGroup === true ||
          feature?.data?.providesAbilitiesToOwnGroup === true;
        const useOwnGroup = ownGroupFlag && !!ownGroupName;
        const groupName = useOwnGroup
          ? ownGroupName
          : isCombatManeuver
            ? "Combat Maneuvers"
            : ownGroupName || feature?.name || "Feature";
        // Give the added ability a fresh _id so it doesn't collide with the
        // compendium source (or other copies added from the same source).
        const abilityToAdd = { ...item, _id: generateId() };
        // Fetch fresh record to check existing groups
        api.getRecord(charRecType, charRecId, (freshRec) => {
          const existingGroup = freshRec?.data?.abilityGroups?.find(
            (ag) => ag?.name === groupName,
          );

          if (existingGroup) {
            const groupIdx = freshRec?.data?.abilityGroups?.findIndex(
              (ag) => ag?.name === groupName,
            );
            safeAddValue(
              `data.abilityGroups.${groupIdx}.data.abilities`,
              abilityToAdd,
              () => addNext(),
              charRec,
            );
          } else {
            safeAddValue(
              "data.abilityGroups",
              {
                name: groupName,
                data: { abilities: [abilityToAdd] },
              },
              () => addNext(),
              charRec,
            );
          }
        });
      } else if (recordType === "feats") {
        const featLevel = parseInt(item?.data?.level || "1", 10);
        addChoiceFeature(
          {
            ...item,
            data: { ...item?.data, source: feature?.name || "Feature" },
          },
          feature?.name || "Feature",
          featLevel,
          charRec,
          () => addNext(),
        );
      } else {
        // Unknown type, skip
        addNext();
      }
    }

    addNext();
  }); // end api.getRecord
}

// Apply providesItems for an array of features, chaining callbacks sequentially.
function applyProvidesItemsForFeatures(features, characterRecord, callback) {
  const withItems = (features || []).filter(
    (f) => (f?.data?.providesItems || []).length > 0,
  );
  if (withItems.length === 0) {
    if (callback) callback();
    return;
  }
  let idx = 0;
  function next() {
    if (idx >= withItems.length) {
      if (callback) callback();
      return;
    }
    applyProvidesItems(withItems[idx++], characterRecord, next);
  }
  next();
}

// Apply level-gated providesItems that have just become available at the new level.
// Scans ALL features on the character (origin sources + features list) for providesItems
// entries whose levelRequirement matches the character's current level. Skips items
// already present (by name match) to avoid duplicates from prior level-ups.
function applyNewlyUnlockedProvidesItems(characterRecord, callback) {
  api.getRecord(
    characterRecord?.recordType || "characters",
    characterRecord?._id,
    (freshRec) => {
      const charLevel = Math.max(parseInt(freshRec?.data?.level || "1", 10), 1);
      // Collect all features from all sources
      const allFeatures = [];
      const sources = [
        ...(freshRec?.data?.species || []),
        ...(freshRec?.data?.backgrounds || []),
        ...(freshRec?.data?.classes || []),
        ...(freshRec?.data?.subclasses || []),
      ];
      sources.forEach((source) => {
        (source?.data?.feature_list || []).forEach((f) => allFeatures.push(f));
      });
      (freshRec?.data?.features || []).forEach((f) => allFeatures.push(f));

      // Collect existing spell/item names for duplicate detection
      const existingSpellNames = new Set();
      (freshRec?.data?.cantrips || []).forEach((s) =>
        existingSpellNames.add((s?.name || "").toLowerCase()),
      );
      for (let i = 1; i <= 9; i++) {
        (freshRec?.data?.[`spells${i}`] || []).forEach((s) =>
          existingSpellNames.add((s?.name || "").toLowerCase()),
        );
      }
      const existingItemNames = new Set();
      (freshRec?.data?.inventory || []).forEach((it) =>
        existingItemNames.add((it?.name || "").toLowerCase()),
      );

      // Build synthetic features containing only the newly-unlocked items.
      // Track seen item names to avoid double-adding when the same feature
      // appears in both origin sources (e.g. data.cultures) and data.features.
      const featuresToProcess = [];
      const seenItemNames = new Set();
      allFeatures.forEach((feature) => {
        const items = (feature?.data?.providesItems || []).filter((item) => {
          const levelReq = parseInt(item?.data?.levelRequirement || "0", 10);
          if (levelReq !== charLevel) return false;
          // Check duplicates
          const name = (item?.name || "").toLowerCase();
          if (!name) return false;
          if (seenItemNames.has(name)) return false;
          const recordType = item?.recordType || "";
          if (recordType === "spells" && existingSpellNames.has(name))
            return false;
          if (recordType === "items" && existingItemNames.has(name))
            return false;
          seenItemNames.add(name);
          return true;
        });
        if (items.length > 0) {
          featuresToProcess.push({
            ...feature,
            data: { ...feature?.data, providesItems: items },
          });
        }
      });

      if (featuresToProcess.length === 0) {
        if (callback) callback();
        return;
      }
      applyProvidesItemsForFeatures(featuresToProcess, freshRec, callback);
    },
  );
}

// ─── Slug-Based Feature Addition ────────────────────────────────────────────

// Resolve a slug value. If it matches @record.data.X, resolve the field path
// on the character record (e.g. "@record.data.paragonGift" → value of
// characterRecord.data.paragonGift). Supports nested paths via dot notation.
// Otherwise return the literal string.
function resolveSlug(rawSlug, characterRecord) {
  if (!rawSlug) return "";
  const trimmed = rawSlug.trim();
  const match = trimmed.match(/^@record\.data\.([\w.]+)$/);
  if (!match) return trimmed;
  const path = match[1];
  let resolved = characterRecord?.data;
  for (const segment of path.split(".")) {
    resolved = resolved?.[segment];
  }
  return String(resolved ?? "").trim();
}

// Query feats matching a slug and add them as features on the character.
// Skips feats that already exist on the character (by name + source match).
// The slug parameter can be a literal string or a @field reference resolved
// against the character record.
function addFeatsWithSlug(slug, sourceName, characterRecord, callback) {
  const resolvedSlug = resolveSlug(slug, characterRecord);
  if (!resolvedSlug) {
    if (callback) callback();
    return;
  }

  api.getRecordsByQuery("feats", { "data.slug": resolvedSlug }, (results) => {
    const featsToAdd = results || [];
    if (featsToAdd.length === 0) {
      if (callback) callback();
      return;
    }

    // Get fresh record to check existing features
    const charRecType = characterRecord?.recordType || "characters";
    const charRecId = characterRecord?._id;
    api.getRecord(charRecType, charRecId, (freshRec) => {
      const existingFeatures = (freshRec?.data?.features || []).map(
        (f) => `${f?.data?.source || ""}-${f?.name || ""}`,
      );

      // Filter out feats that already exist on the character
      const newFeats = featsToAdd.filter((feat) => {
        const key = `${sourceName}-${feat?.name || ""}`;
        return !existingFeatures.includes(key);
      });

      if (newFeats.length === 0) {
        if (callback) callback();
        return;
      }

      // Add each feat sequentially (processing modifiers, abilities, providesItems)
      let idx = 0;
      function addNextFeat() {
        if (idx >= newFeats.length) {
          if (callback) callback();
          return;
        }
        const feat = newFeats[idx++];
        const featLevel = parseInt(feat?.data?.level || "1", 10);
        addChoiceFeature(feat, sourceName, featLevel, freshRec, addNextFeat);
      }
      addNextFeat();
    });
  });
}

// Process addsFeatsWithSlug for an array of features, chaining callbacks sequentially.
// Deduplicates by resolved slug value so each query only runs once per batch.
function applySlugFeaturesForFeatures(features, characterRecord, callback) {
  const seen = new Set();
  const withSlugs = (features || []).filter((f) => {
    const raw = (f?.data?.addsFeatsWithSlug || "").trim();
    if (!raw) return false;
    const resolved = resolveSlug(raw, characterRecord);
    if (!resolved || seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
  if (withSlugs.length === 0) {
    if (callback) callback();
    return;
  }
  let idx = 0;
  function next() {
    if (idx >= withSlugs.length) {
      if (callback) callback();
      return;
    }
    const feature = withSlugs[idx++];
    const raw = (feature?.data?.addsFeatsWithSlug || "").trim();
    const sourceName = feature?.data?.source || feature?.name || "Feature";
    addFeatsWithSlug(raw, sourceName, characterRecord, next);
  }
  next();
}

// ─── Attribute Bonuses & HP ─────────────────────────────────────────────────

// Recalculate attribute bonuses from ALL features and equipped items on the character.
// Scans all attributeBonus modifiers, sums per ability, then sets:
//   data.{ability}Base (snapshot from current score on first call)
//   data.{ability}Bonus (total from all sources)
//   data.{ability} = base + bonus
// Calls setModifier for each changed ability to update derived values.
// Call this after features/items change (add, remove, equip, unequip).
function recalcAttributeBonuses(fieldsToSet, recordOverride) {
  const rec = recordOverride || record;
  const abilities = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ];

  // Sum all attributeBonus modifiers from features.
  // Value can be a plain number (e.g. 2) or "N:M" where N is the bonus and M
  // is a new ability score maximum (e.g. "4:24" = +4, max 24).
  const totalBonuses = {};
  const abilityMaxes = {}; // highest max override per ability
  const features = rec?.data?.features || [];

  function collectAttributeBonus(mod) {
    const ability = (mod?.data?.field || "").trim().toLowerCase();
    if (!ability) return;
    const rawValue = String(mod?.data?.value || "").trim();
    let bonus = 0;
    let max = null;
    if (rawValue.includes(":")) {
      const parts = rawValue.split(":");
      bonus = parseInt(parts[0], 10) || 0;
      max = parseInt(parts[1], 10) || null;
    } else {
      bonus = resolveModifierValue(mod, rec);
    }
    if (bonus) {
      totalBonuses[ability] = (totalBonuses[ability] || 0) + bonus;
    }
    if (max !== null) {
      abilityMaxes[ability] = Math.max(abilityMaxes[ability] || 20, max);
    }
  }

  features.forEach((feature) => {
    const modifiers = feature?.data?.modifiers || [];
    modifiers.forEach((mod) => {
      if (mod?.data?.type === "attributeBonus") collectAttributeBonus(mod);
    });
  });

  // Sum from equipped inventory items
  const inventory = rec?.data?.inventory || [];
  inventory.forEach((item) => {
    if (item?.data?.carried !== "equipped") return;
    const modifiers = item?.data?.modifiers || [];
    modifiers.forEach((mod) => {
      if (mod?.data?.type === "attributeBonus") collectAttributeBonus(mod);
    });
  });

  // For each ability, update base/bonus/total
  abilities.forEach((ability) => {
    const newBonus = totalBonuses[ability] || 0;
    const currentBonus = parseInt(rec?.data?.[`${ability}Bonus`] ?? "0", 10);
    const newMax = abilityMaxes[ability] || null;
    const currentMax = rec?.data?.[`${ability}Max`] ?? null;

    // Skip if nothing changed
    if (newBonus === currentBonus && newMax === currentMax) return;

    // Initialize base if not yet set (snapshot from current score minus old bonus)
    const existingBase = rec?.data?.[`${ability}Base`];
    if (existingBase === undefined || existingBase === null) {
      const currentScore = parseInt(rec?.data?.[ability] ?? "0", 10);
      fieldsToSet[`data.${ability}Base`] = currentScore - currentBonus;
    }
    const base = parseInt(
      fieldsToSet[`data.${ability}Base`] ??
        rec?.data?.[`${ability}Base`] ??
        "0",
      10,
    );

    fieldsToSet[`data.${ability}Bonus`] = newBonus;
    let newTotal = base + newBonus;

    // Cap at the ability max if one is set
    if (newMax !== null) {
      fieldsToSet[`data.${ability}Max`] = newMax;
      if (newTotal > newMax) {
        newTotal = newMax;
      }
    }

    fieldsToSet[`data.${ability}`] = newTotal;

    // Recalc derived values (modifier, saves, skills, HP, AC, carry weight,
    // ability group uses). Pass `rec` so setModifier uses the same record as
    // this recalc — important during level-up flows where the global `record`
    // may be stale (e.g. missing the just-added hpLevelN, which would make
    // getHpForLevel undercount if a feature bumped CON this level).
    setModifier(newTotal, ability, {}, fieldsToSet, rec);
  });

  // Always re-derive carry weight in case encumbranceSizeIncrease modifiers changed.
  // Scan rec directly so we don't rely on getEffectsAndModifiers reading from the
  // potentially-stale global record. Skip if strength was already recalced above
  // (setModifier already ran and would have used the stale global record anyway).
  if (!("data.strength" in fieldsToSet)) {
    const allSources = [
      ...(rec?.data?.features || []),
      ...(rec?.data?.inventory || []).filter(
        (i) => i?.data?.carried === "equipped",
      ),
    ];
    let sizeSteps = 0;
    allSources.forEach((src) => {
      (src?.data?.modifiers || []).forEach((m) => {
        if (m?.data?.type === "encumbranceSizeIncrease") {
          const v = parseInt(m?.data?.value, 10);
          sizeSteps += isNaN(v) ? 1 : v;
        }
      });
    });
    if (sizeSteps !== 0) {
      sizeSteps = Math.max(-1, Math.min(1, sizeSteps));
      const sizeOrder = [
        "tiny",
        "small",
        "medium",
        "large",
        "huge",
        "gargantuan",
      ];
      let size = (rec?.data?.size || "Medium").toLowerCase();
      const currentIdx = sizeOrder.indexOf(size);
      const newIdx = Math.max(
        0,
        Math.min(
          sizeOrder.length - 1,
          (currentIdx >= 0 ? currentIdx : 2) + sizeSteps,
        ),
      );
      const effectiveSize =
        sizeOrder[newIdx].charAt(0).toUpperCase() + sizeOrder[newIdx].slice(1);
      const strVal = parseInt(rec?.data?.strength ?? "10", 10);
      const { carry, dragLiftPush } = getCarryWeight(strVal, effectiveSize);
      fieldsToSet["data.maxCarryWeight"] = carry;
      fieldsToSet["data.dragLiftPush"] = dragLiftPush;
    }
  }
}

// Recalculate HP from all feature/item modifiers and update if changed.
// Call this AFTER features have been persisted to the record.
function recalcHitPoints(recordOverride) {
  const rec = recordOverride || record;
  const conMod = parseInt(rec?.data?.constitutionMod || "0", 10);
  const newHp = getHpForLevel(conMod, rec);
  if (newHp !== rec?.data?.hitpoints) {
    api.setValue("data.hitpoints", newHp);
  }
}

// Recalculate AC and HP after features have been added/modified.
// Fetches a fresh record to ensure all modifiers are accounted for.
function recalcACAndHP(characterRecord, callback) {
  const recType = characterRecord?.recordType || "characters";
  const recId = characterRecord?._id;
  api.getRecord(recType, recId, (rec) => {
    const fieldsToSet = {};

    // Skip AC recalc for shapeshifted characters
    if (!rec?.data?.shapeshiftingNpc) {
      const acCalcMods = getEffectsAndModifiersForToken(rec, [
        "armorClassCalculation",
      ]);
      const dexMod = parseInt(rec?.data?.dexterityMod || "0", 10);
      const bestEquippedArmor = rec?.data?.armor || undefined;

      let armorClass = 10 + dexMod;
      if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
        const effMaxDex = getEffectiveMaxDex(rec, bestEquippedArmor);
        armorClass =
          bestEquippedArmor.ac + (effMaxDex ? Math.min(dexMod, effMaxDex) : 0);
      }

      let baseAC = 10;
      let calcBonus = 0;

      // Only apply acCalculationMods if unarmored
      if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
        acCalcMods.forEach((mod) => {
          const modBaseAC = parseInt(mod.value || "0", 10);
          if (modBaseAC > baseAC) baseAC = modBaseAC;
          if (mod.field && mod.field !== "dexterity") {
            const acBonus = parseInt(rec?.data?.[`${mod.field}Mod`] || "0", 10);
            if (acBonus > calcBonus) calcBonus = acBonus;
          }
        });
        armorClass = baseAC + dexMod;
      }

      // AC bonuses/penalties from features and effects
      const acBonuses = getEffectsAndModifiersForToken(rec, [
        "armorClassBonus",
        "armorClassPenalty",
      ]);
      acBonuses.forEach((mod) => {
        if (mod.value) {
          // Skip conditional AC bonuses (e.g., "1 size larger") — they only apply during attacks
          if ((mod.field || "").match(/\d+\s+size\s+larger/i)) return;
          // Weapon property conditional
          if (mod.field && _isWeaponPropertyCondition(mod.field)) {
            if (!_hasEquippedWeaponWithProperty(rec, mod.field)) return;
          }
          const acBonus = parseInt(mod.value || "0", 10);
          if (!isNaN(acBonus)) calcBonus += acBonus;
        }
      });

      if (bestEquippedArmor?.shieldAc) armorClass += bestEquippedArmor.shieldAc;
      armorClass += calcBonus;
      fieldsToSet["data.ac"] = armorClass;
    }

    // Speed recalc — features added since last recalc may have speed modifiers
    const calculatedSpeed = calculateSpeed(rec);
    if (calculatedSpeed !== rec?.data?.speed) {
      fieldsToSet["data.speed"] = calculatedSpeed;
    }

    // HP recalc
    const conMod = parseInt(rec?.data?.constitutionMod || "0", 10);
    const newHp = getHpForLevel(conMod, rec);
    if (newHp > 0) fieldsToSet["data.hitpoints"] = newHp;

    // Passive skill recalc — picks up passiveBonus/passivePenalty, new expertise
    // dice, senses that grant advantage/disadvantage, skillProficiency-driven
    // skill mod changes, etc. Covers add paths; delete path calls this itself.
    recalcPassiveSkills(rec, fieldsToSet);

    // Toggle reconcile — self-heals against parallel applyOneTimeModifiers
    // calls that each read a stale data.toggles and overwrite each other's
    // additions. Adds any missing toggles for current modifiers, drops orphans.
    recalcToggles(fieldsToSet, rec);

    if (Object.keys(fieldsToSet).length > 0) {
      api.setValues(fieldsToSet, () => {
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  });
}

// ─── Choice Processing ──────────────────────────────────────────────────────

// Get the level of a specific class from the classLevels string (e.g. "Druid 2 / Adept 1")
// Returns the class-specific level, or the total character level for non-class sources.
function _getClassLevel(className, characterRecord) {
  const classLevels = characterRecord?.data?.classLevels || "";
  const safeClassName = className.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`${safeClassName}\\s+(\\d+)`, "i");
  const match = classLevels.match(regex);
  return match ? parseInt(match[1], 10) : 0;
}

// Quick check: returns true if the record has any features with unanswered choices.
function _hasPendingChoices(characterRecord) {
  const characterLevel = Math.max(
    parseInt(characterRecord?.data?.level || "1", 10),
    1,
  );
  // For classes and archetypes, use the class-specific level instead of total character level
  const classNames = new Set(
    (characterRecord?.data?.classes || []).map((c) => c?.name),
  );
  const archetypeClassMap = {};
  (characterRecord?.data?.subclasses || []).forEach((a) => {
    archetypeClassMap[a?.name] = a?.data?.class || "";
  });

  const sources = [
    ...(characterRecord?.data?.species || []),
    ...(characterRecord?.data?.backgrounds || []),
    ...(characterRecord?.data?.classes || []),
    ...(characterRecord?.data?.subclasses || []),
  ];
  for (const source of sources) {
    const sourceName = source?.name || "";
    // Determine effective level cap: class-specific for classes/archetypes, total for others
    let effectiveLevel = characterLevel;
    if (classNames.has(sourceName)) {
      effectiveLevel = _getClassLevel(sourceName, characterRecord);
    } else if (archetypeClassMap[sourceName]) {
      effectiveLevel = _getClassLevel(
        archetypeClassMap[sourceName],
        characterRecord,
      );
    }
    const features = source?.data?.feature_list || [];
    for (const feature of features) {
      const featureLevel = parseInt(feature?.data?.level || "1", 10);
      if (featureLevel > effectiveLevel) continue;
      const choices = feature?.data?.choices || [];
      for (const choice of choices) {
        const selected = choice?.data?.selectedChoices || [];
        if (selected.length > 0) continue;
        const skipIfArchetype = choice?.data?.skipIfArchetype || "";
        if (skipIfArchetype) {
          const archetypes = characterRecord?.data?.subclasses || [];
          if (archetypes.some((a) => a?.name === skipIfArchetype)) continue;
        }
        const options = choice?.data?.options || [];
        const query = choice?.data?.query || "";
        const choiceType = choice?.data?.choiceType || "";
        if (options.length > 0 || query || choiceType) return true;
      }
    }
  }
  // Also check standalone feats and choice-added features
  const standaloneFeatures = characterRecord?.data?.features || [];
  for (const feature of standaloneFeatures) {
    const ft = feature?.data?.featureType || "";
    if (ft !== "feat" && ft !== "choice") continue;
    const featureLevel = parseInt(feature?.data?.level || "1", 10);
    if (featureLevel > characterLevel) continue;
    const choices = feature?.data?.choices || [];
    for (const choice of choices) {
      const selected = choice?.data?.selectedChoices || [];
      if (selected.length > 0) continue;
      const skipIfArchetype = choice?.data?.skipIfArchetype || "";
      if (skipIfArchetype) {
        const skipNames = skipIfArchetype
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const archetypes = characterRecord?.data?.subclasses || [];
        if (archetypes.some((a) => skipNames.includes(a?.name))) continue;
      }
      const options = choice?.data?.options || [];
      const query = choice?.data?.query || "";
      const choiceType = choice?.data?.choiceType || "";
      if (options.length > 0 || query || choiceType) return true;
    }
  }
  return false;
}

/**
 * Scans a character record for features with unanswered choices and prompts the user.
 * Features are collected from heritages, cultures, backgrounds, classes, and feats.
 * Only features at or below the character's current level are considered.
 * Fetches a fresh record first to ensure recently added data is included.
 * After all choices are resolved, re-checks up to 3 levels deep for nested choices
 * (e.g., a culture choice that grants a feat with its own choice).
 *
 * @param {Object} characterRecord - The character record (used to get the ID)
 * @param {Function} callback - Called when all choices are resolved
 */
function processChoices(characterRecord, callback, _depth) {
  var depth = _depth || 0;
  var MAX_DEPTH = 3;
  api.getRecord("characters", characterRecord._id, (freshRecord) => {
    _processChoicesInternal(freshRecord, () => {
      // Re-run to catch choices added by choices (e.g., a culture choice that grants a feat with its own choice)
      if (depth < MAX_DEPTH) {
        api.getRecord("characters", freshRecord._id, (latestRecord) => {
          // Check if there are any remaining pending choices before recursing
          var hasPending = _hasPendingChoices(latestRecord);
          if (hasPending) {
            processChoices(latestRecord, callback, depth + 1);
          } else {
            if (callback) callback();
          }
        });
      } else {
        if (callback) callback();
      }
    });
  });
}

function _processChoicesInternal(characterRecord, callback) {
  const characterLevel = Math.max(
    parseInt(characterRecord?.data?.level || "1", 10),
    1,
  );

  // Collect all feature sources with their data paths
  const featureSources = [];

  // Species features
  const species = characterRecord?.data?.species || [];
  species.forEach((sp, sIdx) => {
    const features = sp?.data?.feature_list || [];
    features.forEach((feature, fIdx) => {
      featureSources.push({
        feature: feature,
        sourceName: sp?.name || "Species",
        dataPath: `data.species.${sIdx}.data.feature_list.${fIdx}`,
      });
    });
  });

  // Background features (from the background record stored on the character)
  const backgrounds = characterRecord?.data?.backgrounds || [];
  backgrounds.forEach((background, bIdx) => {
    const features = background?.data?.feature_list || [];
    features.forEach((feature, fIdx) => {
      featureSources.push({
        feature: feature,
        sourceName: background?.name || "Background",
        dataPath: `data.backgrounds.${bIdx}.data.feature_list.${fIdx}`,
      });
    });
  });

  // Class features (from the class records stored on the character)
  // Use class-specific level, not total character level
  const classes = characterRecord?.data?.classes || [];
  classes.forEach((classObj, clIdx) => {
    const classLevel = _getClassLevel(classObj?.name || "", characterRecord);
    const features = classObj?.data?.feature_list || [];
    features.forEach((feature, fIdx) => {
      featureSources.push({
        feature: feature,
        sourceName: classObj?.name || "Class",
        dataPath: `data.classes.${clIdx}.data.feature_list.${fIdx}`,
        maxLevel: classLevel,
      });
    });
  });

  // Subclass features — use the parent class's level
  const subclasses = characterRecord?.data?.subclasses || [];
  subclasses.forEach((subclass, aIdx) => {
    const parentClassName = subclass?.data?.class || "";
    const classLevel = _getClassLevel(parentClassName, characterRecord);
    const features = subclass?.data?.feature_list || [];
    features.forEach((feature, fIdx) => {
      featureSources.push({
        feature: feature,
        sourceName: subclass?.name || "Subclass",
        dataPath: `data.subclasses.${aIdx}.data.feature_list.${fIdx}`,
        maxLevel: classLevel,
      });
    });
  });

  // Standalone feats and choice-added features (which may themselves have sub-choices).
  // Excludes origin-copied features to avoid double-prompting.
  const standaloneFeatures = characterRecord?.data?.features || [];
  standaloneFeatures.forEach((feature, fIdx) => {
    const ft = feature?.data?.featureType || "";
    if (ft === "feat" || ft === "choice") {
      featureSources.push({
        feature: feature,
        sourceName: feature?.name || "Feat",
        dataPath: `data.features.${fIdx}`,
      });
    }
  });

  // Filter to features at or below the effective level that have pending choices
  // For class/archetype features, use the class-specific level; for others, use total character level
  const choicesToMake = [];
  featureSources.forEach((source) => {
    const feature = source.feature;
    const featureLevel = parseInt(feature?.data?.level || "1", 10);
    const effectiveLevel =
      source.maxLevel !== undefined ? source.maxLevel : characterLevel;
    if (featureLevel > effectiveLevel) return;
    const choices = feature?.data?.choices || [];
    choices.forEach((choiceObj, cIdx) => {
      // Check if this choice has already been answered
      const selectedChoices = choiceObj?.data?.selectedChoices || [];
      if (selectedChoices.length > 0) return;

      // Skip if character has a matching archetype (e.g. skipIfArchetype: "Gladiator")
      const skipIfArchetype = choiceObj?.data?.skipIfArchetype || "";
      if (skipIfArchetype) {
        const skipNames = skipIfArchetype
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const archetypes = characterRecord?.data?.subclasses || [];
        if (archetypes.some((a) => skipNames.includes(a?.name))) return;
      }

      // Check if the choice has options, a query, or a choiceType to present
      const options = choiceObj?.data?.options || [];
      const query = choiceObj?.data?.query || "";
      const choiceType = choiceObj?.data?.choiceType || "";
      if (options.length === 0 && !query && !choiceType) return;

      choicesToMake.push({
        feature: feature,
        featureName: feature?.name || "Feature",
        sourceName: source.sourceName,
        dataPath: source.dataPath,
        choiceObj: choiceObj,
        choiceIndex: cIdx,
      });
    });
  });

  if (choicesToMake.length === 0) {
    if (callback) callback();
    return;
  }

  promptForChoices(characterRecord, choicesToMake, 0, callback);
}

/**
 * Helper: adds a choice feature to the character's features list.
 * For options-based choices, adds the full feature data (modifiers, abilities, etc.).
 * For query-based choices, adds a simple tracking feature.
 *
 * @param {Object|string} selectedOption - Full option object (options-based) or label string (query-based)
 * @param {string} sourceName - Source name for tracking/cleanup
 * @param {number} featureLevel - Level of the parent feature
 * @param {Object} characterRecord - The character record (for ability processing)
 * @param {Function} callback - Called when done
 */
function addChoiceFeature(
  selectedOption,
  sourceName,
  featureLevel,
  characterRecord,
  callback,
) {
  if (typeof selectedOption === "string") {
    // Query-based: just add a tracking label
    safeAddValue(
      "data.features",
      {
        name: selectedOption,
        recordType: "feats",
        data: {
          source: sourceName,
          featureType: "choice",
          level: featureLevel || 1,
          icon: "IconRosetteDiscountCheck",
        },
      },
      () => {
        if (callback) callback();
      },
      characterRecord,
    );
    return;
  }

  // Options-based: add the full feature with all its data
  const featureName =
    selectedOption?.name || selectedOption?.data?.name || "Choice";
  const featureToAdd = {
    name: featureName,
    portrait: selectedOption?.portrait || undefined,
    recordType: "feats",
    data: {
      ...selectedOption?.data,
      source: sourceName,
      featureType: "choice",
      level: featureLevel || 1,
    },
  };

  safeAddValue(
    "data.features",
    featureToAdd,
    (updatedRecord) => {
      const rec = updatedRecord || characterRecord;
      const fieldsToSet = {};
      const { needsHpRecalc } = applyOneTimeModifiers(
        featureToAdd,
        fieldsToSet,
        rec,
      );

      // Recalc attribute bonuses from all features + equipped items
      recalcAttributeBonuses(fieldsToSet, rec);

      if (needsHpRecalc) recalcHitPoints(rec);

      // Apply provided items, then slug features, then process ability groups
      applyProvidesItems(featureToAdd, rec, () => {
        const slug = (featureToAdd?.data?.addsFeatsWithSlug || "").trim();
        const afterSlug = () => {
          const abilityGroupName = selectedOption?.data?.abilityGroupName || "";
          const afterAbilityGroup = () => {
            const pending = extractAllPending(fieldsToSet);
            const afterSetValues = () => {
              const done = () => {
                promptAbilityScoreIncrease(featureToAdd, rec, () => {
                  recalcACAndHP(rec, () => {
                    if (callback) callback();
                  });
                });
              };
              if (hasAnyPending(pending)) {
                applyAllPending(pending, rec, done);
              } else {
                done();
              }
            };
            if (Object.keys(fieldsToSet).length > 0) {
              api.setValues(fieldsToSet, afterSetValues);
            } else {
              afterSetValues();
            }
          };
          if (abilityGroupName !== "") {
            _processChoiceAbility(featureToAdd, rec, afterAbilityGroup);
          } else {
            afterAbilityGroup();
          }
        };
        if (slug) {
          const source = sourceName || featureToAdd?.name || "Feature";
          addFeatsWithSlug(slug, source, rec, afterSlug);
        } else {
          afterSlug();
        }
      });
    },
    characterRecord,
  );
}

/**
 * Processes ability group creation for a choice feature.
 * Replicates the logic from updateAbilitiesFromFeature() in character-main.html.
 */
function _processChoiceAbility(feature, characterRecord, callback) {
  const abilityGroupName = feature?.data?.abilityGroupName || "";
  let abilityUsesPerDay = feature?.data?.maxDailyUses || 0;
  if ((feature?.data?.fieldsToAddToUses || []).length > 0) {
    abilityUsesPerDay = getTotalValueFromFields(
      characterRecord,
      feature?.data?.fieldsToAddToUses || [],
      undefined,
      abilityGroupName,
    );
  }
  const abilityValue = feature?.data?.value || "";
  const abilityRestoresOn = feature?.data?.restoreOn || "";
  const savingThrowAbility = feature?.data?.savingThrowAbility || "";
  const altSavingThrowAbility = feature?.data?.altSavingThrowAbility || "";

  // Fetch fresh record to avoid stale group checks when multiple features
  // with the same abilityGroupName are added sequentially
  const charRecType = characterRecord?.recordType || "characters";
  const charRecId = characterRecord?._id;
  api.getRecord(charRecType, charRecId, (freshRec) => {
    const existingGroup = freshRec?.data?.abilityGroups?.find(
      (ag) => ag?.name === abilityGroupName,
    );

    const abilityAddedCallback = (updatedRec) => {
      const abilityGroupIndex = updatedRec?.data?.abilityGroups?.findIndex(
        (ag) => ag?.name === abilityGroupName,
      );
      if (abilityGroupIndex === -1) {
        if (callback) callback();
        return;
      }

      // After ability is added (or skipped), set group fields then call callback
      const afterAbilityAdded = (latestRec) => {
        const fieldsToSet = {};
        if (abilityUsesPerDay > 0) {
          const curDailyUses =
            latestRec.data?.abilityGroups?.[abilityGroupIndex]?.data
              ?.maxDailyUses || 0;
          if (curDailyUses < abilityUsesPerDay) {
            fieldsToSet[
              `data.abilityGroups.${abilityGroupIndex}.data.maxDailyUses`
            ] = abilityUsesPerDay;
          }
          if (abilityValue) {
            fieldsToSet[`data.abilityGroups.${abilityGroupIndex}.data.value`] =
              abilityValue;
          }
          if (abilityRestoresOn !== "") {
            fieldsToSet[
              `data.abilityGroups.${abilityGroupIndex}.data.restore`
            ] = abilityRestoresOn;
          }
          fieldsToSet[
            `data.abilityGroups.${abilityGroupIndex}.fields.dailyUses.hidden`
          ] = false;
        }
        if (Object.keys(fieldsToSet).length > 0) {
          api.setValues(fieldsToSet, () => {
            if (callback) callback();
          });
        } else {
          if (callback) callback();
        }
      };

      const abilityIdToAdd =
        JSON.parse(feature?.data?.ability || "{}")?._id || "";
      if (abilityIdToAdd !== "") {
        api.getRecord("abilities", abilityIdToAdd, (abilityRecord) => {
          // Skip if this ability is already in the group (by name + type)
          const existingAbilities =
            updatedRec?.data?.abilityGroups?.[abilityGroupIndex]?.data
              ?.abilities || [];
          const alreadyExists = existingAbilities.some(
            (a) =>
              a?.name === abilityRecord?.name &&
              a?.data?.type === abilityRecord?.data?.type,
          );
          if (alreadyExists) {
            afterAbilityAdded(updatedRec);
            return;
          }
          safeAddValue(
            `data.abilityGroups.${abilityGroupIndex}.data.abilities`,
            abilityRecord,
            afterAbilityAdded,
            characterRecord,
          );
        });
      } else {
        afterAbilityAdded(updatedRec);
      }
    };

    if (!existingGroup) {
      safeAddValue(
        "data.abilityGroups",
        {
          name: abilityGroupName,
          data: {
            abilities: [],
            maxDailyUses: abilityUsesPerDay,
            value: abilityValue,
            restore: abilityRestoresOn,
            savingThrowAbility: savingThrowAbility,
            altSavingThrowAbility: altSavingThrowAbility,
            fieldsToAddToUses: feature?.data?.fieldsToAddToUses || [],
          },
        },
        abilityAddedCallback,
        freshRec,
      );
    } else {
      abilityAddedCallback(freshRec);
    }
  }); // end api.getRecord
}

/**
 * Helper: stores the selected choice on the source record and continues.
 */
function storeChoiceAndContinue(
  choice,
  selectionData,
  characterRecord,
  choicesToMake,
  index,
  callback,
  depth,
) {
  const valuesToSet = {};
  const setPath = `${choice.dataPath}.data.choices.${choice.choiceIndex}.data.selectedChoices`;
  valuesToSet[setPath] = [selectionData];
  api.setValues(valuesToSet, (recAfterStore) => {
    api.getRecord("characters", characterRecord._id, (freshRecord) => {
      promptForChoices(freshRecord, choicesToMake, index + 1, callback, depth);
    });
  });
}

/**
 * Recursively prompts the user for each pending choice.
 * After a selection is made:
 * - Options-based: adds a one-off feature "{label} (Choice for '{featureName}')"
 * - Query-based (feats): adds the feat via api.dropRecord and a one-off feature
 * - Query-based (abilities): adds ability to a group named after the feature, and a one-off feature
 *
 * @param {Object} characterRecord - The character record
 * @param {Array} choicesToMake - Array of pending choice objects
 * @param {number} index - Current index in choicesToMake
 * @param {Function} callback - Called when all choices are resolved
 * @param {number} depth - Recursion depth (max 10)
 */
function promptForChoices(
  characterRecord,
  choicesToMake,
  index,
  callback,
  depth,
) {
  var MAX_CHOICE_DEPTH = 10;
  depth = depth || 0;

  if (index >= choicesToMake.length || depth >= MAX_CHOICE_DEPTH) {
    if (callback) callback();
    return;
  }

  var choice = choicesToMake[index];
  var choiceObj = choice.choiceObj;
  var featureName = choice.featureName || "Feature";
  var featureLevel = parseInt(choice.feature?.data?.level || "1", 10);
  var sourceName = choice.sourceName || "Feature";
  var promptName = choiceObj?.name || choiceObj?.data?.name || "Make a Choice";
  var promptDescription = choiceObj?.data?.description || "";
  var query = choiceObj?.data?.query || "";
  var options = choiceObj?.data?.options || [];
  var choiceType = choiceObj?.data?.choiceType || "";
  var choiceCount = parseInt(choiceObj?.data?.count || "1", 10) || 1;

  // ── Built-in choice types (skillProficiency, skillSpecialty, toolProficiency) ──
  if (choiceType === "skillProficiency" || choiceType === "skillSpecialty") {
    var allSkills = [
      { label: "Acrobatics", value: "acrobatics" },
      { label: "Animal Handling", value: "animalHandling" },
      { label: "Arcana", value: "arcana" },
      { label: "Athletics", value: "athletics" },
      { label: "Deception", value: "deception" },
      { label: "History", value: "history" },
      { label: "Insight", value: "insight" },
      { label: "Intimidation", value: "intimidation" },
      { label: "Investigation", value: "investigation" },
      { label: "Medicine", value: "medicine" },
      { label: "Nature", value: "nature" },
      { label: "Perception", value: "perception" },
      { label: "Performance", value: "performance" },
      { label: "Persuasion", value: "persuasion" },
      { label: "Religion", value: "religion" },
      { label: "Sleight of Hand", value: "sleightOfHand" },
      { label: "Stealth", value: "stealth" },
      { label: "Survival", value: "survival" },
    ];

    // If we're prompting for Skill Specialities, we need to duplicate the list
    // based on number of choices, because you can choose the same 1 more than once
    if (choiceType === "skillSpecialty" && choiceCount > 1) {
      const allSkillsCopy = [...allSkills];
      var newAllSkills = [];
      allSkillsCopy.forEach((skill) => {
        for (var ii = 0; ii < choiceCount; ii++) {
          const count = ii + 1;
          const newSkillChoice = {
            label: skill.label,
            value: `${skill.value}-${count}`,
          };
          newAllSkills.push(newSkillChoice);
        }
      });
      allSkills = newAllSkills;
    }

    // Filter to only skills listed in restrictTo if provided.
    // Supports both array and comma-separated string formats.
    var restrictToRaw = choiceObj?.data?.restrictTo || [];
    var restrictTo =
      typeof restrictToRaw === "string"
        ? restrictToRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s;
            })
        : restrictToRaw;
    if (restrictTo.length > 0) {
      // Match against both camelCase value and display label (e.g., "Sleight of Hand" or "sleightOfHand")
      var restrictSet = restrictTo.map(function (s) {
        return s.toLowerCase();
      });
      allSkills = allSkills.filter(function (s) {
        return (
          restrictSet.includes(s.value.toLowerCase()) ||
          restrictSet.includes(s.label.toLowerCase())
        );
      });
    }

    // For skillProficiency, filter out skills the character already has proficiency in
    if (choiceType === "skillProficiency") {
      allSkills = allSkills.filter(function (s) {
        var currentProf = characterRecord?.data?.[s.value + "Prof"] || "false";
        return currentProf !== "true" && currentProf !== "expertise";
      });
      // If no unproficient skills remain, skip this prompt entirely
      if (allSkills.length === 0) {
        storeChoiceAndContinue(
          choice,
          JSON.stringify({ name: "(no eligible skills)" }),
          characterRecord,
          choicesToMake,
          index,
          callback,
          depth,
        );
        return;
      }
    }

    var onSkillSelection = function (selectedValues) {
      if (!selectedValues || selectedValues.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }
      // Normalize selection to array of skill values
      var selections = Array.isArray(selectedValues)
        ? selectedValues
        : [selectedValues];
      var skillValues = selections.map(function (raw) {
        return typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      });

      var fieldsToSet = {};
      var rec = characterRecord;

      if (choiceType === "skillProficiency") {
        // Grant proficiency for each selected skill
        skillValues.forEach(function (skillField) {
          var currentProf = rec?.data?.[skillField + "Prof"] || "false";
          if (currentProf !== "true") {
            fieldsToSet["data." + skillField + "Prof"] = "true";
            var skillAbility =
              rec?.data?.[skillField + "Ability"] ||
              getAbilityFromSkill(skillField);
            var abilityMod = parseInt(
              rec?.data?.[skillAbility + "Mod"] || "0",
              10,
            );
            var profBonus = Math.max(
              parseInt(rec?.data?.proficiencyBonus || "0", 10),
              2,
            );
            fieldsToSet["data." + skillField + "Mod"] = abilityMod + profBonus;
          }
        });
      } else if (choiceType === "skillSpecialty") {
        // Add skill specialty entries
        var specialtyName = choiceObj?.data?.specialtyName || "";
        var currentSpecialties = [...(rec?.data?.skillSpecialties || [])];
        skillValues.forEach(function (skillField) {
          // Strip any -number values from skillSpecialty
          skillField = skillField.split("-")[0];
          // We always add chosen skill specialities, because you can have more than 1 in the same skill
          var boxFields = {};
          allSkills.forEach(function (s) {
            const skillMinusCount = s.value.split("-")[0];
            boxFields["box_" + skillMinusCount] = {
              hidden: skillMinusCount !== skillField,
            };
          });
          currentSpecialties.push({
            _id: generateId(),
            name: "Specialty",
            unidentifiedName: "Specialty",
            recordType: "records",
            identified: true,
            data: {
              skill: skillField,
              specialty: specialtyName,
              active: false,
            },
            fields: boxFields,
          });
        });
        fieldsToSet["data.skillSpecialties"] = currentSpecialties;
      }

      // Store selection and add a tracking feature
      var selectionLabel = skillValues
        .map(function (v) {
          var match = allSkills.find(function (s) {
            return s.value === v;
          });
          return match ? match.label : capitalize(v);
        })
        .join(", ");
      var selectionData = JSON.stringify({ name: selectionLabel });

      var afterFieldsSet = function () {
        storeChoiceAndContinue(
          choice,
          selectionData,
          characterRecord,
          choicesToMake,
          index,
          callback,
          depth,
        );
      };

      if (Object.keys(fieldsToSet).length > 0) {
        api.setValues(fieldsToSet, afterFieldsSet);
      } else {
        afterFieldsSet();
      }
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      allSkills,
      null,
      onSkillSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
    return;
  }

  // ── Built-in choice type: skillExpertise / skillOrToolExpertise ──
  // Prompts for a proficient skill (or skill/tool), then creates a one-off feature with an expertiseDie modifier.
  if (
    choiceType === "skillExpertise" ||
    choiceType === "skillOrToolExpertise"
  ) {
    var expertiseSkills = [
      { label: "Acrobatics", value: "acrobatics" },
      { label: "Animal Handling", value: "animalHandling" },
      { label: "Arcana", value: "arcana" },
      { label: "Athletics", value: "athletics" },
      { label: "Deception", value: "deception" },
      { label: "History", value: "history" },
      { label: "Insight", value: "insight" },
      { label: "Intimidation", value: "intimidation" },
      { label: "Investigation", value: "investigation" },
      { label: "Medicine", value: "medicine" },
      { label: "Nature", value: "nature" },
      { label: "Perception", value: "perception" },
      { label: "Performance", value: "performance" },
      { label: "Persuasion", value: "persuasion" },
      { label: "Religion", value: "religion" },
      { label: "Sleight of Hand", value: "sleightOfHand" },
      { label: "Stealth", value: "stealth" },
      { label: "Survival", value: "survival" },
    ];

    // restrictTo: limit which skills are eligible. Use "any tool" / "any skill"
    // as catch-alls; otherwise list specific skill/tool names.
    // E.g. "Acrobatics, Athletics, Investigation, Perception, Stealth, any tool".
    var restrictToExpertiseRaw = choiceObj?.data?.restrictTo || [];
    var restrictToExpertise =
      typeof restrictToExpertiseRaw === "string"
        ? restrictToExpertiseRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s;
            })
        : restrictToExpertiseRaw;
    var restrictSetExpertise = restrictToExpertise.map(function (s) {
      return s.toLowerCase();
    });
    var allowAnyTool = restrictSetExpertise.includes("any tool");
    var allowAnySkill = restrictSetExpertise.includes("any skill");
    var hasSpecificSkillRestriction =
      restrictToExpertise.length > 0 && !allowAnySkill;

    // Apply restrictTo if present — proficiency is NOT required to take expertise.
    expertiseSkills = expertiseSkills.filter(function (s) {
      if (!hasSpecificSkillRestriction) return true;
      return (
        restrictSetExpertise.includes(s.value.toLowerCase()) ||
        restrictSetExpertise.includes(s.label.toLowerCase())
      );
    });

    // skillOrToolExpertise: also include tools (the player's own otherSkills
    // entries plus, when relevant, the full tool catalog so they can pick
    // tools they aren't yet proficient in).
    if (choiceType === "skillOrToolExpertise") {
      var addToolEntry = function (name) {
        if (!name) return;
        var camel = name.toLowerCase().replace(/\s+(.)/g, function (_m, c) {
          return c.toUpperCase();
        });
        if (
          !expertiseSkills.some(function (es) {
            return es.value === camel;
          })
        ) {
          expertiseSkills.push({ label: name, value: camel });
        }
      };

      // 1) Player's existing tool/other-skill entries — included whenever
      //    restrictTo is unset or `any tool` / the tool name is allowed.
      var otherSkills = characterRecord?.data?.otherSkills || [];
      otherSkills.forEach(function (s) {
        var name = s?.name;
        if (!name) return;
        if (restrictToExpertise.length > 0 && !allowAnyTool) {
          if (!restrictSetExpertise.includes(name.toLowerCase())) return;
        }
        addToolEntry(name);
      });

      // 2) Full tool catalog — include any tools the player isn't already
      //    proficient in so they can take expertise without prerequisites.
      //    With `any tool` we include the whole catalog; otherwise only the
      //    tool names that appear in restrictTo.
      ALL_KNOWN_TOOLS.forEach(function (toolName) {
        if (restrictToExpertise.length === 0 || allowAnyTool) {
          addToolEntry(toolName);
        } else if (restrictSetExpertise.includes(toolName.toLowerCase())) {
          addToolEntry(toolName);
        }
      });
    }

    if (expertiseSkills.length === 0) {
      storeChoiceAndContinue(
        choice,
        JSON.stringify({ name: "(no proficient skills)" }),
        characterRecord,
        choicesToMake,
        index,
        callback,
        depth,
      );
      return;
    }

    var onSkillExpertiseSelection = function (selectedValues) {
      if (!selectedValues || selectedValues.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }
      var selections = Array.isArray(selectedValues)
        ? selectedValues
        : [selectedValues];
      var skillValues = selections.map(function (raw) {
        return typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      });

      // Build label for the choice feature
      var selectionLabel = skillValues
        .map(function (v) {
          var match = expertiseSkills.find(function (s) {
            return s.value === v;
          });
          return match ? match.label : capitalize(v);
        })
        .join(", ");

      // Create a one-off feature for each selected skill with an expertiseDie modifier
      var featurePortrait = choice.feature?.portrait || "";
      var idx = 0;
      var addNextExpertiseFeature = function () {
        if (idx >= skillValues.length) {
          storeChoiceAndContinue(
            choice,
            JSON.stringify({ name: selectionLabel }),
            characterRecord,
            choicesToMake,
            index,
            callback,
            depth,
          );
          return;
        }
        var skillField = skillValues[idx];
        var skillLabel = expertiseSkills.find(function (s) {
          return s.value === skillField;
        });
        var displayName = skillLabel
          ? skillLabel.label
          : capitalize(skillField);
        idx++;
        safeAddValue(
          "data.features",
          {
            name: displayName + " (Choice for " + featureName + ")",
            portrait: featurePortrait,
            recordType: "feats",
            data: {
              source: sourceName,
              type: "feature",
              featureType: "choice",
              prerequisites: "Bard",
              level: featureLevel || 1,
              description: displayName + ", chosen from " + featureName + ".",
              modifiers: [
                {
                  _id: generateId(),
                  name: "Modifier",
                  data: {
                    type: "expertiseDie",
                    field: skillField,
                    valueType: "string",
                    active: true,
                    value: "1d4",
                  },
                },
              ],
            },
          },
          addNextExpertiseFeature,
          characterRecord,
        );
      };
      addNextExpertiseFeature();
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      expertiseSkills,
      null,
      onSkillExpertiseSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
    return;
  }

  // ── Built-in choice type: toolProficiency ──
  if (choiceType === "toolProficiency") {
    var allTools = [
      { label: "Alchemist's Supplies", value: "Alchemist's Supplies" },
      { label: "Brewer's Supplies", value: "Brewer's Supplies" },
      { label: "Calligrapher's Supplies", value: "Calligrapher's Supplies" },
      { label: "Carpenter's Tools", value: "Carpenter's Tools" },
      { label: "Cartographer's Tools", value: "Cartographer's Tools" },
      { label: "Cobbler's Tools", value: "Cobbler's Tools" },
      { label: "Cook's Utensils", value: "Cook's Utensils" },
      { label: "Disguise Kit", value: "Disguise Kit" },
      { label: "Forgery Kit", value: "Forgery Kit" },
      { label: "Gaming Set", value: "Gaming Set" },
      { label: "Glassblower's Tools", value: "Glassblower's Tools" },
      { label: "Herbalism Kit", value: "Herbalism Kit" },
      { label: "Jeweler's Tools", value: "Jeweler's Tools" },
      { label: "Leatherworker's Tools", value: "Leatherworker's Tools" },
      { label: "Mason's Tools", value: "Mason's Tools" },
      { label: "Musical Instrument", value: "Musical Instrument" },
      { label: "Navigator's Tools", value: "Navigator's Tools" },
      { label: "Painter's Supplies", value: "Painter's Supplies" },
      { label: "Poisoner's Kit", value: "Poisoner's Kit" },
      { label: "Potter's Tools", value: "Potter's Tools" },
      { label: "Smith's Tools", value: "Smith's Tools" },
      { label: "Thieves' Tools", value: "Thieves' Tools" },
      { label: "Tinker's Tools", value: "Tinker's Tools" },
      { label: "Vehicles (Land)", value: "Vehicles (Land)" },
      { label: "Vehicles (Water)", value: "Vehicles (Water)" },
      { label: "Weaver's Tools", value: "Weaver's Tools" },
      { label: "Woodcarver's Tools", value: "Woodcarver's Tools" },
    ];

    // Filter to specific tools if restrictTo is provided.
    // Supports both array and comma-separated string formats.
    var restrictToToolsRaw = choiceObj?.data?.restrictTo || [];
    var restrictToTools =
      typeof restrictToToolsRaw === "string"
        ? restrictToToolsRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s;
            })
        : restrictToToolsRaw;
    if (restrictToTools.length > 0) {
      var restrictSetTools = restrictToTools.map(function (s) {
        return s.toLowerCase();
      });
      allTools = allTools.filter(function (t) {
        return (
          restrictSetTools.includes(t.value.toLowerCase()) ||
          restrictSetTools.includes(t.label.toLowerCase())
        );
      });
    }

    var onToolSelection = function (selectedValues) {
      if (!selectedValues || selectedValues.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }
      var selections = Array.isArray(selectedValues)
        ? selectedValues
        : [selectedValues];
      var toolValues = selections.map(function (raw) {
        return typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      });

      var selectionLabel = toolValues.join(", ");
      var selectionData = JSON.stringify({ name: selectionLabel });

      // Chain tool proficiency adds sequentially, then store choice
      var toolIdx = 0;
      var addNextTool = function () {
        if (toolIdx >= toolValues.length) {
          storeChoiceAndContinue(
            choice,
            selectionData,
            characterRecord,
            choicesToMake,
            index,
            callback,
            depth,
          );
          return;
        }
        addToolProficiency(toolValues[toolIdx++], characterRecord, addNextTool);
      };
      addNextTool();
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      allTools,
      null,
      onToolSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
    return;
  }

  // ── Built-in choice type: martialWeaponProficiency ──
  if (choiceType === "martialWeaponProficiency") {
    var allMartialWeapons = [
      // Martial Melee Weapons
      { label: "Brass Knuckles", value: "Brass Knuckles" },
      { label: "Dueling Dagger", value: "Dueling Dagger" },
      { label: "Light Hammer", value: "Light Hammer" },
      { label: "Punching Dagger", value: "Punching Dagger" },
      { label: "Throwing Dagger", value: "Throwing Dagger" },
      { label: "Whip", value: "Whip" },
      { label: "Javelin", value: "Javelin" },
      { label: "Scimitar", value: "Scimitar" },
      { label: "Shortsword", value: "Shortsword" },
      { label: "Trident", value: "Trident" },
      { label: "Bastard Sword", value: "Bastard Sword" },
      { label: "Battleaxe", value: "Battleaxe" },
      { label: "Flail", value: "Flail" },
      { label: "Longsword", value: "Longsword" },
      { label: "Morningstar", value: "Morningstar" },
      { label: "Rapier", value: "Rapier" },
      { label: "Saber", value: "Saber" },
      { label: "Warhammer", value: "Warhammer" },
      { label: "Warpick", value: "Warpick" },
      { label: "Glaive", value: "Glaive" },
      { label: "Halberd", value: "Halberd" },
      { label: "Pike", value: "Pike" },
      { label: "Scythe", value: "Scythe" },
      { label: "Greataxe", value: "Greataxe" },
      { label: "Greatsword", value: "Greatsword" },
      { label: "Maul", value: "Maul" },
      // Martial Ranged Weapons
      { label: "Dart", value: "Dart" },
      { label: "Hand Crossbow", value: "Hand Crossbow" },
      { label: "Shortbow", value: "Shortbow" },
      { label: "Composite Bow", value: "Composite Bow" },
      { label: "Longbow", value: "Longbow" },
      // Miscellaneous Martial Weapons
      { label: "Garrotte", value: "Garrotte" },
      { label: "Lance", value: "Lance" },
      { label: "Net", value: "Net" },
      { label: "Spear-thrower", value: "Spear-thrower" },
    ];

    // Filter to specific weapons if restrictTo is provided
    var restrictToWeaponsRaw = choiceObj?.data?.restrictTo || [];
    var restrictToWeapons =
      typeof restrictToWeaponsRaw === "string"
        ? restrictToWeaponsRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s;
            })
        : restrictToWeaponsRaw;
    if (restrictToWeapons.length > 0) {
      var restrictSetWeapons = restrictToWeapons.map(function (s) {
        return s.toLowerCase();
      });
      allMartialWeapons = allMartialWeapons.filter(function (w) {
        return (
          restrictSetWeapons.includes(w.value.toLowerCase()) ||
          restrictSetWeapons.includes(w.label.toLowerCase())
        );
      });
    }

    // Filter out weapons the character already has proficiency with
    var currentWeaponProfs = (
      characterRecord?.data?.weaponProficiencies || ""
    ).toLowerCase();
    allMartialWeapons = allMartialWeapons.filter(function (w) {
      return !currentWeaponProfs.includes(w.value.toLowerCase());
    });

    var onWeaponSelection = function (selectedValues) {
      if (!selectedValues || selectedValues.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }
      var selections = Array.isArray(selectedValues)
        ? selectedValues
        : [selectedValues];
      var weaponValues = selections.map(function (raw) {
        return typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      });

      var selectionLabel = weaponValues.join(", ");
      var selectionData = JSON.stringify({ name: selectionLabel });

      // Add each weapon to the proficiencies string
      api.getRecord("characters", characterRecord._id, function (rec) {
        var current = rec?.data?.weaponProficiencies || "";
        var updated = current;
        weaponValues.forEach(function (weapon) {
          updated = mergeWeaponProficiencies(updated, weapon);
        });
        api.setValues({ "data.weaponProficiencies": updated }, function () {
          storeChoiceAndContinue(
            choice,
            selectionData,
            characterRecord,
            choicesToMake,
            index,
            callback,
            depth,
          );
        });
      });
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      allMartialWeapons,
      null,
      onWeaponSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
    return;
  }

  // ── Built-in choice type: skillOrToolProficiency ──
  if (choiceType === "skillOrToolProficiency") {
    var combinedOptions = [
      { label: "Acrobatics", value: "skill:acrobatics" },
      { label: "Animal Handling", value: "skill:animalHandling" },
      { label: "Arcana", value: "skill:arcana" },
      { label: "Athletics", value: "skill:athletics" },
      { label: "Deception", value: "skill:deception" },
      { label: "History", value: "skill:history" },
      { label: "Insight", value: "skill:insight" },
      { label: "Intimidation", value: "skill:intimidation" },
      { label: "Investigation", value: "skill:investigation" },
      { label: "Medicine", value: "skill:medicine" },
      { label: "Nature", value: "skill:nature" },
      { label: "Perception", value: "skill:perception" },
      { label: "Performance", value: "skill:performance" },
      { label: "Persuasion", value: "skill:persuasion" },
      { label: "Religion", value: "skill:religion" },
      { label: "Sleight of Hand", value: "skill:sleightOfHand" },
      { label: "Stealth", value: "skill:stealth" },
      { label: "Survival", value: "skill:survival" },
      { label: "Alchemist's Supplies", value: "tool:Alchemist's Supplies" },
      { label: "Brewer's Supplies", value: "tool:Brewer's Supplies" },
      {
        label: "Calligrapher's Supplies",
        value: "tool:Calligrapher's Supplies",
      },
      { label: "Carpenter's Tools", value: "tool:Carpenter's Tools" },
      { label: "Cartographer's Tools", value: "tool:Cartographer's Tools" },
      { label: "Cobbler's Tools", value: "tool:Cobbler's Tools" },
      { label: "Cook's Utensils", value: "tool:Cook's Utensils" },
      { label: "Disguise Kit", value: "tool:Disguise Kit" },
      { label: "Forgery Kit", value: "tool:Forgery Kit" },
      { label: "Gaming Set", value: "tool:Gaming Set" },
      { label: "Glassblower's Tools", value: "tool:Glassblower's Tools" },
      { label: "Herbalism Kit", value: "tool:Herbalism Kit" },
      { label: "Jeweler's Tools", value: "tool:Jeweler's Tools" },
      { label: "Leatherworker's Tools", value: "tool:Leatherworker's Tools" },
      { label: "Mason's Tools", value: "tool:Mason's Tools" },
      { label: "Musical Instrument", value: "tool:Musical Instrument" },
      { label: "Navigator's Tools", value: "tool:Navigator's Tools" },
      { label: "Painter's Supplies", value: "tool:Painter's Supplies" },
      { label: "Poisoner's Kit", value: "tool:Poisoner's Kit" },
      { label: "Potter's Tools", value: "tool:Potter's Tools" },
      { label: "Smith's Tools", value: "tool:Smith's Tools" },
      { label: "Thieves' Tools", value: "tool:Thieves' Tools" },
      { label: "Tinker's Tools", value: "tool:Tinker's Tools" },
      { label: "Vehicles (Land)", value: "tool:Vehicles (Land)" },
      { label: "Vehicles (Water)", value: "tool:Vehicles (Water)" },
      { label: "Weaver's Tools", value: "tool:Weaver's Tools" },
      { label: "Woodcarver's Tools", value: "tool:Woodcarver's Tools" },
    ];

    // Filter to restrictTo if provided
    var restrictToComboRaw = choiceObj?.data?.restrictTo || [];
    var restrictToCombo =
      typeof restrictToComboRaw === "string"
        ? restrictToComboRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s;
            })
        : restrictToComboRaw;
    if (restrictToCombo.length > 0) {
      var restrictSetCombo = restrictToCombo.map(function (s) {
        return s.toLowerCase();
      });
      combinedOptions = combinedOptions.filter(function (o) {
        var rawVal = o.value.replace(/^(skill|tool):/, "");
        return (
          restrictSetCombo.includes(rawVal.toLowerCase()) ||
          restrictSetCombo.includes(o.label.toLowerCase())
        );
      });
    }

    // Filter out skills the character already has proficiency in
    combinedOptions = combinedOptions.filter(function (o) {
      if (o.value.startsWith("skill:")) {
        var skillField = o.value.substring(6);
        var currentProf =
          characterRecord?.data?.[skillField + "Prof"] || "false";
        return currentProf !== "true" && currentProf !== "expertise";
      }
      return true;
    });

    if (combinedOptions.length === 0) {
      storeChoiceAndContinue(
        choice,
        JSON.stringify({ name: "(no eligible options)" }),
        characterRecord,
        choicesToMake,
        index,
        callback,
        depth,
      );
      return;
    }

    var onComboSelection = function (selectedValues) {
      if (!selectedValues || selectedValues.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }
      var selections = Array.isArray(selectedValues)
        ? selectedValues
        : [selectedValues];
      var rawValues = selections.map(function (raw) {
        return typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      });

      // Separate into skills and tools
      var skillSelections = [];
      var toolSelections = [];
      rawValues.forEach(function (v) {
        if (v.startsWith("skill:")) {
          skillSelections.push(v.substring(6));
        } else if (v.startsWith("tool:")) {
          toolSelections.push(v.substring(5));
        }
      });

      // Build label from display names
      var selectionLabels = rawValues.map(function (v) {
        var match = combinedOptions.find(function (o) {
          return o.value === v;
        });
        return match ? match.label : v;
      });
      var selectionLabel = selectionLabels.join(", ");
      var selectionData = JSON.stringify({ name: selectionLabel });

      // Apply skill proficiencies
      var fieldsToSet = {};
      var rec = characterRecord;
      skillSelections.forEach(function (skillField) {
        var currentProf = rec?.data?.[skillField + "Prof"] || "false";
        if (currentProf !== "true") {
          fieldsToSet["data." + skillField + "Prof"] = "true";
          var skillAbility =
            rec?.data?.[skillField + "Ability"] ||
            getAbilityFromSkill(skillField);
          var abilityMod = parseInt(
            rec?.data?.[skillAbility + "Mod"] || "0",
            10,
          );
          var profBonus = Math.max(
            parseInt(rec?.data?.proficiencyBonus || "0", 10),
            2,
          );
          fieldsToSet["data." + skillField + "Mod"] = abilityMod + profBonus;
        }
      });

      // Apply skill fields first, then chain tool proficiency adds
      var afterSkills = function () {
        if (toolSelections.length > 0) {
          var toolIdx = 0;
          var addNextTool = function () {
            if (toolIdx >= toolSelections.length) {
              storeChoiceAndContinue(
                choice,
                selectionData,
                characterRecord,
                choicesToMake,
                index,
                callback,
                depth,
              );
              return;
            }
            addToolProficiency(
              toolSelections[toolIdx++],
              characterRecord,
              addNextTool,
            );
          };
          addNextTool();
        } else {
          storeChoiceAndContinue(
            choice,
            selectionData,
            characterRecord,
            choicesToMake,
            index,
            callback,
            depth,
          );
        }
      };

      if (Object.keys(fieldsToSet).length > 0) {
        api.setValues(fieldsToSet, afterSkills);
      } else {
        afterSkills();
      }
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      combinedOptions,
      null,
      onComboSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
    return;
  }

  // ── Built-in choice type: languageChoice ──
  if (choiceType === "languageChoice") {
    var allLanguages = [
      { label: "Abyssal", value: "Abyssal" },
      { label: "Aquan", value: "Aquan" },
      { label: "Auran", value: "Auran" },
      { label: "Celestial", value: "Celestial" },
      { label: "Common", value: "Common" },
      { label: "Deep Speech", value: "Deep Speech" },
      { label: "Draconic", value: "Draconic" },
      { label: "Dwarvish", value: "Dwarvish" },
      { label: "Elvish", value: "Elvish" },
      { label: "Giant", value: "Giant" },
      { label: "Gnomish", value: "Gnomish" },
      { label: "Goblin", value: "Goblin" },
      { label: "Halfling", value: "Halfling" },
      { label: "Ignan", value: "Ignan" },
      { label: "Infernal", value: "Infernal" },
      { label: "Orc", value: "Orc" },
      { label: "Primordial", value: "Primordial" },
      { label: "Sylvan", value: "Sylvan" },
      { label: "Terran", value: "Terran" },
      { label: "Undercommon", value: "Undercommon" },
    ];

    var restrictToLangsRaw = choiceObj?.data?.restrictTo || [];
    var restrictToLangs =
      typeof restrictToLangsRaw === "string"
        ? restrictToLangsRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s;
            })
        : restrictToLangsRaw;
    if (restrictToLangs.length > 0) {
      var restrictSetLangs = restrictToLangs.map(function (s) {
        return s.toLowerCase();
      });
      allLanguages = allLanguages.filter(function (l) {
        return (
          restrictSetLangs.includes(l.value.toLowerCase()) ||
          restrictSetLangs.includes(l.label.toLowerCase())
        );
      });
    }

    var onLanguageSelection = function (selectedValues) {
      if (!selectedValues || selectedValues.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }
      var selections = Array.isArray(selectedValues)
        ? selectedValues
        : [selectedValues];
      var langValues = selections.map(function (raw) {
        return typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      });

      var selectionLabel = langValues.join(", ");
      var selectionData = JSON.stringify({ name: selectionLabel });

      // Merge each selected language into data.languages
      api.getRecord("characters", characterRecord._id, function (freshRec) {
        var current = freshRec?.data?.languages || "";
        langValues.forEach(function (lang) {
          current = mergeCommaSeparated(current, lang);
        });
        api.setValues({ "data.languages": current }, function () {
          storeChoiceAndContinue(
            choice,
            selectionData,
            characterRecord,
            choicesToMake,
            index,
            callback,
            depth,
          );
        });
      });
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      allLanguages,
      null,
      onLanguageSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
    return;
  }

  // ── Simple Choice: pick from a comma-separated list, adds a basic feature per pick ──
  if (choiceType === "simpleChoice") {
    var simpleOptions = (choiceObj?.data?.simpleChoiceOptions || "")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s !== "";
      });
    if (simpleOptions.length === 0) {
      promptForChoices(
        characterRecord,
        choicesToMake,
        index + 1,
        callback,
        depth,
      );
      return;
    }
    var simplePromptOptions = simpleOptions.map(function (opt) {
      return { label: opt, value: opt };
    });
    var actualCount = Math.min(choiceCount, simplePromptOptions.length);
    api.showPrompt(
      promptName || featureName,
      "Selection",
      promptDescription || "Make a choice.",
      simplePromptOptions,
      null,
      function (values) {
        if (!values || values.length === 0) {
          promptForChoices(
            characterRecord,
            choicesToMake,
            index + 1,
            callback,
            depth,
          );
          return;
        }
        // Mark this choice as answered
        var selectedLabels = values.map(function (v) {
          return v.value || v.label || v;
        });
        var choicePath =
          choice.dataPath + ".data.choices." + choice.choiceIndex;
        var markFields = {};
        markFields[choicePath + ".data.selectedChoices"] = selectedLabels;
        api.setValues(markFields, function () {
          // Add a feature for each selected option, chaining sequentially
          var addIdx = 0;
          var addNext = function () {
            if (addIdx >= selectedLabels.length) {
              api.getRecord(
                "characters",
                characterRecord._id,
                function (freshRecord) {
                  promptForChoices(
                    freshRecord,
                    choicesToMake,
                    index + 1,
                    callback,
                    depth,
                  );
                },
              );
              return;
            }
            var choiceLabel = selectedLabels[addIdx++];
            safeAddValue(
              "data.features",
              {
                name: choiceLabel + " (Choice for " + featureName + ")",
                recordType: "feats",
                identified: true,
                portrait: "/icons/fantasy/sundries/books/book-red-square.webp",
                data: {
                  source: sourceName,
                  type: "feature",
                  featureType: "choice",
                  level: featureLevel || 1,
                  description:
                    choiceLabel + ", chosen from " + featureName + ".",
                },
              },
              addNext,
              characterRecord,
            );
          };
          addNext();
        });
      },
      "OK",
      "Cancel",
      actualCount > 1 ? actualCount : undefined,
    );
    return;
  }

  // ── Free-type proficiency choices: player types weapon/armor names ──
  if (
    choiceType === "weaponProficiencyFreeType" ||
    choiceType === "armorProficiencyFreeType"
  ) {
    var isWeapon = choiceType === "weaponProficiencyFreeType";
    var profLabel = isWeapon ? "Weapon Proficiency" : "Armor Proficiency";
    var profField = isWeapon
      ? "data.weaponProficiencies"
      : "data.armorTraining";
    var remaining = choiceCount;

    var allEntries = [];
    var promptNext = function () {
      if (remaining <= 0) {
        // All entries collected — merge into proficiencies and store choice
        var selectionLabel = allEntries.join(", ");
        var selectionData = JSON.stringify({ name: selectionLabel });

        api.getRecord("characters", characterRecord._id, function (rec) {
          var current =
            rec?.data?.[isWeapon ? "weaponProficiencies" : "armorTraining"] ||
            "";
          var updated = current;
          var mergeFn = isWeapon
            ? mergeWeaponProficiencies
            : mergeCommaSeparated;
          allEntries.forEach(function (entry) {
            updated = mergeFn(updated, entry);
          });
          var fieldsToSet = {};
          fieldsToSet[profField] = updated;
          api.setValues(fieldsToSet, function () {
            storeChoiceAndContinue(
              choice,
              selectionData,
              characterRecord,
              choicesToMake,
              index,
              callback,
              depth,
            );
          });
        });
        return;
      }
      var countLabel =
        choiceCount > 1
          ? " (" + (choiceCount - remaining + 1) + " of " + choiceCount + ")"
          : "";
      api.showValuePrompt(
        (promptName || profLabel) + countLabel,
        promptDescription ||
          "Type the name of the " + profLabel.toLowerCase() + " to add.",
        function (value) {
          if (!value || value.trim() === "") {
            // User cancelled — still process what we have so far
            if (allEntries.length > 0) {
              remaining = 0;
              promptNext();
            } else {
              promptForChoices(
                characterRecord,
                choicesToMake,
                index + 1,
                callback,
                depth,
              );
            }
            return;
          }
          allEntries.push(value.trim());
          remaining--;
          // Async trampoline so the UI can close the previous prompt before showing the next
          api.getRecord("characters", characterRecord._id, function () {
            promptNext();
          });
        },
        "OK",
        "Cancel",
      );
    };
    promptNext();
    return;
  }

  // ── Free-type feature choice: player types a name, creates a one-off feature ──
  if (choiceType === "featureFreeType") {
    var remaining = choiceCount;
    var allEntries = [];
    var promptNextFeature = function () {
      if (remaining <= 0) {
        // All entries collected — store choice and add features
        var selectionLabel = allEntries.join(", ");
        var selectionData = JSON.stringify({ name: selectionLabel });

        var addIdx = 0;
        var addNext = function () {
          if (addIdx >= allEntries.length) {
            storeChoiceAndContinue(
              choice,
              selectionData,
              characterRecord,
              choicesToMake,
              index,
              callback,
              depth,
            );
            return;
          }
          var entryName = allEntries[addIdx++];
          safeAddValue(
            "data.features",
            {
              name: entryName + " (Choice for " + featureName + ")",
              recordType: "feats",
              identified: true,
              portrait: "/icons/fantasy/sundries/books/book-red-square.webp",
              data: {
                source: sourceName,
                type: "feature",
                featureType: "choice",
                level: featureLevel || 1,
                description: entryName + ", chosen from " + featureName + ".",
              },
            },
            addNext,
            characterRecord,
          );
        };
        addNext();
        return;
      }
      var countLabel =
        choiceCount > 1
          ? " (" + (choiceCount - remaining + 1) + " of " + choiceCount + ")"
          : "";
      api.showValuePrompt(
        (promptName || featureName) + countLabel,
        promptDescription || "Type the name of your choice.",
        function (value) {
          if (!value || value.trim() === "") {
            if (allEntries.length > 0) {
              remaining = 0;
              promptNextFeature();
            } else {
              promptForChoices(
                characterRecord,
                choicesToMake,
                index + 1,
                callback,
                depth,
              );
            }
            return;
          }
          allEntries.push(value.trim());
          remaining--;
          api.getRecord("characters", characterRecord._id, function () {
            promptNextFeature();
          });
        },
        "OK",
        "Cancel",
      );
    };
    promptNextFeature();
    return;
  }

  // ── Master a combat maneuver ──
  if (query) {
    // Query-based choice: use api.showPrompt with a query.
    // Substitute @record.data.X tokens against the character record so authors
    // can write level-aware queries like `"data.level": {"$lte": @record.data.level}`.
    // Also supports @ceil(record.data.X / N) and @floor(record.data.X / N) for
    // tier-style gates (e.g. sorcerer caster tier = ceil(sorcLevel / 2)).
    // We can't reuse checkForReplacements here — it interprets `{...}` blocks as
    // math expressions, which would mangle the JSON body itself.
    var resolveAtPath = function (path) {
      var resolved = characterRecord?.data;
      var segments = path.split(".");
      for (var si = 0; si < segments.length; si++) {
        resolved = resolved == null ? undefined : resolved[segments[si]];
      }
      return resolved;
    };
    var resolvedQuery = query
      .replace(
        /@(ceil|floor)\(\s*record\.data\.([\w.]+)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\)/g,
        function (_m, fn, path, divisor) {
          var raw = resolveAtPath(path);
          var n = Number(raw);
          var d = Number(divisor);
          if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) {
            return "null";
          }
          return JSON.stringify(
            fn === "ceil" ? Math.ceil(n / d) : Math.floor(n / d),
          );
        },
      )
      .replace(/@record\.data\.([\w.]+)/g, function (_m, path) {
        var resolved = resolveAtPath(path);
        return resolved === undefined || resolved === null
          ? "null"
          : JSON.stringify(resolved);
      });
    var queryObj;
    try {
      queryObj = JSON.parse(resolvedQuery);
    } catch (e) {
      promptForChoices(
        characterRecord,
        choicesToMake,
        index + 1,
        callback,
        depth,
      );
      return;
    }

    var queryType = queryObj?.type || "";

    // Process a single query-selected record, then call next() when done
    var processQueryRecord = function (selectedRecord, next) {
      var selectedName = selectedRecord?.name || "Selection";

      if (queryType === "feats") {
        addChoiceFeature(
          selectedRecord,
          sourceName,
          featureLevel,
          characterRecord,
          next,
        );
      } else if (queryType === "items") {
        addChoiceFeature(
          selectedName + " (" + featureName + ")",
          sourceName,
          featureLevel,
          characterRecord,
          function () {
            safeAddValue(
              "data.inventory",
              { ...selectedRecord, _id: generateId() },
              next,
              characterRecord,
            );
          },
        );
      } else if (queryType === "spells") {
        var spellLevel = selectedRecord?.data?.level || "Cantrip";
        var spellLevelNum =
          spellLevel === "Cantrip" || spellLevel === "0"
            ? 0
            : parseInt(spellLevel, 10) || 0;
        var spellPath =
          spellLevelNum === 0 ? "data.cantrips" : "data.spells" + spellLevelNum;
        var choiceAbility = choiceObj?.data?.spellcastingAbility || "";
        var spellAbility =
          choiceAbility && choiceAbility.startsWith("highest")
            ? resolveHighestAbility(characterRecord, choiceAbility)
            : choiceAbility || getCharacterSpellcastingAbility(characterRecord);
        var choiceSpellType = choiceObj?.data?.spellType || "";
        var spellData = { ...selectedRecord?.data, ability: spellAbility };
        if (choiceSpellType === "atwill") {
          spellData.prepared = "atwill";
        } else if (choiceSpellType === "daily") {
          spellData.prepared = "daily";
          spellData.maxDailyUses = spellData.maxDailyUses || 1;
          spellData.dailyUses = 0;
          spellData.restoreOnRest = spellData.restoreOnRest || "long";
        }
        var spellToAdd = {
          ...selectedRecord,
          _id: generateId(),
          data: spellData,
        };
        safeAddValue(
          spellPath,
          spellToAdd,
          function (updatedRecord) {
            var curMax = updatedRecord?.data?.maxSpellLevel || "";
            var curMaxNum =
              curMax === "Cantrip" ? 0 : parseInt(curMax, 10) || 0;
            var fieldsToSet = {};
            if (spellLevelNum > curMaxNum) {
              fieldsToSet["data.maxSpellLevel"] = "" + spellLevelNum;
              fieldsToSet["fields.cantripsOpen.hidden"] = false;
              for (var i = 1; i <= spellLevelNum; i++) {
                fieldsToSet["fields.level" + i + "spellsOpen.hidden"] = false;
              }
            } else if (spellLevelNum === 0 && !curMax) {
              fieldsToSet["data.maxSpellLevel"] = "Cantrip";
              fieldsToSet["fields.cantripsOpen.hidden"] = false;
            }
            // Unhide daily/atwill fields on the newly added spell
            if (choiceSpellType === "atwill" || choiceSpellType === "daily") {
              var spellList =
                spellLevelNum === 0
                  ? updatedRecord?.data?.cantrips
                  : updatedRecord?.data?.["spells" + spellLevelNum];
              var spellIdx = (spellList || []).length - 1;
              if (spellIdx >= 0) {
                var baseFPath = spellPath + "." + spellIdx + ".fields";
                fieldsToSet[baseFPath + ".saveDc.hidden"] = false;
                fieldsToSet[baseFPath + ".attackMod.hidden"] = false;
                if (choiceSpellType === "daily") {
                  fieldsToSet[baseFPath + ".maxDailyUses.hidden"] = false;
                  fieldsToSet[baseFPath + ".dailyUses.hidden"] = false;
                  fieldsToSet[baseFPath + ".restoreOnRest.hidden"] = false;
                }
              }
            }
            if (Object.keys(fieldsToSet).length > 0) {
              api.setValues(fieldsToSet, next);
            } else {
              next();
            }
          },
          characterRecord,
        );
      } else if (queryType === "abilities") {
        // Combat Maneuvers / Focus Feature Abilities default to the shared
        // "Combat Maneuvers" group. A choice can opt out by setting
        // `providesAbilitiesToOwnGroup: true` on the choice itself, which
        // routes the picked ability into the owning feature's
        // `abilityGroupName` instead (useful when that group has its own
        // uses-per-day pool).
        var isCombatManeuver =
          selectedRecord?.data?.type === "Combat Maneuver" ||
          selectedRecord?.data?.type === "Focus Feature Ability";
        var ownGroupName = (
          choice.feature?.data?.abilityGroupName || ""
        ).trim();
        var useOwnGroup =
          choiceObj?.data?.providesAbilitiesToOwnGroup === true &&
          !!ownGroupName;
        var abilityGroupName = useOwnGroup
          ? ownGroupName
          : isCombatManeuver
            ? "Combat Maneuvers"
            : ownGroupName || featureName;

        var addToGroup = function () {
          api.getRecord(
            characterRecord.recordType || "characters",
            characterRecord._id,
            function (freshRec) {
              var existingGroup = freshRec?.data?.abilityGroups?.find(
                function (ag) {
                  return ag?.name === abilityGroupName;
                },
              );
              if (!existingGroup) {
                safeAddValue(
                  "data.abilityGroups",
                  {
                    name: abilityGroupName,
                    data: { abilities: [] },
                  },
                  function (updatedRecord) {
                    var groupIdx =
                      updatedRecord?.data?.abilityGroups?.findIndex(
                        function (ag) {
                          return ag?.name === abilityGroupName;
                        },
                      );
                    if (groupIdx !== -1) {
                      safeAddValue(
                        "data.abilityGroups." + groupIdx + ".data.abilities",
                        { ...selectedRecord, _id: generateId() },
                        next,
                        characterRecord,
                      );
                    } else {
                      next();
                    }
                  },
                  characterRecord,
                );
              } else {
                var groupIdx = freshRec?.data?.abilityGroups?.findIndex(
                  function (ag) {
                    return ag?.name === abilityGroupName;
                  },
                );
                if (groupIdx !== -1) {
                  safeAddValue(
                    "data.abilityGroups." + groupIdx + ".data.abilities",
                    { ...selectedRecord, _id: generateId() },
                    next,
                    characterRecord,
                  );
                } else {
                  next();
                }
              }
            },
          );
        };

        // Skip the tracking feature for all ability picks — the ability itself
        // is added to its group, which is the only artifact we want.
        addToGroup();
      } else {
        next();
      }
    };

    var onQuerySelection = function (selectedValues) {
      if (selectedValues && selectedValues.length > 0) {
        // Build selectionData from all selected records
        var allSelections = selectedValues.map(function (rec) {
          return { _id: rec._id, name: rec?.name || "Selection" };
        });
        var selectionData = JSON.stringify(
          allSelections.length === 1 ? allSelections[0] : allSelections,
        );

        // Process each selected record sequentially
        var processIdx = 0;
        var processNext = function () {
          if (processIdx >= selectedValues.length) {
            storeChoiceAndContinue(
              choice,
              selectionData,
              characterRecord,
              choicesToMake,
              index,
              callback,
              depth,
            );
            return;
          }
          var rec = selectedValues[processIdx];
          processIdx++;
          processQueryRecord(rec, processNext);
        };
        processNext();
      } else {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
      }
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      null,
      queryObj,
      onQuerySelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
  } else if (options.length > 0) {
    // Options-based choice: use api.showPrompt with options list
    var promptOptions = options.map(function (opt) {
      return {
        label: opt?.name || opt?.data?.name || "Option",
        value: opt?._id || opt?.data?._id || opt?.name || opt?.data?.name,
      };
    });

    var resolveSelectedOption = function (raw) {
      var selectedId =
        typeof raw === "object" ? raw?.value || raw?.label || raw : raw;
      var selectedOption = options.find(function (opt) {
        return (
          (opt?._id || opt?.data?._id || opt?.name || opt?.data?.name) ===
          selectedId
        );
      });
      var selectedLabel =
        selectedOption?.name ||
        selectedOption?.data?.name ||
        (typeof raw === "object" ? raw?.label : null) ||
        selectedId;
      return {
        selectedId: selectedId,
        selectedLabel: selectedLabel,
        selectedOption: selectedOption,
      };
    };

    var onOptionSelection = function (selectedValue) {
      if (
        !selectedValue ||
        (Array.isArray(selectedValue) && selectedValue.length === 0)
      ) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }

      var rawSelections = Array.isArray(selectedValue)
        ? selectedValue
        : [selectedValue];
      var resolved = rawSelections
        .map(resolveSelectedOption)
        .filter(function (r) {
          return !!r.selectedOption;
        });

      if (resolved.length === 0) {
        promptForChoices(
          characterRecord,
          choicesToMake,
          index + 1,
          callback,
          depth,
        );
        return;
      }

      var allSelections = resolved.map(function (r) {
        return { _id: r.selectedId, name: r.selectedLabel };
      });
      var selectionData = JSON.stringify(
        allSelections.length === 1 ? allSelections[0] : allSelections,
      );

      var processIdx = 0;
      var processNext = function () {
        if (processIdx >= resolved.length) {
          storeChoiceAndContinue(
            choice,
            selectionData,
            characterRecord,
            choicesToMake,
            index,
            callback,
            depth,
          );
          return;
        }
        var entry = resolved[processIdx];
        processIdx++;
        addChoiceFeature(
          entry.selectedOption,
          sourceName,
          featureLevel,
          characterRecord,
          processNext,
        );
      };
      processNext();
    };

    api.showPrompt(
      promptName,
      "Selection",
      promptDescription,
      promptOptions,
      null,
      onOptionSelection,
      "OK",
      "Cancel",
      choiceCount > 1 ? choiceCount : undefined,
    );
  } else {
    promptForChoices(
      characterRecord,
      choicesToMake,
      index + 1,
      callback,
      depth,
    );
  }
}

// ─── Origin & Class Feature Processing ──────────────────────────────────────

// Parse total level from a class levels string like "Fighter 1 / Wizard 2"
function getTotalLevel(inputString) {
  const regex = /\d+/g;
  let totalLevel = 0;
  const levels = inputString.match(regex);
  if (levels) {
    levels.forEach((level) => {
      totalLevel += parseInt(level, 10);
    });
  }
  return totalLevel;
}

// Collect features from heritage/culture/background/destiny that match a specific level
// and aren't already on the character. Returns array of features to add.
function collectMissingOriginFeatures(totalLevel, recordOverride) {
  const rec = recordOverride || record;
  const existingFeatures = (rec?.data?.features || []).map(
    (f) => `${f?.data?.source}-${f.name}`,
  );

  const originSources = [
    ...(rec?.data?.backgrounds || []),
    ...(rec?.data?.species || []),
  ];

  const featuresToAdd = [];
  originSources.forEach((source) => {
    const sourceName = source?.name || "";
    const features = source?.data?.feature_list || [];
    features.forEach((feature) => {
      const featureLevel = parseInt(feature?.data?.level || "1", 10);
      if (featureLevel !== totalLevel) return;

      const featureKey = `${sourceName}-${feature.name}`;
      if (existingFeatures.includes(featureKey)) return;

      featuresToAdd.push({
        ...feature,
        data: {
          ...feature.data,
          source: sourceName,
          level: feature.data?.level || 1,
        },
      });
    });
  });

  return featuresToAdd;
}

// Add class and archetype features for a specific level.
// Returns { fieldsToSet, featuresToAdd, deferredAbilityGroups } — caller is responsible for
// batching featuresToAdd via api.addValues and applying fieldsToSet.
function addMissingClassFeatures(
  className,
  classObj,
  archetype,
  newLevel,
  classLevels,
  recordOverride,
) {
  const rec = recordOverride || record;
  const additionalFieldsToSet = {};
  const featuresToAdd = [];
  const deferredAbilityGroups = [];
  const curFeatures = (rec?.data?.features || []).map(
    (feature) => `${feature?.data?.source}-${feature.name}`,
  );
  const features = classObj?.data?.feature_list || [];
  const archetypeFeatures = archetype?.data?.feature_list || [];

  const abilityGroupsToAdd = new Set();

  const allFeatures = [...features, ...archetypeFeatures];

  // Keep track of features added this level in a set so we do not add duplicates
  const featuresAddedThisLevel = new Set();

  allFeatures.forEach((feature) => {
    const level = feature?.data?.level || 0;
    let featureAddedOrUpdated = false;
    // If this feature is at the level we're adding, add or update it
    if (level === newLevel) {
      const featureKey = `${className}-${feature.name}`;
      const existingFeature = curFeatures.find((f) => f === featureKey);

      if (
        !existingFeature &&
        !featuresAddedThisLevel.has(`${className}-${feature.name}`)
      ) {
        // Collect this feature for batch add
        featuresToAdd.push({
          ...feature,
          data: {
            ...feature.data,
            source: className,
          },
        });
        featureAddedOrUpdated = true;
        featuresAddedThisLevel.add(`${className}-${feature.name}`);
      } else if (existingFeature) {
        // Update the existing feature if this one is a higher level
        curFeatures.forEach((curFeature, curFeatureIndex) => {
          const curFeatureLevel = curFeature?.data?.level || 0;
          if (
            curFeature === `${className}-${feature.name}` &&
            curFeatureLevel < level
          ) {
            additionalFieldsToSet[`data.features.${curFeatureIndex}`] = {
              ...feature,
              data: {
                ...feature.data,
                source: className,
              },
            };
            featureAddedOrUpdated = true;
          }
        });
      }
    }
    if (featureAddedOrUpdated) {
      // Apply one-time modifiers (proficiencies, speed, etc.) on this feature.
      // Pass `rec` so proficiency merges read the CURRENT lists (incl. the class
      // base proficiencies just granted) and APPEND to them rather than starting
      // from the stale global record and overwriting. AC recalc is handled by
      // recalcACAndHP after all features are added.
      applyOneTimeModifiers(feature, additionalFieldsToSet, rec);

      // Collect ability group data to process later (avoid fire-and-forget race conditions)
      const abilityGroupName = feature?.data?.abilityGroupName || "";
      if (
        abilityGroupName !== "" &&
        !abilityGroupsToAdd.has(abilityGroupName)
      ) {
        abilityGroupsToAdd.add(abilityGroupName);

        const allAbilities = allFeatures
          .filter(
            (f) =>
              (f?.data?.level || 0) === newLevel &&
              f.data.abilityGroupName === abilityGroupName,
          )
          .map((f) => f?.data?.ability)
          .filter((ability) => ability !== undefined && ability !== "");

        let abilityUsesPerDay = feature?.data?.maxDailyUses || 0;
        if ((feature?.data?.fieldsToAddToUses || []).length > 0) {
          abilityUsesPerDay = getTotalValueFromFields(
            rec,
            feature?.data?.fieldsToAddToUses || [],
            {
              "data.classLevels": classLevels,
            },
            abilityGroupName,
          );
        }
        deferredAbilityGroups.push({
          abilityGroupName,
          allAbilities,
          abilityUsesPerDay,
          abilityValue: feature?.data?.value || "",
          abilityRestoresOn: feature?.data?.restoreOn || "",
          savingThrowAbility: feature?.data?.savingThrowAbility || "",
          altSavingThrowAbility: feature?.data?.altSavingThrowAbility || "",
          fieldsToAddToUses: feature?.data?.fieldsToAddToUses || [],
          spellSlotConversion: feature?.data?.spellSlotConversion || false,
        });
      }
    }
  });
  return {
    fieldsToSet: additionalFieldsToSet,
    featuresToAdd,
    deferredAbilityGroups,
  };
}

// NOTE: processDeferredAbilityGroups() is provided by common.js (loaded first)
// and is intentionally not redefined here (see note near the top of this file).

// Add abilities from a feature to the character's ability groups.
// Creates the group if it doesn't exist, adds the ability, sets group fields,
// then applies one-time modifiers and recalcs attribute bonuses.
function updateAbilitiesFromFeature(feature, recordOverride) {
  const rec = recordOverride || record;
  const abilityGroupName = feature?.data?.abilityGroupName || "";
  if (abilityGroupName !== "") {
    let abilityUsesPerDay = feature?.data?.maxDailyUses || 0;
    if ((feature?.data?.fieldsToAddToUses || []).length > 0) {
      abilityUsesPerDay = getTotalValueFromFields(
        rec,
        feature?.data?.fieldsToAddToUses || [],
        undefined,
        abilityGroupName,
      );
    }
    const abilityValue = feature?.data?.value || "";
    const abilityRestoresOn = feature?.data?.restoreOn || "";
    const savingThrowAbility = feature?.data?.savingThrowAbility || "";
    const altSavingThrowAbility = feature?.data?.altSavingThrowAbility || "";
    let abilityGroup = rec?.data?.abilityGroups?.find(
      (ag) => ag?.name === abilityGroupName,
    );
    // When the group is added, or found, we add abilities to it or set data on it
    const abilityAddedCallback = (updatedRec) => {
      const abilityGroupIndex = updatedRec?.data?.abilityGroups?.findIndex(
        (ag) => ag?.name === abilityGroupName,
      );
      if (abilityGroupIndex === -1) {
        // No group found — still apply modifiers
        const fieldsToSet = {};
        const { needsHpRecalc } = applyOneTimeModifiers(feature, fieldsToSet);
        recalcAttributeBonuses(fieldsToSet, updatedRec);
        const pending = extractAllPending(fieldsToSet);
        const afterSetValues = () => {
          const afterPending = () => {
            if (needsHpRecalc) recalcHitPoints();
          };
          if (hasAnyPending(pending)) {
            applyAllPending(pending, null, afterPending);
          } else {
            afterPending();
          }
        };
        if (Object.keys(fieldsToSet).length > 0) {
          api.setValues(fieldsToSet, afterSetValues);
        } else {
          afterSetValues();
        }
        return;
      }

      // Add ability first (chained), then set group fields + modifiers
      const afterAbilityAdded = (latestRec) => {
        const fieldsToSet = {};
        if (feature?.data?.spellSlotConversion) {
          // Spell slot conversion groups: show convert button, start at 0 max
          // Counter stays hidden until a slot is converted; only the button is shown
          fieldsToSet[
            `data.abilityGroups.${abilityGroupIndex}.data.spellSlotConversion`
          ] = true;
          fieldsToSet[
            `data.abilityGroups.${abilityGroupIndex}.data.maxDailyUses`
          ] = 0;
          fieldsToSet[
            `data.abilityGroups.${abilityGroupIndex}.fields.dailyUses.hidden`
          ] = true;
          fieldsToSet[
            `data.abilityGroups.${abilityGroupIndex}.fields.convertSlotBtn.hidden`
          ] = false;
          if (abilityValue) {
            fieldsToSet[`data.abilityGroups.${abilityGroupIndex}.data.value`] =
              abilityValue;
          }
          if (abilityRestoresOn !== "") {
            fieldsToSet[
              `data.abilityGroups.${abilityGroupIndex}.data.restore`
            ] = abilityRestoresOn;
          }
        } else if (abilityUsesPerDay > 0) {
          const curDailyUses =
            latestRec.data?.abilityGroups?.[abilityGroupIndex]?.data
              .maxDailyUses || 0;
          if (curDailyUses < abilityUsesPerDay) {
            fieldsToSet[
              `data.abilityGroups.${abilityGroupIndex}.data.maxDailyUses`
            ] = abilityUsesPerDay;
          }
          if (abilityValue) {
            fieldsToSet[`data.abilityGroups.${abilityGroupIndex}.data.value`] =
              abilityValue;
          }
          if (abilityRestoresOn !== "") {
            fieldsToSet[
              `data.abilityGroups.${abilityGroupIndex}.data.restore`
            ] = abilityRestoresOn;
          }
          fieldsToSet[
            `data.abilityGroups.${abilityGroupIndex}.fields.dailyUses.hidden`
          ] = false;
        }
        // Apply one-time modifiers (proficiencies, HP flag)
        const { needsHpRecalc } = applyOneTimeModifiers(feature, fieldsToSet);
        // Recalc attribute bonuses from all features on the record
        recalcAttributeBonuses(fieldsToSet, latestRec);
        const pending = extractAllPending(fieldsToSet);
        const afterSetValues = () => {
          const afterPending = () => {
            if (needsHpRecalc) recalcHitPoints();
          };
          if (hasAnyPending(pending)) {
            applyAllPending(pending, null, afterPending);
          } else {
            afterPending();
          }
        };
        if (Object.keys(fieldsToSet).length > 0) {
          api.setValues(fieldsToSet, afterSetValues);
        } else {
          afterSetValues();
        }
      };

      const abilityIdToAdd =
        JSON.parse(feature?.data?.ability || "{}")?._id || "";
      if (abilityIdToAdd !== "") {
        api.getRecord("abilities", abilityIdToAdd, (abilityRecord) => {
          // Skip if this ability is already in the group (by name + type)
          const existingAbilities =
            updatedRec?.data?.abilityGroups?.[abilityGroupIndex]?.data
              ?.abilities || [];
          const alreadyExists = existingAbilities.some(
            (a) =>
              a?.name === abilityRecord?.name &&
              a?.data?.type === abilityRecord?.data?.type,
          );
          if (alreadyExists) {
            afterAbilityAdded(updatedRec);
            return;
          }
          safeAddValue(
            `data.abilityGroups.${abilityGroupIndex}.data.abilities`,
            abilityRecord,
            afterAbilityAdded,
            rec,
          );
        });
      } else {
        afterAbilityAdded(updatedRec);
      }
    };
    if (!abilityGroup) {
      const groupData = {
        abilities: [],
        maxDailyUses: abilityUsesPerDay,
        value: abilityValue,
        restore: abilityRestoresOn,
        savingThrowAbility: savingThrowAbility,
        altSavingThrowAbility: altSavingThrowAbility,
        fieldsToAddToUses: feature?.data?.fieldsToAddToUses || [],
      };
      if (feature?.data?.spellSlotConversion) {
        groupData.spellSlotConversion = true;
        groupData.maxDailyUses = 0;
      }
      safeAddValue(
        "data.abilityGroups",
        {
          name: abilityGroupName,
          data: groupData,
        },
        abilityAddedCallback,
        rec,
      );
    } else {
      abilityAddedCallback(rec);
    }
  } else {
    // No ability group — still apply one-time modifiers
    const fieldsToSet = {};
    const { needsHpRecalc } = applyOneTimeModifiers(feature, fieldsToSet);
    recalcAttributeBonuses(fieldsToSet, rec);
    const pending = extractAllPending(fieldsToSet);
    const afterSetValues = () => {
      const afterPending = () => {
        if (needsHpRecalc) recalcHitPoints();
      };
      if (hasAnyPending(pending)) {
        applyAllPending(pending, null, afterPending);
      } else {
        afterPending();
      }
    };
    if (Object.keys(fieldsToSet).length > 0) {
      api.setValues(fieldsToSet, afterSetValues);
    } else {
      afterSetValues();
    }
  }
}

// Internal helper: apply a list of selected ability score values (+1 each, capped at max).
// Always calls callback when done.
function _applyAsiScores(values, max, rec, callback) {
  const fieldsToSet = {};
  values.forEach((curV) => {
    const value = curV.split("-")[0];
    const curValue = rec?.data?.[value] || 0;
    if (fieldsToSet[`data.${value}`] === undefined) {
      if (curValue < max) fieldsToSet[`data.${value}`] = curValue + 1;
    } else {
      if (fieldsToSet[`data.${value}`] < max)
        fieldsToSet[`data.${value}`] = fieldsToSet[`data.${value}`] + 1;
    }
  });
  // Also bump `{ability}Base` alongside `data.{ability}`. Without this, a later
  // recalcAttributeBonuses (fired on any subsequent feature add) recomputes
  // `total = base + bonus` and silently reverts the ASI. Mirrors what
  // onAbilityScoreChanged does on the manual-edit path.
  Object.keys(fieldsToSet).forEach((key) => {
    const ability = key.replace("data.", "");
    const baseKey = `data.${ability}Base`;
    if (fieldsToSet[baseKey] === undefined) {
      const newTotal = parseInt(fieldsToSet[key], 10) || 0;
      const currentBonus = parseInt(rec?.data?.[`${ability}Bonus`] ?? "0", 10);
      fieldsToSet[baseKey] = newTotal - currentBonus;
    }
  });
  if (Object.keys(fieldsToSet).length > 0) {
    api.setValues(fieldsToSet, () => {
      // Fetch a fresh record AFTER the ASI write so setModifier's HP/AC/skill
      // recalcs see current hpLevelN, level, etc. Without this the global
      // `record` is stale during the level-up → ASI flow (missing the just-
      // added hpLevelN entry), so getHpForLevel undercounts by one level.
      const recType = rec?.recordType || "characters";
      const recId = rec?._id;
      api.getRecord(recType, recId, (freshRec) => {
        const moreValuesToSet = {};
        Object.keys(fieldsToSet).forEach((key) => {
          // Only run setModifier for the score fields, not the *Base fields
          // we added above.
          if (key.endsWith("Base")) return;
          setModifier(
            fieldsToSet[key],
            key.replace("data.", ""),
            {},
            moreValuesToSet,
            freshRec,
          );
        });
        if (Object.keys(moreValuesToSet).length > 0) {
          api.setValues(moreValuesToSet, () => {
            if (callback) callback();
          });
        } else {
          if (callback) callback();
        }
      });
    });
  } else {
    if (callback) callback();
  }
}

// Handle the abilityScores field on a feature or feat when it is granted.
// - "Choice of Feat or ASI": prompts for ASI or feat selection. If feat chosen,
//   adds it to features directly (no dropRecord), then recursively processes its choices.
// - Other values: uses getAbilityScoreIncrease for standard ASI prompts/application.
// Always calls callback when done (even if user cancels or there is nothing to do).
function promptAbilityScoreIncrease(feature, rec, callback) {
  const abilityScores = (feature?.data?.abilityScores || "").trim();

  if (abilityScores === "Choice of Feat or ASI") {
    api.showPrompt(
      "Feat or Ability Score Improvement",
      "Choose",
      "Would you like an Ability Score Improvement or to choose a Feat?",
      [
        { label: "Ability Score Improvement", value: "asi" },
        { label: "Choose a Feat", value: "feat" },
      ],
      null,
      (choiceValues) => {
        if (!choiceValues || choiceValues.length === 0) {
          if (callback) callback();
          return;
        }
        const raw = Array.isArray(choiceValues)
          ? choiceValues[0]
          : choiceValues;
        const chosen = typeof raw === "object" ? raw.value || raw : raw;

        if (chosen === "asi") {
          // Treat as "Increase one ability score by 2, or increase two ability scores by 1"
          const allAbilities = [
            "strength",
            "dexterity",
            "constitution",
            "intelligence",
            "wisdom",
            "charisma",
          ];
          const asiOptions = [];
          allAbilities.forEach((score) => {
            asiOptions.push({ label: capitalize(score), value: score });
            asiOptions.push({ label: capitalize(score), value: `${score}-2` });
          });
          api.showPrompt(
            "Choose Ability Scores to Raise",
            "Select Ability Scores",
            "Select 2 Ability Scores to Raise (to a max of 20)...",
            asiOptions,
            null,
            (selectedScores) => {
              if (!selectedScores || selectedScores.length === 0) {
                if (callback) callback();
                return;
              }
              _applyAsiScores(selectedScores, 20, rec, callback);
            },
            "OK",
            "Cancel",
            2,
          );
        } else {
          // Show feat query, then add the chosen feat directly and process its choices.
          // Both regular Feats and Synergy Feats are valid choices at an ASI — synergy
          // feat prereqs are the player's responsibility to honor (same as the rest of
          // the codebase, which doesn't enforce prereqs at selection time).
          // Feats without a level field set are also valid — most user-authored feats
          // and many imports leave data.level unset; only filter out feats explicitly
          // gated above the character's level.
          const characterLevel = parseInt(rec?.data?.level || "1", 10) || 1;
          const featQuery = {
            type: "feats",
            query: {
              "data.type": { $in: ["feat", "synergyFeat"] },
              $or: [
                { "data.level": { $lte: characterLevel } },
                { "data.level": null },
                { "data.level": "" },
                { "data.level": { $exists: false } },
              ],
            },
          };
          api.showPrompt(
            "Choose a Feat",
            "Select Feat",
            "Choose a feat to gain...",
            null,
            featQuery,
            (selectedFeats) => {
              if (!selectedFeats || selectedFeats.length === 0) {
                if (callback) callback();
                return;
              }
              const selectedFeat = selectedFeats[0];
              api.getRecord("feats", selectedFeat._id, (featRecord) => {
                const featToAdd = {
                  ...featRecord,
                  data: {
                    ...featRecord?.data,
                    featureType: "feat",
                    source: feature?.data?.source || feature?.name || "",
                  },
                };
                safeAddValue(
                  "data.features",
                  featToAdd,
                  (updatedRec) => {
                    updateAbilitiesFromFeature(featToAdd, updatedRec);
                    applyProvidesItems(featToAdd, updatedRec, () => {
                      processChoices(updatedRec, () => {
                        recalcACAndHP(updatedRec, () => {
                          promptAbilityScoreIncrease(
                            featToAdd,
                            updatedRec,
                            callback,
                          );
                        });
                      });
                    });
                  },
                  rec,
                );
              });
            },
            "OK",
            "Cancel",
          );
        }
      },
      "OK",
      "Cancel",
    );
    return;
  }

  const abilityIncrease = getAbilityScoreIncrease(feature);
  if (abilityIncrease.promptChoice) {
    const options = [];
    abilityIncrease.scores.forEach((score) => {
      options.push({ label: capitalize(score), value: score });
    });
    if (abilityIncrease.count > 1) {
      abilityIncrease.scores.forEach((score) => {
        options.push({ label: capitalize(score), value: `${score}-2` });
      });
    }
    api.showPrompt(
      "Choose Ability Scores to Raise",
      "Select Ability Scores",
      `Select ${abilityIncrease.count} Ability Score${
        abilityIncrease.count > 1 ? "s" : ""
      } to Raise (to a max of ${abilityIncrease.max})...`,
      options,
      null,
      (values) => {
        if (!values || values.length === 0) {
          if (callback) callback();
          return;
        }
        _applyAsiScores(values, abilityIncrease.max, rec, callback);
      },
      "OK",
      "Cancel",
      abilityIncrease.count,
    );
  } else if (abilityIncrease.scores.length > 0) {
    _applyAsiScores(
      abilityIncrease.scores.slice(),
      abilityIncrease.max,
      rec,
      callback,
    );
  } else {
    if (callback) callback();
  }
}

// Add a feat to the character, called on Background drop.
// Adds the feat to features list, processes ability groups, and handles ASI prompts.
function addFeat(feat, recordOverride) {
  const rec = recordOverride || record;
  const featToAdd = {
    ...feat,
    data: {
      ...feat?.data,
      featureType: "feat",
    },
  };

  safeAddValue(
    "data.features",
    featToAdd,
    () => {
      // After adding the feat, we need to update abilities if one was attached to it
      updateAbilitiesFromFeature(featToAdd);
    },
    rec,
  );

  promptAbilityScoreIncrease(featToAdd, rec, () => {});
}

// Remove all features with a matching source name from the character.
// Sets the provided fieldsToSet, fetches a fresh record, and recalcs attribute bonuses.
// Re-derive data.toggles from current features and equipped items.
// Rebuilds the list from scratch from every toggle modifier on the character:
// - Drops toggles whose source modifier no longer exists
// - Adds toggles for modifiers that aren't in data.toggles yet (self-heals
//   against race conditions where parallel applyOneTimeModifiers calls each
//   read a stale data.toggles and overwrite each other)
// - Preserves existing toggle _id / active state when the field matches
function recalcToggles(fieldsToSet, recordOverride) {
  const rec = recordOverride || record;
  const currentToggles = rec?.data?.toggles || [];

  // Index existing toggles by field so we can reuse _id / active state
  const existingByField = new Map();
  currentToggles.forEach((t) => {
    const f = t?.data?.field;
    if (f) existingByField.set(f, t);
  });

  // Walk every toggle modifier on the character, preserving first-seen order
  // so the UI ordering stays stable (features first, then equipped items).
  const seenFields = new Set();
  const newToggles = [];
  const allSources = [
    ...(rec?.data?.features || []),
    ...(rec?.data?.inventory || []).filter(
      (i) => i?.data?.carried === "equipped",
    ),
  ];
  allSources.forEach((src) => {
    (src?.data?.modifiers || []).forEach((m) => {
      if (m?.data?.type !== "toggle") return;
      const field = (m?.data?.field || "").trim();
      if (!field || seenFields.has(field)) return;
      seenFields.add(field);
      const existing = existingByField.get(field);
      if (existing) {
        newToggles.push(existing);
      } else {
        const label = (m?.data?.value || field || "").trim();
        newToggles.push({
          _id: generateId(),
          name: label,
          unidentifiedName: label,
          recordType: "records",
          identified: true,
          data: { field, active: false },
        });
      }
    });
  });

  // Only write if the list actually changed (length or field order/identity).
  const changed =
    newToggles.length !== currentToggles.length ||
    newToggles.some(
      (t, i) => t?.data?.field !== currentToggles[i]?.data?.field,
    );
  if (changed) {
    fieldsToSet["data.toggles"] = newToggles;
  }
}

function deleteOriginFeatures(sourceName, fieldsToSet, recordOverride) {
  const rec = recordOverride || record;
  const features = rec?.data?.features || [];
  if (sourceName) {
    for (let i = features.length - 1; i >= 0; i--) {
      if (features[i]?.data?.source === sourceName) {
        api.removeValue("data.features", i);
      }
    }
  }
  // Set fields then fetch fresh record to recalc attribute bonuses and toggles
  api.setValues(fieldsToSet, () => {
    api.getRecord(rec.recordType, rec._id, (freshRecord) => {
      const bonusFields = {};
      recalcAttributeBonuses(bonusFields, freshRecord);
      recalcToggles(bonusFields, freshRecord);
      recalcPassiveSkills(freshRecord, bonusFields);
      if (Object.keys(bonusFields).length > 0) {
        api.setValues(bonusFields);
      }
    });
  });
}
