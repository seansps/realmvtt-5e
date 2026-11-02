// D&D Beyond Character Import Script for RealmVTT 5e Ruleset
// Transforms a D&D Beyond character JSON export into RealmVTT format.
//
// Input: The full D&D Beyond API response (with or without the outer wrapper).
// Output: RealmVTT character data with _pendingRecords for items, classes, species, backgrounds.

const ddb = value.data || value; // Handle wrapped { id, success, data: {...} } or unwrapped

// ===== Constants =====

const STAT_MAP = {
  1: "strength",
  2: "dexterity",
  3: "constitution",
  4: "intelligence",
  5: "wisdom",
  6: "charisma",
};

const SKILL_MAP = {
  acrobatics: "acrobatics",
  "animal-handling": "animalHandling",
  arcana: "arcana",
  athletics: "athletics",
  deception: "deception",
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
  "sleight-of-hand": "sleightOfHand",
  stealth: "stealth",
  survival: "survival",
  culture: "culture",
};

const SAVE_MAP = {
  "strength-saving-throws": "strength",
  "dexterity-saving-throws": "dexterity",
  "constitution-saving-throws": "constitution",
  "intelligence-saving-throws": "intelligence",
  "wisdom-saving-throws": "wisdom",
  "charisma-saving-throws": "charisma",
};

// ===== Helpers =====

function statMod(val) {
  var m = Math.floor((val - 10) / 2);
  return m >= 0 ? "+" + m : "" + m;
}

function statModNum(val) {
  return Math.floor((val - 10) / 2);
}

// ===== 1. Calculate Ability Scores =====

var abilityScores = {};
(ddb.stats || []).forEach(function (stat) {
  var name = STAT_MAP[stat.id];
  if (!name) return;
  var val = stat.value || 10;

  // Apply overrides
  var override = (ddb.overrideStats || []).find(function (o) {
    return o.id === stat.id;
  });
  if (override && override.value != null) val = override.value;

  // Apply manual bonuses
  var bonus = (ddb.bonusStats || []).find(function (b) {
    return b.id === stat.id;
  });
  if (bonus && bonus.value) val += bonus.value;

  abilityScores[name] = val;
});

// Item modifiers come from the inventory rather than ddb.modifiers.item, which
// also lists items that aren't equipped (e.g. a Potion of Healing in the pack).
// A granted modifier is live while its item is equipped, and attuned if the
// modifier requires attunement — the same gate Realm applies to item modifiers.
var activeItemModifiers = [];
(ddb.inventory || []).forEach(function (item) {
  if (!item.equipped) return;
  ((item.definition && item.definition.grantedModifiers) || []).forEach(
    function (gm) {
      if (!gm) return;
      if (gm.requiresAttunement && !item.isAttuned) return;
      activeItemModifiers.push(gm);
    },
  );
});

// Gather all modifiers from all sources
var allModifiers = [].concat(
  ddb.modifiers && ddb.modifiers.race ? ddb.modifiers.race : [],
  ddb.modifiers && ddb.modifiers.class ? ddb.modifiers.class : [],
  ddb.modifiers && ddb.modifiers.background ? ddb.modifiers.background : [],
  ddb.modifiers && ddb.modifiers.feat ? ddb.modifiers.feat : [],
  activeItemModifiers,
  ddb.modifiers && ddb.modifiers.condition ? ddb.modifiers.condition : [],
);

// Apply ability score bonuses from modifiers. Item bonuses/sets are NOT baked
// into the base score: the item carries them as attributeBonus/attributeSet
// modifiers, and Realm re-derives score = base + bonus (floored by any set), so
// baking them in too would double them on the next recalc.
var abilityBaseScores = {};
var itemAbilityBonus = {};
var itemAbilitySet = {};
allModifiers.forEach(function (mod) {
  if (!mod.subType || mod.subType.indexOf("-score") === -1) return;
  var ability = mod.subType.replace("-score", "");
  if (abilityScores[ability] === undefined) return;
  var isItemMod = activeItemModifiers.indexOf(mod) !== -1;
  if (mod.type === "bonus" && mod.value) {
    if (isItemMod) {
      itemAbilityBonus[ability] = (itemAbilityBonus[ability] || 0) + mod.value;
    } else {
      abilityScores[ability] += mod.value;
    }
  } else if (mod.type === "set" && mod.value && isItemMod) {
    itemAbilitySet[ability] = Math.max(itemAbilitySet[ability] || 0, mod.value);
  }
});
Object.keys(abilityScores).forEach(function (ability) {
  abilityBaseScores[ability] = abilityScores[ability];
  abilityScores[ability] = Math.max(
    abilityScores[ability] + (itemAbilityBonus[ability] || 0),
    itemAbilitySet[ability] || 0,
  );
});

// ===== 2. Build Character Data =====

var totalLevel = (ddb.classes || []).reduce(function (s, c) {
  return s + (c.level || 0);
}, 0);

// getProficiencyBonus() is available from common.js utility scripts

// XP threshold for next level (not in common.js, only in character-main.html)
function getNextLevelXp(level) {
  var table = [
    0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
    120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
  ];
  if (level < 1) return 0;
  if (level >= 20) return 355000;
  return table[level] || 355000;
}

var profBonus = getProficiencyBonus(totalLevel);

var charData = {};

// Ability scores and modifiers
Object.keys(abilityScores).forEach(function (name) {
  var val = abilityScores[name];
  charData[name] = val;
  charData[name + "Mod"] = statMod(val);
  charData[name + "Base"] = abilityBaseScores[name];
  charData[name + "Bonus"] = itemAbilityBonus[name] || 0;
});

// Core stats
charData.level = totalLevel;
charData.proficiencyBonus = profBonus;
charData.speciesName = (ddb.race && ddb.race.fullName) || "";
charData.backgroundName =
  (ddb.background &&
    ddb.background.definition &&
    ddb.background.definition.name) ||
  "";
charData.speed =
  ((ddb.race &&
    ddb.race.weightSpeeds &&
    ddb.race.weightSpeeds.normal &&
    ddb.race.weightSpeeds.normal.walk) ||
    30) + " feet";

// HP — Realm stores hpLevelN as die-only; `hitpoints` is the final total for display.
// DDB's baseHitPoints already includes per-level feat bonuses (like Tough), so we only
// add con mod × level. The feat record carries the feat modifiers separately so Realm
// can re-apply them when con changes.
var conModForHp = statModNum(abilityScores.constitution || 10);
charData.hitpoints =
  (ddb.baseHitPoints || 0) +
  conModForHp * totalLevel +
  (ddb.bonusHitPoints || 0);
charData.curhp = charData.hitpoints - (ddb.removedHitPoints || 0);

// AC — calculate from equipped armor/modifiers, fallback to unarmored
var classNames = (ddb.classes || []).map(function (c) {
  return (c.definition && c.definition.name) || "";
});
var isMonk = classNames.indexOf("Monk") !== -1;
var isBarbarian = classNames.indexOf("Barbarian") !== -1;
var dexMod = statModNum(abilityScores.dexterity || 10);
var wisMod = statModNum(abilityScores.wisdom || 10);
var conMod = statModNum(abilityScores.constitution || 10);

// Check modifiers for armor-class related values
var baseAc = 10 + dexMod;
if (isMonk) baseAc = 10 + dexMod + wisMod;
if (isBarbarian) baseAc = 10 + dexMod + conMod;

// DDB marks shields with armorTypeId 4; magic shields (Sentinel Shield) leave
// def.type null, so the type string alone misses them.
function isShieldDef(def) {
  return (
    def.filterType === "Armor" &&
    (def.type === "Shield" ||
      def.armorTypeId === 4 ||
      def.baseArmorName === "Shield")
  );
}

// Check for equipped armor in inventory
var hasEquippedArmor = false;
(ddb.inventory || []).forEach(function (item) {
  var def = item.definition || {};
  if (
    item.equipped &&
    def.armorClass &&
    def.filterType === "Armor" &&
    !isShieldDef(def)
  ) {
    hasEquippedArmor = true;
    var armorAc = def.armorClass;
    var maxDex = def.armorTypeId === 1 ? 999 : def.armorTypeId === 2 ? 2 : 0;
    // Light armor (typeId 1): full dex, Medium (2): max +2 dex, Heavy (3): no dex
    if (def.armorTypeId === 1) maxDex = 999;
    else if (def.armorTypeId === 2) maxDex = 2;
    else maxDex = 0;
    var acDex = Math.min(dexMod, maxDex);
    baseAc = armorAc + acDex;
  }
});
// Check for equipped shield — only one counts, even if DDB has several equipped
var bestShieldAc = 0;
(ddb.inventory || []).forEach(function (item) {
  var def = item.definition || {};
  if (item.equipped && def.armorClass && isShieldDef(def)) {
    bestShieldAc = Math.max(bestShieldAc, def.armorClass);
  }
});
baseAc += bestShieldAc;
// Apply AC bonuses from modifiers
allModifiers.forEach(function (mod) {
  if (mod.type === "bonus" && mod.subType === "armor-class" && mod.value) {
    baseAc += mod.value;
  }
});
charData.ac = baseAc;

// Senses — extract from modifiers (darkvision, blindsight, tremorsense, truesight).
// Written as "Name Dist" (the format recalcSenses parses). The highest range per
// sense wins; an item that extends an existing sense ("plus 60 feet if the wearer
// already has Darkvision", Goggles of Night) adds to it instead.
function senseDisplayName(mod) {
  var senseName = mod.friendlySubtypeName || mod.subType;
  return senseName.charAt(0).toUpperCase() + senseName.slice(1);
}
function isAdditiveSense(mod) {
  return /already/i.test(mod.restriction || "");
}
var senseRanges = {};
var senseOrder = [];
allModifiers.forEach(function (mod) {
  if (mod.type !== "sense" || !mod.subType || !mod.value) return;
  if (isAdditiveSense(mod)) return;
  var senseName = senseDisplayName(mod);
  if (senseRanges[senseName] === undefined) senseOrder.push(senseName);
  senseRanges[senseName] = Math.max(senseRanges[senseName] || 0, mod.value);
});
allModifiers.forEach(function (mod) {
  if (mod.type !== "sense" || !mod.subType || !mod.value) return;
  if (!isAdditiveSense(mod)) return;
  var senseName = senseDisplayName(mod);
  if (senseRanges[senseName] === undefined) senseOrder.push(senseName);
  senseRanges[senseName] = (senseRanges[senseName] || 0) + mod.value;
});
if (senseOrder.length > 0) {
  charData.senses = senseOrder
    .map(function (senseName) {
      return senseName + " " + senseRanges[senseName];
    })
    .join(", ");
}

// Size — from race sizeId (2=Tiny, 3=Small, 4=Medium, 5=Large, 6=Huge, 7=Gargantuan)
var SIZE_MAP = {
  2: "tiny",
  3: "small",
  4: "medium",
  5: "large",
  6: "huge",
  7: "gargantuan",
};
var sizeId = ddb.race && ddb.race.sizeId;
charData.size = SIZE_MAP[sizeId] || "medium";

// Class string: "Bard 10 / Fighter 1"
var classString = (ddb.classes || [])
  .map(function (c) {
    return ((c.definition && c.definition.name) || "?") + " " + c.level;
  })
  .join(" / ");
charData.className = classString;
charData.classLevels = classString;

// Currency
var currencies = ddb.currencies || {};
charData.cp = currencies.cp || 0;
charData.sp = currencies.sp || 0;
charData.gp = currencies.gp || 0;
charData.ep = currencies.ep || 0;
charData.pp = currencies.pp || 0;

// XP — only set the thresholds, don't override current XP so Realm's value is preserved
charData.xpNext = getNextLevelXp(totalLevel);
charData.xpMinForLevel = getNextLevelXp(totalLevel - 1);

// ===== 3. Proficiencies from modifiers =====

allModifiers.forEach(function (mod) {
  if (mod.type === "proficiency" && mod.subType) {
    // Save proficiency
    if (SAVE_MAP[mod.subType]) {
      charData[SAVE_MAP[mod.subType] + "Prof"] = "true";
    }
    // Skill proficiency
    else if (SKILL_MAP[mod.subType]) {
      charData[SKILL_MAP[mod.subType] + "Prof"] = "true";
    }
  } else if (mod.type === "expertise" && mod.subType) {
    if (SKILL_MAP[mod.subType]) {
      charData[SKILL_MAP[mod.subType] + "Prof"] = "expertise";
    }
  } else if (mod.type === "half-proficiency" && mod.subType) {
    if (SKILL_MAP[mod.subType]) {
      // Only set half-prof if not already proficient or expertise
      var key = SKILL_MAP[mod.subType] + "Prof";
      if (!charData[key]) {
        charData[key] = "half";
      }
    }
  }
});

// Calculate save values
[
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
].forEach(function (ability) {
  var mod = statModNum(abilityScores[ability] || 10);
  var saveVal = mod + (charData[ability + "Prof"] === "true" ? profBonus : 0);
  charData[ability + "Save"] = saveVal;
});

// Calculate skill modifiers
var skillAbilities = {
  acrobatics: "dexterity",
  animalHandling: "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "intelligence",
  sleightOfHand: "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
  culture: "intelligence",
};

Object.keys(skillAbilities).forEach(function (skill) {
  var ability = skillAbilities[skill];
  var abilityMod = statModNum(abilityScores[ability] || 10);
  var prof = charData[skill + "Prof"];
  var bonus = 0;
  if (prof === "true") bonus = profBonus;
  else if (prof === "expertise") bonus = profBonus * 2;
  else if (prof === "half") bonus = Math.floor(profBonus / 2);
  charData[skill + "Mod"] = abilityMod + bonus;
});

// Passive scores (plus flat passive bonuses such as the Sentinel Shield's +5)
function passiveBonusFor(skill) {
  var total = 0;
  allModifiers.forEach(function (mod) {
    if (mod.type === "bonus" && mod.subType === "passive-" + skill && mod.value)
      total += mod.value;
  });
  return total;
}
charData.passivePerception =
  10 + (charData.perceptionMod || 0) + passiveBonusFor("perception");
charData.passiveInsight =
  10 + (charData.insightMod || 0) + passiveBonusFor("insight");
charData.passiveInvestigation =
  10 + (charData.investigationMod || 0) + passiveBonusFor("investigation");

// ===== 4. Armor/weapon proficiencies =====

// Individual weapon subTypes from DDB (lowercase, hyphenated)
var WEAPON_SUBTYPES = [
  "club",
  "dagger",
  "greatclub",
  "handaxe",
  "javelin",
  "light-hammer",
  "mace",
  "quarterstaff",
  "sickle",
  "spear",
  "dart",
  "light-crossbow",
  "shortbow",
  "sling",
  "battleaxe",
  "flail",
  "glaive",
  "greataxe",
  "greatsword",
  "halberd",
  "lance",
  "longsword",
  "maul",
  "morningstar",
  "pike",
  "rapier",
  "scimitar",
  "shortsword",
  "trident",
  "warhammer",
  "war-pick",
  "whip",
  "blowgun",
  "crossbow-hand",
  "crossbow-heavy",
  "hand-crossbow",
  "heavy-crossbow",
  "longbow",
  "musket",
  "pistol",
  "net",
  "firearms",
];

var armorProfs = [];
var weaponProfs = [];
var weaponProfsSeen = {};
allModifiers.forEach(function (mod) {
  if (mod.type === "proficiency" && mod.subType) {
    if (
      mod.subType.indexOf("armor") !== -1 ||
      mod.subType.indexOf("shield") !== -1
    ) {
      var name = mod.friendlySubtypeName || mod.subType;
      if (armorProfs.indexOf(name) === -1) armorProfs.push(name);
    } else if (
      mod.subType.indexOf("weapon") !== -1 ||
      mod.subType.indexOf("martial") !== -1 ||
      mod.subType.indexOf("simple") !== -1 ||
      WEAPON_SUBTYPES.indexOf(mod.subType) !== -1
    ) {
      var wName = mod.friendlySubtypeName || mod.subType;
      if (!weaponProfsSeen[wName]) {
        weaponProfsSeen[wName] = true;
        weaponProfs.push(wName);
      }
    }
  }
});
charData.armorTraining = armorProfs.join(", ");
charData.weaponProficiencies = weaponProfs.join(", ");

// ===== 5. RP Traits, Notes, and Appearance =====

var traits = ddb.traits || {};
charData.personalityTraits = traits.personalityTraits || "";
charData.ideals = traits.ideals || "";
charData.bonds = traits.bonds || "";
charData.flaws = traits.flaws || "";

// Compile notes from DDB fields: backstory, allies, enemies, organizations, possessions
var notesParts = [];
var ddbNotes = ddb.notes || {};
if (ddbNotes.backstory)
  notesParts.push("<h4>Backstory</h4>" + ddbNotes.backstory);
if (ddbNotes.allies) notesParts.push("<h4>Allies</h4>" + ddbNotes.allies);
if (ddbNotes.enemies) notesParts.push("<h4>Enemies</h4>" + ddbNotes.enemies);
if (ddbNotes.organizations)
  notesParts.push("<h4>Organizations</h4>" + ddbNotes.organizations);
if (ddbNotes.personalPossessions)
  notesParts.push(
    "<h4>Personal Possessions</h4>" + ddbNotes.personalPossessions,
  );
if (ddbNotes.otherHoldings)
  notesParts.push("<h4>Other Holdings</h4>" + ddbNotes.otherHoldings);
if (ddbNotes.otherNotes)
  notesParts.push("<h4>Other Notes</h4>" + ddbNotes.otherNotes);
if (notesParts.length > 0) {
  charData.notes = notesParts.join("");
}

// Appearance fields
if (ddb.gender) charData.gender = ddb.gender;
if (ddb.age) charData.age = "" + ddb.age;
if (ddb.height) charData.height = ddb.height;
if (ddb.weight) charData.weight = "" + ddb.weight;
if (ddb.hair) charData.hair = ddb.hair;
if (ddb.eyes) charData.eyes = ddb.eyes;
if (ddb.skin) charData.skin = ddb.skin;
if (traits.appearance) charData.appearance = traits.appearance;

// Alignment (DDB alignmentId: 1=LG, 2=NG, 3=CG, 4=LN, 5=N, 6=CN, 7=LE, 8=NE, 9=CE)
var ALIGNMENT_MAP = {
  1: "lawful good",
  2: "neutral good",
  3: "chaotic good",
  4: "lawful neutral",
  5: "neutral",
  6: "chaotic neutral",
  7: "lawful evil",
  8: "neutral evil",
  9: "chaotic evil",
};
if (ddb.alignmentId && ALIGNMENT_MAP[ddb.alignmentId]) {
  charData.alignment = ALIGNMENT_MAP[ddb.alignmentId];
}

// Deity / Faith
if (ddb.faith) charData.deity = ddb.faith;

// Languages — from modifiers with type "language"
var languages = [];
allModifiers.forEach(function (mod) {
  if (mod.type === "language" && mod.friendlySubtypeName) {
    if (languages.indexOf(mod.friendlySubtypeName) === -1) {
      languages.push(mod.friendlySubtypeName);
    }
  }
});
if (languages.length > 0) {
  charData.languages = languages.join(", ");
}

// ===== 6. Build hpByLevel =====
// DDB doesn't store per-level HP rolls, only the total baseHitPoints.
// We reconstruct per-level values:
//   Level 1 (starting class) = max hit die
//   Other levels = fixed average (die/2 + 1)
// If that doesn't add up to baseHitPoints, distribute the remainder.

// Order: starting class levels first, then other classes
var startingClass = null;
var otherClasses = [];
(ddb.classes || []).forEach(function (cls) {
  if (cls.isStartingClass) {
    startingClass = cls;
  } else {
    otherClasses.push(cls);
  }
});
// Fallback if no class is marked as starting
if (!startingClass && (ddb.classes || []).length > 0) {
  startingClass = (ddb.classes || [])[0];
  otherClasses = (ddb.classes || []).slice(1);
}

var hpByLevel = [];
// Starting class levels
if (startingClass) {
  var scDef = startingClass.definition || {};
  var scDie = scDef.hitDice || 8;
  var scName = scDef.name || "Unknown";
  for (var scLvl = 1; scLvl <= (startingClass.level || 0); scLvl++) {
    var scHp = scLvl === 1 ? scDie : Math.floor(scDie / 2) + 1;
    hpByLevel.push({
      className: scName,
      level: hpByLevel.length + 1,
      hitDie: "d" + scDie,
      hp: scHp,
    });
  }
}
// Other class levels
otherClasses.forEach(function (cls) {
  var ocDef = cls.definition || {};
  var ocDie = ocDef.hitDice || 8;
  var ocName = ocDef.name || "Unknown";
  for (var ocLvl = 1; ocLvl <= (cls.level || 0); ocLvl++) {
    hpByLevel.push({
      className: ocName,
      level: hpByLevel.length + 1,
      hitDie: "d" + ocDie,
      hp: Math.floor(ocDie / 2) + 1,
    });
  }
});

// Check if our estimates add up to DDB's baseHitPoints (minus CON and feat contributions)
// Realm's hp values are die-only; the engine adds CON mod per level and feat bonuses separately.
var estimatedDieTotal = 0;
for (var hpIdx = 0; hpIdx < hpByLevel.length; hpIdx++) {
  estimatedDieTotal += hpByLevel[hpIdx].hp;
}
// Subtract per-level HP bonuses from feats like Tough (Realm calculates these itself)
var hpPerLevelBonus = 0;
allModifiers.forEach(function (mod) {
  if (
    mod.type === "bonus" &&
    mod.subType === "hit-points-per-level" &&
    mod.value
  ) {
    hpPerLevelBonus += mod.value;
  }
});
// DDB's baseHitPoints is die-rolls only — con mod is added separately by DDB's client
// (same convention as Realm). So we only strip the feat bonuses, not con.
var actualDieTotal = (ddb.baseHitPoints || 0) - hpPerLevelBonus * totalLevel;
var remainder = actualDieTotal - estimatedDieTotal;
// Distribute remainder across non-first levels (player may have rolled higher/lower)
if (remainder !== 0 && hpByLevel.length > 1) {
  var remaining = remainder;
  var step = remainder > 0 ? 1 : -1;
  var rIdx = 1;
  var consecutiveClamps = 0;
  while (remaining !== 0) {
    var before = hpByLevel[rIdx].hp;
    hpByLevel[rIdx].hp += step;
    // Clamp to minimum 1
    if (hpByLevel[rIdx].hp < 1) {
      hpByLevel[rIdx].hp = 1;
    }
    if (hpByLevel[rIdx].hp === before) {
      // No progress made on this entry
      consecutiveClamps++;
      if (consecutiveClamps >= hpByLevel.length - 1) {
        // Every non-first entry is saturated — can't distribute more, bail
        break;
      }
    } else {
      consecutiveClamps = 0;
      remaining -= step;
    }
    rIdx++;
    if (rIdx >= hpByLevel.length) rIdx = 1; // wrap around
  }
}

charData.hpByLevel = JSON.stringify(hpByLevel);

// Also set hpLevel1, hpLevel2, etc. for field display
for (var hpLvlIdx = 0; hpLvlIdx < hpByLevel.length; hpLvlIdx++) {
  charData["hpLevel" + (hpLvlIdx + 1)] = hpByLevel[hpLvlIdx].hp;
}

// Hit Dice — each class grants hit dice equal to its level
// Realm stores as d6HitDie, d8HitDie, d10HitDie, d12HitDie (total per die type)
var hitDiceCounts = {};
(ddb.classes || []).forEach(function (cls) {
  var dieValue = (cls.definition && cls.definition.hitDice) || 8;
  var key = "d" + dieValue + "HitDie";
  hitDiceCounts[key] = (hitDiceCounts[key] || 0) + (cls.level || 0);
});
Object.keys(hitDiceCounts).forEach(function (key) {
  charData[key] = hitDiceCounts[key];
});

// ===== 7. Build _pendingRecords =====

// ===== Icons =====
// Stock Realm VTT icons for records the compendium doesn't have. Each pending
// record carries its pick as data.ddbIcon; the post-import script moves it to
// the record's portrait only when the resolved record has no art of its own
// (a compendium match keeps its own), then clears it.
var DDB_ICON_MAP = {
  "weapons": {
    "battleaxe": "/images/5ca5cf9c-947d-47e4-ab50-87f7b0adb88f_22.webp",
    "blowgun": "/images/94bc3244-1314-49f4-b3bd-4aefdbe8eacf_15.webp",
    "club": "/images/461500d2-ac88-4891-8242-9270fb9716cf_2.webp",
    "dagger": "/images/80a7f3c1-4e50-4073-a127-d470ca05c664_1.webp",
    "dart": "/images/b6e76363-e7aa-467d-96ee-eb00776891e2_15.webp",
    "flail": "/images/e9d2868d-6547-43a5-8b09-b382a88f9daf_6.webp",
    "glaive": "/images/02899d56-f619-4fff-b160-ea3db1fd1c4b_18.webp",
    "greataxe": "/images/4d3803dc-cc6d-4ba0-bd58-926c251380dd_38.webp",
    "greatclub": "/images/c400ebfc-75b1-4122-8e48-cb8d7faa1cd8_5.webp",
    "greatsword": "/images/c1990ae6-defb-40f3-ab2c-fef7e596c739_49.webp",
    "halberd": "/images/969db45d-529b-411e-91af-e3ec444abb59_35.webp",
    "hand crossbow": "/images/2a5df5c2-6c5f-4010-a40d-96643bed4527_34.webp",
    "handaxe": "/images/799d2924-d3d0-4ea4-9f83-1142ea482d1c_5.webp",
    "heavy crossbow": "/images/aec92f87-58bc-4a41-90b6-8eeaf5b9e734_27.webp",
    "javelin": "/images/54f7ddda-b65f-4e1d-8456-632385a2ebce_3.webp",
    "lance": "/images/659ae410-f7f9-469f-a10f-0acc90b43237_22.webp",
    "light crossbow": "/images/1954c357-e23d-43cc-9119-b0129bb27375_31.webp",
    "light hammer": "/images/9ce02b4e-4ce2-419e-9084-2ef431069c7a_34.webp",
    "longbow": "/images/1d089123-8336-4270-912f-fbd19ce373f3_18.webp",
    "longsword": "/images/31580a58-ec0c-41c4-86e3-b44c5bbafed5_2.webp",
    "mace": "/images/c8e7deb8-2ce9-43ba-99dc-4b30fe72f604_13.webp",
    "maul": "/images/559a8603-b3de-46e0-9263-bfce5a106aee_39.webp",
    "morningstar": "/images/0e95fd37-40ee-4bd6-b6f6-a8a6ce186c0d_18.webp",
    "musket": "/images/31d7945a-0eb9-40ef-b556-7c9b217f7630_46.webp",
    "net": "/images/f96c5053-d3a5-42c6-b6be-f2234664f33e_27.webp",
    "pike": "/images/f80a6656-ac69-4202-b5b9-7b7722f53c1a_39.webp",
    "pistol": "/images/3c89bb78-733f-4ea6-a871-d2a7f87bdfd7_45.webp",
    "quarterstaff": "/images/4a8e887d-e55b-43f4-8a18-6b93591c9a14_2.webp",
    "rapier": "/images/f832a07e-8237-4403-8e23-8e9308511854_12.webp",
    "scimitar": "/images/02745c8e-79a1-4b3a-8798-014bde86046d_1.webp",
    "shortbow": "/images/b6040c14-e331-4bbe-89df-3af334cd36dc_1.webp",
    "shortsword": "/images/4d42fc2f-e421-4127-b47c-6a26252eb6d7_1.webp",
    "sickle": "/images/d878e28b-cf79-43bf-bd5d-483ae92368e8_29.webp",
    "sling": "/icons/fantasy/equipment/weapons/sling.webp",
    "spear": "/images/3e636d9e-6670-4b84-9742-5e751a6726e8_4.webp",
    "trident": "/images/57cf0993-06ef-4c6a-8cd2-16be251028e8_38.webp",
    "war pick": "/images/a0146dff-fd86-4d96-9dba-87e6fb044274_32.webp",
    "warhammer": "/images/04ab689d-aa3b-45c4-86e4-51725f8dcf80_49.webp",
    "whip": "/icons/fantasy/equipment/weapons/whip.webp"
  },
  "armor": {
    "breastplate": "/images/d11ab76d-d8f4-428a-9c91-317edffb92b5_33.webp",
    "chain mail": "/images/ce41ca01-0582-4e2d-83b9-35cd4cd6b0ca_17.webp",
    "chain shirt": "/images/997fd476-f4e9-481c-9560-5f2bb983a3f3_9.webp",
    "half plate": "/images/7d07e1bb-6b74-441a-b09f-a29240303892_21.webp",
    "hide": "/images/d16e1af9-935d-48ab-873c-fd70d619ccb2_13.webp",
    "leather": "/images/b4f6c138-24d0-46a5-a3c7-f75a00aa8ebc_4.webp",
    "padded": "/images/c63b3a4d-a6f6-4442-9719-3dd10520d737_10.webp",
    "plate": "/images/543ccb3f-decd-40a2-a766-90a4e6348896_13.webp",
    "ring mail": "/images/e74bdd5e-3a8a-4922-9736-989b9875b8e7_22.webp",
    "scale mail": "/images/a25ac767-cabb-4cea-b3b1-9048a74d06aa_36.webp",
    "shield": "/images/ec0a89d7-8ac4-4c24-9111-648f28a7caa2_2.webp",
    "splint": "/images/57d70dd8-1f83-40a4-9ac5-a830d622f80e_23.webp",
    "studded leather": "/images/ded987dc-57de-45c8-a4c0-aa68936712cb_15.webp"
  },
  "magicTypes": {
    "potion": "/images/2cc68802-4d01-4feb-8a4d-4604d77af2ed_60.webp",
    "ring": "/images/967cbe3d-ff21-41ae-aa7d-fd4659d949df_15.webp",
    "rod": "/images/37f7e949-c7b6-4361-94c9-2bde00505ce7_6.webp",
    "scroll": "/icons/fantasy/sundries/scrolls/scroll-rolled-tan.webp",
    "staff": "/images/d426416f-0fc3-478b-8e51-1c59b41e7ce1_1.webp",
    "wand": "/images/37f7e949-c7b6-4361-94c9-2bde00505ce7_6.webp",
    "wondrous item": "/icons/fantasy/sundries/artifacts/magic-crystal-orb.webp"
  },
  "keywords": {
    "abacus": "/icons/scifi/sundries/resources/abacus.webp",
    "acid": "/images/3e08d2f7-f8b3-4a33-913b-1b7f1ac0a839_24.webp",
    "alchemist's fire": "/images/67120b6e-1594-46c9-bede-a2fba54ff303_22.webp",
    "alchemist's supplies": "/images/e93b6b21-da81-4630-bbab-920bee669f85_50.webp",
    "ale": "/icons/fantasy/sundries/dwarf-loot/mug-of-frothy-ale.webp",
    "amulet": "/images/cca8e1da-4392-4a76-a07b-dbc4f089a982_19.webp",
    "antitoxin": "/images/1877c51a-9600-49f0-ae4c-31cce6d1882c_46.webp",
    "arcane focus": "/images/f3ee23b9-9524-49ec-aa9a-e164db2dda0c_15.webp",
    "arrow": "/images/5d09ae27-dc14-4565-be57-cb94ef474765_13.webp",
    "arrows": "/images/5d09ae27-dc14-4565-be57-cb94ef474765_13.webp",
    "backpack": "/images/72a2db7e-9d48-4e91-8d34-dd6d23a4910c_84.webp",
    "bag": "/images/94c7b240-9354-4431-8e61-da35fc627d42_11.webp",
    "bagpipes": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "ball bearings": "/images/454b5a95-336e-4c1e-be46-47b87e04e557_34.webp",
    "barrel": "/images/759746aa-6efd-4677-bea6-e44a89c06636_13.webp",
    "basket": "/images/e7e84045-1333-4ca9-b224-045aca727402_38.webp",
    "bead": "/images/0ba5aa51-81f4-4635-95f3-48f1bd2f1438_15.webp",
    "bedroll": "/images/d3be295b-6560-4d23-b227-35de660bc74b_7.webp",
    "bell": "/icons/fantasy/features/classes/bell.webp",
    "belt": "/images/38e8928d-9ae4-4442-b4f8-9db196f9ea56_45.webp",
    "blanket": "/images/cf659174-8e49-49f0-8b1d-1ad0528f62f6_75.webp",
    "block and tackle": "/icons/fantasy/skills/engineering/steel-hook-and-chain.webp",
    "bolt": "/images/985af930-b40d-4516-bd3a-556166af8956_14.webp",
    "bolts": "/images/16c8efd0-5610-42b2-8432-a2847463808e_14.webp",
    "book": "/images/67165b71-6a31-4f6c-aebd-90d35381cd45_67.webp",
    "boots": "/images/19a734b8-59d0-4d19-89f3-7b22245daaaf_28.webp",
    "bottle": "/images/defbbed5-5dc3-4a54-9f19-24f25189049b_17.webp",
    "bracers": "/images/a56d6d65-2f33-4d1a-a462-2a068ca49cf1_36.webp",
    "brewer's supplies": "/images/80bdea01-c699-48ac-94bb-d0d661c32969_16.webp",
    "brooch": "/icons/fantasy/commodities/treasure/brooch-gold-ruby.webp",
    "bucket": "/images/f108c9d7-b9ee-41b9-a53d-2be3e3237e71_42.webp",
    "bullet": "/images/15eba3da-d4b0-45c4-8795-dd4b47770c35_41.webp",
    "bullets": "/images/15eba3da-d4b0-45c4-8795-dd4b47770c35_41.webp",
    "burglar's pack": "/images/b4a480d5-ef17-4b2b-ba02-8757bb51db03_26.webp",
    "calligrapher's supplies": "/images/6ac75df8-6c15-4ab8-89f9-dd7e8198dae4_27.webp",
    "caltrops": "/images/7a309b5d-8067-436e-85a3-cdadc8cb54ec_3.webp",
    "candle": "/icons/fantasy/sundries/kobold-loot/melting-candle-on-saucer.webp",
    "cape": "/images/2a03436b-3e69-49b9-8856-bc91db2bc6bb_9.webp",
    "cards": "/icons/fantasy/sundries/gaming/playing-cards.webp",
    "carpenter's tools": "/images/8e26f49f-c6c9-489e-bcc0-595ff8c2a5ff_3.webp",
    "cartographer's tools": "/images/9fb97d2a-68b4-4daa-bf37-495a3e9aa252_14.webp",
    "chain": "/images/35066ef3-d685-4302-a69c-09dea23dc939_56.webp",
    "chalk": "/icons/fantasy/equipment/adventuring-gear/chalk.webp",
    "chest": "/images/82ea710e-1b5c-4736-b66e-13f0da4de3aa_37.webp",
    "circlet": "/images/98b19d27-baf8-42c4-abce-be08d0090139_32.webp",
    "climber's kit": "/images/6581d07f-183e-41a7-8ee2-93e3cd53f426_36.webp",
    "climbing kit": "/icons/fantasy/equipment/adventuring-gear/climbing-kit.webp",
    "cloak": "/images/3842cff8-7a40-4ef5-ab13-e234bb813f8b_20.webp",
    "clothes": "/images/a6d6ee63-95cc-4718-a5c7-fd0dc9373e51_5.webp",
    "cobbler's tools": "/images/78a13ef1-f958-4346-902e-cd052bd79b7f_17.webp",
    "coin": "/icons/fantasy/commodities/currency/coin-plain-gold.webp",
    "compass": "/icons/fantasy/equipment/adventuring-gear/compass.webp",
    "component": "/icons/fantasy/equipment/adventuring-gear/material-component-pouch.webp",
    "component pouch": "/images/e8453b4d-f283-480a-b593-5d862a8b8df3_35.webp",
    "cook's utensils": "/images/56d3c91f-60d5-4701-ac20-4bd47eb00593_24.webp",
    "costume": "/images/4153d574-3f31-41b3-9458-6fb58f67d66a_38.webp",
    "crossbow bolt": "/images/c57ded23-e2f4-4e56-9dcf-2c5b425795a3_41.webp",
    "crowbar": "/images/1ad2e451-20db-4845-9030-5957b4d51a05_Crowbar.webp",
    "crown": "/icons/fantasy/equipment/head/crown-gold-red.webp",
    "crystal": "/images/f3ee23b9-9524-49ec-aa9a-e164db2dda0c_15.webp",
    "cube": "/icons/fantasy/skills/assorted/magic-puzzle-cube.webp",
    "deck": "/images/2b52342f-980b-44f1-945a-2b4cbf2f624b_21.webp",
    "dice": "/images/7081daed-54fa-4e88-899b-eb423d48246c_21.webp",
    "diplomat's pack": "/images/e9afcfdf-e194-4637-a4b1-874c100266f8_47.webp",
    "disguise kit": "/images/fbd4fc7a-c4eb-47b5-870c-70873e9f797a_47.webp",
    "dragonchess": "/images/7081daed-54fa-4e88-899b-eb423d48246c_21.webp",
    "druidic focus": "/images/d4ee0ef1-42c3-4e3b-b0db-ba2a143878cf_3.webp",
    "drum": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "dulcimer": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "dungeoneer's pack": "/images/f0e27806-fc37-4501-b9bd-360a8edfdca6_26.webp",
    "dust": "/images/ccfee9fb-0cce-475a-9c28-70af4bc492e7_16.webp",
    "emblem": "/images/bf39c307-934b-4a61-b684-04fbdbaae1b7_34.webp",
    "entertainer's pack": "/images/a69dac63-469a-4b66-b1b3-72b69d793a3a_34.webp",
    "explorer's pack": "/images/f0e27806-fc37-4501-b9bd-360a8edfdca6_26.webp",
    "eyes": "/icons/fantasy/tools/scribal/spectacles-glasses.webp",
    "figurine": "/icons/fantasy/commodities/treasure/figurine-dog.webp",
    "flask": "/images/b98c081f-d384-40de-8119-dc084d3671c1_40.webp",
    "flute": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "food": "/icons/fantasy/consumables/food/cheese-wheel-round-yellow.webp",
    "forgery kit": "/images/b83ea3a6-ceb7-4323-84cf-7e52852e6b2b_14.webp",
    "gaming set": "/images/7081daed-54fa-4e88-899b-eb423d48246c_21.webp",
    "gauntlets": "/images/47fd7e11-da2e-4dfa-bafe-13d19eb76276_39.webp",
    "gem": "/images/4b13d1b0-51a1-4be6-9a7e-1681509ee556_80.webp",
    "girdle": "/icons/fantasy/equipment/belts/ornate-golden-belt.webp",
    "glassblower's tools": "/images/0273a633-e690-4ce1-823d-776b30836aae_10.webp",
    "gloves": "/images/426f9a44-ea7d-4786-afa2-18a943c193ea_41.webp",
    "goggles": "/images/2d6a9fcd-2068-4e3d-867e-20e30a37a348_6.webp",
    "grappling hook": "/images/cc48a2e5-7701-401a-9cbe-e3edae23b693_28.webp",
    "hammer": "/icons/fantasy/equipment/adventuring-gear/hammer.webp",
    "hat": "/images/216ec430-8b52-4231-af9c-7ee2569641e1_14.webp",
    "haversack": "/icons/fantasy/containers/bags/satchel-leather-brown.webp",
    "headband": "/images/f32e81d8-b1d1-40f9-9fad-216b0f1a6e98_34.webp",
    "healer's kit": "/images/a8a1b5eb-1c8b-4084-afe0-52850a8dec6c_23.webp",
    "helm": "/images/059202e8-7561-4ab8-8b4a-075bce7e066d_45.webp",
    "herbalism kit": "/images/17461f7f-5d8e-4b4f-bcbd-0868ca082b62_21.webp",
    "holy symbol": "/images/03a3248d-649d-48dd-ab95-842258649df3_94.webp",
    "holy water": "/images/6d806543-20fe-4308-b8ca-7ed707e0d10e_42.webp",
    "horn": "/images/1126eb97-b106-4e90-a40b-f52b1b422b96_18.webp",
    "hourglass": "/icons/fantasy/equipment/adventuring-gear/hourglass.webp",
    "hunting trap": "/images/823d9382-cbc2-482a-95d8-914e6d958578_43.webp",
    "incense": "/images/c0ec3778-3dbe-4487-80d4-29a6a15797eb_Incense.webp",
    "ink": "/images/fe5e64f1-de91-46de-9c56-e142ff2e97b8_40.webp",
    "ink pen": "/images/cd1f41ed-0e77-42df-9ca0-2fd4d5b411d5_InpPen.webp",
    "instrument": "/icons/fantasy/tools/instruments/lute-gold-brown.webp",
    "ioun stone": "/images/0e7bed2a-7cfe-4d1d-aba6-f2c93266a98d_26.webp",
    "jeweler's tools": "/images/fc0ae7e8-5dc8-43a6-908c-9214734a5ba9_47.webp",
    "jug": "/images/f12f1212-300a-40f2-abe9-b4e5a9a8a1ec_39.webp",
    "key": "/icons/fantasy/sundries/keys/antique-key.webp",
    "kit": "/icons/fantasy/equipment/adventuring-gear/repair-kit.webp",
    "ladder": "/icons/fantasy/sundries/misc/ladder-improvised.webp",
    "lamp": "/images/fb332ee9-2377-420d-85da-21f4bdd606fd_92.webp",
    "lantern": "/images/fb332ee9-2377-420d-85da-21f4bdd606fd_92.webp",
    "leatherworker's tools": "/images/3fe412cc-be77-49a2-aa33-60b8eb4653b3_32.webp",
    "lenses": "/icons/fantasy/equipment/worn-items/other-worn-items/basic-corrective-lenses.webp",
    "lock": "/images/9d765816-f487-45d4-ad21-5f08bd5efcbb_49.webp",
    "lute": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "lyre": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "magnifying glass": "/images/98de36ad-bfab-40d0-b8c1-4ebb33fd1cc6_14.webp",
    "manacles": "/images/295b095a-b37c-43b4-b8b9-36cbb3904ece_32.webp",
    "mantle": "/images/743370e4-ad87-42fb-bae0-810cf7eced2a_41.webp",
    "manual": "/images/0a211f69-8ddd-4d9a-be6a-9d847af28fc1_11.webp",
    "map": "/images/a5c54162-a57c-431c-be40-253838b3aef7_15.webp",
    "mask": "/icons/fantasy/equipment/worn-items/other-worn-items/secret-keepers-mask.webp",
    "mason's tools": "/images/16a05b87-1664-4351-a368-34ab9cc8fee5_13.webp",
    "medallion": "/images/1526c9a1-f8af-4d9d-87b5-0e476e107c40_18.webp",
    "mess kit": "/icons/fantasy/equipment/adventuring-gear/cookware.webp",
    "mirror": "/images/584fe7e1-1c31-4b76-99b0-7fd77ad4fdcf_Mirror.webp",
    "mistletoe": "/icons/fantasy/equipment/adventuring-gear/holly-and-mistletoe.webp",
    "musical instrument": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "navigator's tools": "/images/1261d3dd-35ee-4a3e-b4d5-8bb93c9bfd03_24.webp",
    "necklace": "/images/7ba84e13-2936-4aa0-ba31-5bd36c86820b_107.webp",
    "needle": "/images/e78831f5-1687-438a-8440-0784ae735ae4_15.webp",
    "needles": "/images/e78831f5-1687-438a-8440-0784ae735ae4_15.webp",
    "net": "/images/f96c5053-d3a5-42c6-b6be-f2234664f33e_27.webp",
    "oil": "/images/22773f68-e875-4025-93c7-3eee038e4e54_7.webp",
    "orb": "/images/1a9c9d28-a030-4f29-a698-db126e415350_21.webp",
    "painter's supplies": "/images/dde8606f-8d07-42fd-bd04-a341c2c1ff6a_35.webp",
    "pan flute": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "paper": "/images/8b39a1d3-8f35-4de9-bb64-a67d7bb16dac_30.webp",
    "parchment": "/images/8b39a1d3-8f35-4de9-bb64-a67d7bb16dac_30.webp",
    "pendant": "/icons/fantasy/equipment/general/crystal-pendant-necklace.webp",
    "perfume": "/images/8ba5a0c0-f4da-49b8-b83d-39020b359752_20.webp",
    "periapt": "/images/ce7911dd-5f6a-4969-a0a9-6c3e4c292a61_113.webp",
    "philter": "/images/9aec1a8b-e5ea-479b-8787-d092d224ae78_10.webp",
    "piton": "/icons/fantasy/equipment/adventuring-gear/piton.webp",
    "playing card": "/icons/fantasy/sundries/gaming/playing-cards.webp",
    "playing cards": "/images/7081daed-54fa-4e88-899b-eb423d48246c_21.webp",
    "poison": "/images/cb4b6d44-5845-4235-bd91-73e82bd269f6_50.webp",
    "poisoner's kit": "/images/68767b00-7cec-4309-93b2-5595edb83bee_6.webp",
    "pole": "/images/1a8d5490-ba41-4b51-94d3-06913322cfd3_Pole.webp",
    "pot": "/images/ae23b2b6-70af-4ad7-8d55-94787b868670_24.webp",
    "potion": "/images/403c9039-db76-4f1e-b054-5591a882428a_66.webp",
    "potter's tools": "/images/e502989b-fde5-4fdb-989c-3bb18e8aca28_22.webp",
    "pouch": "/images/4f51a6cd-ae89-4933-984e-9f0d8cfc1fa1_28.webp",
    "priest's pack": "/images/e9afcfdf-e194-4637-a4b1-874c100266f8_47.webp",
    "quill": "/icons/fantasy/tools/scribal/ink-quill-red.webp",
    "quiver": "/images/17f04a99-731c-4b2e-a5f4-ea1a10d974e7_50.webp",
    "ram": "/icons/fantasy/equipment/held-items/portable-ram.webp",
    "ration": "/icons/fantasy/equipment/adventuring-gear/rations.webp",
    "rations": "/images/045c6cb1-3a77-4d15-a6b3-0045b64c0485_21.webp",
    "reliquary": "/images/03a3248d-649d-48dd-ab95-842258649df3_94.webp",
    "ring": "/images/dad0f1a6-952d-47e0-acdb-b13a55771287_94.webp",
    "robe": "/images/e0d44362-02f3-4649-bc73-1ee101206c76_45.webp",
    "rod": "/images/42879e3b-c720-40a1-9e96-70982cf82b64_82.webp",
    "rope": "/images/7a94d8cc-ce49-445f-bd89-ba02f6feac34_10.webp",
    "sack": "/images/958ffb77-3e19-41ba-872e-6da6875a7af0_26.webp",
    "saddle": "/images/182b6379-b29d-436d-a0fc-c35b7676f230_Saddle.webp",
    "scale": "/icons/fantasy/equipment/adventuring-gear/merchant-scale.webp",
    "scholar's pack": "/images/e9afcfdf-e194-4637-a4b1-874c100266f8_47.webp",
    "shawm": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "shovel": "/images/fe5c5b65-c202-4933-bd17-0fd361616ac8_6.webp",
    "signal whistle": "/images/e717da71-d287-4b33-9d1c-dcb54ccf2e5e_Whistle.webp",
    "signet": "/icons/fantasy/equipment/finger/ring-signet-silver.webp",
    "slippers": "/images/c1365e89-2a2d-4a68-9deb-a0b740513dc9_21.webp",
    "smith's tools": "/images/f7888875-61fe-4982-ab97-a66c84c672c5_9.webp",
    "soap": "/icons/fantasy/equipment/adventuring-gear/soap.webp",
    "spellbook": "/images/a2d94ef6-22d0-4392-94a5-fac012323cdf_2.webp",
    "sphere": "/icons/fantasy/magic/unholy/orb-glowing-purple.webp",
    "spike": "/images/f109abd3-2b74-4ee8-a096-4dec05b07ca0_Spike.webp",
    "spikes": "/images/f109abd3-2b74-4ee8-a096-4dec05b07ca0_Spike.webp",
    "sprig of mistletoe": "/images/93222432-b9ba-4af7-af97-8978fc58536b_7.webp",
    "spyglass": "/images/3a41a989-82ba-4689-bb14-a14f7c244ee1_29.webp",
    "staff": "/images/ef81af4c-79b9-40f2-8900-6c94ab9e949f_32.webp",
    "stone": "/images/e465c8ec-f998-40cb-b40c-da02bd1061a4_41.webp",
    "string": "/images/61b34667-4224-40a5-984e-ddb20e22a51b_47.webp",
    "supplies": "/icons/fantasy/equipment/adventuring-gear/artisan-tools.webp",
    "tent": "/images/b8186366-a435-4240-975d-6e680324f052_Tent.webp",
    "thieves' tools": "/images/14f230a7-b405-41da-8a1e-eb4b37444a3f_32.webp",
    "three-dragon ante": "/images/7081daed-54fa-4e88-899b-eb423d48246c_21.webp",
    "tinderbox": "/images/da13238a-e606-48f5-ad38-d89b5bbb36d0_83.webp",
    "tinker's tools": "/images/fee1f294-681f-4649-9fc6-fd7ce7dcb5c0_13.webp",
    "tome": "/images/af65e3c3-d780-4f9d-84d3-4be147ae107b_9.webp",
    "tools": "/icons/fantasy/equipment/adventuring-gear/artisan-tools.webp",
    "torch": "/images/feb99532-03ea-4683-aacb-ba385f676e32_33.webp",
    "totem": "/icons/fantasy/commodities/treasure/totem-wood-face-brown.webp",
    "vial": "/images/cf57d4ca-af64-49ca-84ed-36948d237e12_6.webp",
    "viol": "/images/a68f30ab-4a07-4073-b6a2-4e0eb0af98a9_skill_icon_28.webp",
    "wand": "/images/54e1363b-6a3a-4923-b74a-d9dcad173e2f_38.webp",
    "waterskin": "/images/6df51e5b-ecc5-494d-b4bc-bd7865786f30_48-2.webp",
    "weaver's tools": "/images/112c1baf-4358-4598-bff1-5e126d6fc348_18.webp",
    "whistle": "/icons/fantasy/equipment/adventuring-gear/whistle.webp",
    "wine": "/icons/fantasy/consumables/drinks/wine-bottle-glass-white.webp",
    "woodcarver's tools": "/images/ac0c0384-5454-4453-a082-b25656dfb462_72.webp",
    "yew wand": "/images/d4ee0ef1-42c3-4e3b-b0db-ba2a143878cf_3.webp"
  },
  "spellSchools": {
    "abjuration": "/icons/fantasy/features/classes/abjuration.webp",
    "conjuration": "/icons/fantasy/features/classes/conjuration.webp",
    "divination": "/icons/fantasy/features/classes/divination.webp",
    "enchantment": "/icons/fantasy/features/classes/enchantment.webp",
    "evocation": "/icons/fantasy/features/classes/evocation.webp",
    "illusion": "/icons/fantasy/features/classes/illusion.webp",
    "necromancy": "/icons/fantasy/features/classes/necromancy.webp",
    "transmutation": "/icons/fantasy/features/classes/transmutation.webp"
  },
  "fallbacks": {
    "ammunition": "/images/69953a7f-ecf7-464b-a07c-967faa0e7593_13.webp",
    "armor": "/images/ce41ca01-0582-4e2d-83b9-35cd4cd6b0ca_17.webp",
    "class feature": "/icons/fantasy/default-icons/class.svg",
    "feat": "/icons/fantasy/default-icons/feats.webp",
    "gear": "/icons/fantasy/default-icons/backpack.webp",
    "item": "/icons/fantasy/default-icons/equipment.webp",
    "magic item": "/icons/fantasy/default-icons/treasure.webp",
    "racial trait": "/icons/fantasy/default-icons/ancestry.svg",
    "spell": "/icons/fantasy/default-icons/spell.webp",
    "weapon": "/images/31580a58-ec0c-41c4-86e3-b44c5bbafed5_2.webp"
  }
};

function ddbIconLookup(section, key) {
  var table = DDB_ICON_MAP[section] || {};
  return key ? table[String(key).toLowerCase()] : undefined;
}

// Longest keyword first so "studded leather" wins over "leather" and "holy water"
// over "water". Matches whole words, allowing a plural "s".
var DDB_ICON_KEYWORDS = Object.keys(DDB_ICON_MAP.keywords || {}).sort(
  function (a, b) {
    return b.length - a.length;
  },
);
var DDB_ARMOR_KEYS = Object.keys(DDB_ICON_MAP.armor || {}).sort(function (a, b) {
  return b.length - a.length;
});
function ddbNameHasWord(name, word) {
  var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z])" + escaped + "s?([^a-z]|$)").test(name);
}

function ddbIconForItem(def, extraData, isShield) {
  var name = String(def.name || "").toLowerCase();
  var icon;
  if (extraData.weaponType) icon = ddbIconLookup("weapons", extraData.weaponType);
  if (!icon && isShield) icon = ddbIconLookup("armor", "shield");
  if (!icon && extraData.type === "armor") {
    var armorName = String(def.baseArmorName || def.name || "").toLowerCase();
    for (var a = 0; a < DDB_ARMOR_KEYS.length && !icon; a++) {
      if (DDB_ARMOR_KEYS[a] !== "shield" && ddbNameHasWord(armorName, DDB_ARMOR_KEYS[a])) {
        icon = DDB_ICON_MAP.armor[DDB_ARMOR_KEYS[a]];
      }
    }
  }
  for (var k = 0; k < DDB_ICON_KEYWORDS.length && !icon; k++) {
    if (ddbNameHasWord(name, DDB_ICON_KEYWORDS[k])) {
      icon = DDB_ICON_MAP.keywords[DDB_ICON_KEYWORDS[k]];
    }
  }
  if (!icon) icon = ddbIconLookup("magicTypes", def.type || def.filterType);
  if (!icon) {
    var fallbackKey = "gear";
    if (/weapon/.test(extraData.type || "")) fallbackKey = "weapon";
    else if (extraData.type === "armor" || extraData.type === "shield")
      fallbackKey = "armor";
    else if (extraData.subtype === "Ammunition") fallbackKey = "ammunition";
    else if (def.magic) fallbackKey = "magic item";
    icon =
      ddbIconLookup("fallbacks", fallbackKey) || ddbIconLookup("fallbacks", "item");
  }
  return icon;
}

// ===== Item name alternates =====
// DDB and the Realm compendium name items differently ("Leather" vs "Leather
// Armor", "Belt of Hill Giant Strength" vs "Belt of Giant Strength, Hill"). These
// are tried in order when the DDB name doesn't match, so the compendium record
// (and its art and stats) is found. Only exact renames: nothing that drops a word,
// so a "Moon Sickle, +2" never resolves to a plain "Sickle, +2".
var DDB_ARMOR_RENAMES = {
  padded: "Padded Armor",
  leather: "Leather Armor",
  "studded leather": "Studded Leather Armor",
  hide: "Hide Armor",
  "half plate": "Half Plate Armor",
  splint: "Splint Armor",
  plate: "Plate Armor",
};
var DDB_ITEM_RENAMES = {
  crystal: "Arcane Focus, Crystal",
  orb: "Arcane Focus, Orb",
  rod: "Arcane Focus, Rod",
  staff: "Arcane Focus, Staff",
  wand: "Arcane Focus, Wand",
  "sprig of mistletoe": "Druidic Focus, Sprig of mistletoe",
  "yew wand": "Druidic Focus, Yew wand",
  "wooden staff": "Druidic Focus",
  totem: "Druidic Focus",
  amulet: "Holy Symbol, Amulet",
  emblem: "Holy Symbol, Emblem",
  reliquary: "Holy Symbol, Reliquary",
  "dice set": "Gaming Set, Dice",
  "playing card set": "Gaming Set, Playing Cards",
  "dragonchess set": "Gaming Set, Dragonchess",
  "three-dragon ante set": "Gaming Set, Three-Dragon Ante",
  "crossbow bolts": "Bolts, 20",
  "sling bullets": "Bullets, Sling, 20",
  "blowgun needles": "Needles, 50",
  "rope, hempen": "Rope",
  "rope, silk": "Rope",
  "clothes, travelers": "Clothes, Traveler's",
  "hooded lantern": "Lantern, Hooded",
  "bullseye lantern": "Lantern, Bullseye",
  "iron pot": "Pot, Iron",
  "glass bottle": "Bottle, Glass",
  "iron spikes": "Spikes, Iron, 10",
  "map or scroll case": "Case, Map or Scroll",
  "crossbow bolt case": "Case, Crossbow Bolt",
  "basic poison": "Poison, Basic",
  "portable ram": "Ram, Portable",
  "traveler's clothes": "Clothes, Traveler's",
  "fine clothes": "Clothes, Fine",
};
var DDB_INSTRUMENTS = [
  "bagpipes",
  "drum",
  "dulcimer",
  "flute",
  "horn",
  "lute",
  "lyre",
  "pan flute",
  "shawm",
  "viol",
];

function ddbItemAlternateNames(def, isShield) {
  var name = String(def.name || "").trim();
  var alts = [];
  function add(n) {
    if (n && n !== name && alts.indexOf(n) === -1) alts.push(n);
  }
  function renameBase(base) {
    var lower = base.toLowerCase();
    if (def.filterType === "Armor" && !isShield && DDB_ARMOR_RENAMES[lower]) {
      return DDB_ARMOR_RENAMES[lower];
    }
    return base;
  }

  // Quantity in parentheses: "Arrows (20)" -> "Arrows, 20"
  var noParens = name.replace(/\s*\(([^)]*)\)\s*$/, "");
  var paren = (name.match(/\(([^)]*)\)\s*$/) || [])[1];
  var lowerBase = noParens.toLowerCase();
  if (DDB_ITEM_RENAMES[lowerBase]) add(DDB_ITEM_RENAMES[lowerBase]);
  if (DDB_INSTRUMENTS.indexOf(lowerBase) !== -1) {
    add("Musical Instrument, " + noParens);
  }
  if (paren && /^\d+$/.test(paren.trim())) add(noParens + ", " + paren.trim());
  // "Arcane Focus (Crystal)" -> "Arcane Focus, Crystal"; skip "(50 feet)"
  else if (paren && !/\d/.test(paren)) add(noParens + ", " + paren.trim());

  // +N in any position: "+1 Leather", "Leather +1", "Leather, +1" -> "Leather Armor, +1"
  var plus = name.match(/(^|[\s,])\+(\d)\b/);
  if (plus) {
    var base = name
      .replace(/(^|[\s,])\+\d\b/, " ")
      .replace(/[\s,]+$/, "")
      .replace(/^[\s,]+/, "")
      .replace(/\s{2,}/g, " ");
    add(renameBase(base) + ", +" + plus[2]);
  } else {
    // Plain armor: "Leather" -> "Leather Armor"; "Leather of Resistance" too
    var ofMatch = name.match(/^(.*?)( (of|Armor of) .*)$/);
    if (ofMatch) {
      var renamed = renameBase(ofMatch[1]);
      if (renamed !== ofMatch[1]) add(renamed + " of " + ofMatch[2].replace(/^ (Armor )?of /, ""));
    } else {
      add(renameBase(name));
    }
  }

  // "Belt of Hill Giant Strength" -> "Belt of Giant Strength, Hill"
  var giant = name.match(/^Belt of (\w+) Giant Strength$/i);
  if (giant) add("Belt of Giant Strength, " + giant[1]);
  // "Potion of Greater Healing" -> "Potion of Healing (Greater)"
  var healing = name.match(/^Potion of (Greater|Superior|Supreme) Healing$/i);
  if (healing) add("Potion of Healing (" + healing[1] + ")");
  // "Flame Tongue Longsword" / "Longsword of Warning" style is already Realm's
  // "<Weapon>, <Property>" when the weapon comes first; flip "<Property> <Weapon>".
  var weaponType = def.baseItemName || "";
  if (!weaponType && def.filterType === "Weapon") weaponType = def.type || "";
  if (weaponType && name.length > weaponType.length) {
    var wt = weaponType.toLowerCase();
    var lowerName = name.toLowerCase();
    if (lowerName.slice(-wt.length - 1) === " " + wt) {
      add(weaponType + ", " + name.slice(0, name.length - wt.length - 1));
    }
  }
  return alts;
}

function ddbIconForSpell(def) {
  return (
    ddbIconLookup("spellSchools", def.school) ||
    ddbIconLookup("fallbacks", "spell")
  );
}

var _pendingRecords = [];

// Items -> data.inventory
// Build a map of container item IDs to their names for location tracking
var containerMap = {};
var characterEntityId = ddb.id;
(ddb.inventory || []).forEach(function (item) {
  if (item.definition && item.definition.isContainer) {
    containerMap[item.id] = item.definition.name;
  }
});

// Translate a DDB item's grantedModifiers (the magic bonuses baked into the item
// definition) into Realm item modifier records stored on data.modifiers. Realm
// needs these as data.modifiers so the bonus applies at roll time and re-applies
// whenever the sheet recalculates — DDB's flat numbers alone wouldn't survive.
// Realm gates every item modifier on equipped (and attuned, for attunement items).
//
// Covered: AC, saves, +N weapons ("magic" -> attack + damage on that weapon only),
// spell attack / spell save DC (including class-scoped "druid-spell-attacks"),
// melee/ranged attack bonuses, initiative, speed, skills, passives, ability score
// bonus/set, HP per level, senses, resistances/immunities/vulnerabilities, and
// advantage/disadvantage on skills, saves and initiative.

// Lowercased names of the character's spellcasting classes (a subclass that casts,
// like Eldritch Knight, counts as its class). Class-scoped spell bonuses only need
// a spell-list predicate when the character casts from a class outside the item's.
var casterClassNames = [];
(ddb.classes || []).forEach(function (cls) {
  var name = ((cls.definition && cls.definition.name) || "").toLowerCase();
  var casts =
    (cls.definition && cls.definition.canCastSpells) ||
    (cls.subclassDefinition && cls.subclassDefinition.canCastSpells);
  if (name && casts && casterClassNames.indexOf(name) === -1) {
    casterClassNames.push(name);
  }
});

// ABILITY_NAMES is the common.js global (the six ability names, lowercase).
var SENSE_SUBTYPES = ["darkvision", "blindsight", "tremorsense", "truesight"];
var ATTACK_FIELD_MAP = {
  "melee-attacks": "melee",
  "melee-weapon-attacks": "melee",
  "ranged-attacks": "ranged",
  "ranged-weapon-attacks": "ranged",
};
var DEFENSE_TYPE_MAP = {
  resistance: "resistance",
  immunity: "immunity",
  vulnerability: "vulnerability",
};

function translateItemModifiers(def, itemId, isWeapon) {
  var out = [];
  var classSpellGroups = {};
  var classSpellGroupOrder = [];

  function push(data, suffix, itemOnly) {
    if (itemOnly) data.itemOnly = true;
    if (data.active === undefined) data.active = true;
    out.push({
      _id: "import-item-" + itemId + "-mod-" + suffix,
      name: "New Modifier",
      unidentifiedName: "Modifier",
      recordType: "records",
      identified: true,
      data: data,
      fields: {
        itemOnly: { hidden: false },
      },
    });
  }

  (def.grantedModifiers || []).forEach(function (gm, gIdx) {
    if (!gm || !gm.type || !gm.subType) return;
    var sub = gm.subType;
    var num = gm.value != null ? gm.value : gm.fixedValue;
    var restriction = (gm.restriction || "").trim();
    // A conditional advantage ("against being frightened") becomes a roll-time
    // toggle instead of always-on. "While holding/wearing" is satisfied by the
    // equip gate, so it stays on.
    var conditional = restriction !== "" && !/^while\b/i.test(restriction);

    if (gm.type === "bonus") {
      if (num == null) return;
      var value = "" + num;

      if (sub === "armor-class") {
        push({ type: "armorClassBonus", valueType: "number", value: value }, gIdx);
      } else if (sub === "saving-throws") {
        push({ type: "saveBonus", valueType: "number", value: value }, gIdx);
      } else if (
        ABILITY_NAMES.indexOf(sub.replace("-saving-throws", "")) !== -1 &&
        /-saving-throws$/.test(sub)
      ) {
        push(
          {
            type: "saveBonus",
            field: sub.replace("-saving-throws", ""),
            valueType: "number",
            value: value,
          },
          gIdx,
        );
      } else if (sub === "magic") {
        // +N weapon: attack and damage on THIS weapon only (no field + itemOnly).
        if (!isWeapon) return;
        push(
          { type: "attackBonus", valueType: "number", value: value },
          gIdx + "-atk",
          true,
        );
        push(
          { type: "damageBonus", valueType: "number", value: value },
          gIdx + "-dmg",
          true,
        );
      } else if (sub === "spell-attacks") {
        push({ type: "spellAttackBonus", valueType: "number", value: value }, gIdx);
      } else if (sub === "spell-save-dc") {
        push({ type: "spellDCBonus", valueType: "number", value: value }, gIdx);
      } else if (/^[a-z]+-spell-(attacks|save-dc)$/.test(sub)) {
        // Class-scoped ("druid-spell-attacks", "ranger-spell-save-dc"). DDB lists
        // one modifier per class; group them so a Moon Sickle's druid + ranger
        // +2 becomes a single +2 rather than +4.
        var className = sub.split("-")[0];
        var kind = /-attacks$/.test(sub) ? "spellAttackBonus" : "spellDCBonus";
        var key = kind + ":" + value;
        if (!classSpellGroups[key]) {
          classSpellGroups[key] = {
            kind: kind,
            value: value,
            classes: [],
            idx: gIdx,
          };
          classSpellGroupOrder.push(key);
        }
        if (classSpellGroups[key].classes.indexOf(className) === -1) {
          classSpellGroups[key].classes.push(className);
        }
      } else if (ATTACK_FIELD_MAP[sub]) {
        push(
          {
            type: "attackBonus",
            field: ATTACK_FIELD_MAP[sub],
            valueType: "number",
            value: value,
          },
          gIdx,
        );
      } else if (sub === "initiative") {
        push({ type: "initiativeBonus", valueType: "number", value: value }, gIdx);
      } else if (sub === "speed" || sub === "speed-walking") {
        push({ type: "speedBonus", valueType: "number", value: value }, gIdx);
      } else if (/^passive-/.test(sub) && SKILL_MAP[sub.replace("passive-", "")]) {
        push(
          {
            type: "passiveBonus",
            field: SKILL_MAP[sub.replace("passive-", "")],
            valueType: "number",
            value: value,
          },
          gIdx,
        );
      } else if (SKILL_MAP[sub]) {
        push(
          {
            type: "skillBonus",
            field: SKILL_MAP[sub],
            valueType: "number",
            value: value,
          },
          gIdx,
        );
      } else if (
        /-score$/.test(sub) &&
        ABILITY_NAMES.indexOf(sub.replace("-score", "")) !== -1
      ) {
        push(
          {
            type: "attributeBonus",
            field: sub.replace("-score", ""),
            valueType: "number",
            value: value,
          },
          gIdx,
        );
      } else if (sub === "hit-points-per-level") {
        // One "+level" hitpoints modifier per point. Never itemOnly: HP is
        // recomputed without an itemId, which would drop an itemOnly modifier.
        for (var h = 0; h < num; h++) {
          push(
            { type: "hitpoints", valueType: "field", value: "level" },
            gIdx + "-hppl-" + h,
          );
        }
      }
    } else if (gm.type === "advantage" || gm.type === "disadvantage") {
      var rollValue = gm.type;
      var base = { valueType: "string", value: rollValue };
      if (conditional) base.active = false;
      if (sub === "initiative") {
        base.type = "initiativeBonus";
      } else if (SKILL_MAP[sub]) {
        base.type = "skillBonus";
        base.field = SKILL_MAP[sub];
      } else if (sub === "saving-throws") {
        base.type = "saveBonus";
      } else if (
        /-saving-throws$/.test(sub) &&
        ABILITY_NAMES.indexOf(sub.replace("-saving-throws", "")) !== -1
      ) {
        base.type = "saveBonus";
        base.field = sub.replace("-saving-throws", "");
      } else {
        return;
      }
      push(base, gIdx);
    } else if (gm.type === "set") {
      if (
        num != null &&
        /-score$/.test(sub) &&
        ABILITY_NAMES.indexOf(sub.replace("-score", "")) !== -1
      ) {
        push(
          {
            type: "attributeSet",
            field: sub.replace("-score", ""),
            valueType: "number",
            value: "" + num,
          },
          gIdx,
        );
      }
    } else if (gm.type === "sense") {
      if (num == null || SENSE_SUBTYPES.indexOf(sub) === -1) return;
      var senseName = sub.charAt(0).toUpperCase() + sub.slice(1);
      // "+N/N" extends an existing sense or grants it at N (Goggles of Night).
      var senseValue = /already/i.test(restriction)
        ? senseName + " +" + num + "/" + num
        : senseName + " " + num;
      push({ type: "senses", valueType: "string", value: senseValue }, gIdx);
    } else if (DEFENSE_TYPE_MAP[gm.type]) {
      push(
        {
          type: DEFENSE_TYPE_MAP[gm.type],
          valueType: "string",
          value: sub,
        },
        gIdx,
      );
    }
  });

  classSpellGroupOrder.forEach(function (key) {
    var group = classSpellGroups[key];
    var data = { type: group.kind, valueType: "number", value: group.value };
    var allCastersCovered = casterClassNames.every(function (c) {
      return group.classes.indexOf(c) !== -1;
    });
    if (!allCastersCovered) {
      // Multiclass with a class outside the item's: limit to that class's spells.
      var preds = group.classes.map(function (c) {
        return "spell:" + c;
      });
      data.predicate =
        preds.length === 1 ? preds[0] : JSON.stringify({ or: preds });
    }
    push(data, group.idx + "-" + group.kind);
  });

  return out;
}

// DDB weapon property IDs -> Realm property names
var WEAPON_PROPERTY_MAP = {
  Ammunition: "Ammunition",
  Finesse: "Finesse",
  Heavy: "Heavy",
  Light: "Light",
  Loading: "Loading",
  Range: "Range",
  Reach: "Reach",
  Thrown: "Thrown",
  "Two-Handed": "Two-Handed",
  Versatile: "Versatile",
};

// Track the best equipped armor/shield as we build inventory. The sheet's AC
// recalc (recalcACAndHP) reads the derived data.armor object — NOT the inventory
// items — so without setting it here, the first dex change recomputes AC with no
// armor base until the user re-toggles equip. Mirror getBestEquippedArmor()'s shape:
// { ac, maxDex (0=heavy/none, 99=light/uncapped), shieldAc, stealthPenalty }.
var bestEquippedArmorObj = { ac: 0, maxDex: 0, shieldAc: 0, stealthPenalty: false };

// DDB item definition id -> [{ item, extraData }] for each inventory copy, so the
// item's spells (ddb.spells.item, keyed by componentId = definition id) can be
// attached to it in section 9b.
var itemExtraDataByDefId = {};

(ddb.inventory || []).forEach(function (item) {
  var def = item.definition || {};
  var filterType = def.filterType || "Other Gear";
  // DDB files magic staves under filterType "Staff" with no weapon stats, but
  // the ones that grant a weapon bonus are wielded as a magic Quarterstaff.
  var isQuarterstaffStaff =
    filterType === "Staff" &&
    ((def.grantedModifiers || []).some(function (gm) {
      return gm && gm.type === "bonus" && gm.subType === "magic";
    }) ||
      /quarterstaff/i.test(def.description || ""));
  var isWeapon = filterType === "Weapon" || isQuarterstaffStaff;
  var isShield = isShieldDef(def);
  var type = "gear";
  if (isWeapon) type = "melee weapon";
  if (filterType === "Armor") {
    type = isShield ? "shield" : "armor";
  }
  if (def.attackType === 2) type = "ranged weapon";

  // Determine subtype from DDB type field
  var subtype = "";
  if (filterType === "Weapon") {
    // For weapons def.type is the base weapon ("Sickle"); Realm's subtype is the
    // category. categoryId: 1 = simple, 2 = martial.
    subtype =
      (def.categoryId === 2 ? "Martial " : "Simple ") +
      (def.attackType === 2 ? "Ranged" : "Melee") +
      " Weapon";
  } else if (def.type) {
    // DDB types like "Potion", "Ring", "Rod", "Scroll", "Staff", "Wand", "Wondrous Item"
    // Also "Light Armor", "Medium Armor", "Heavy Armor" for armor
    subtype = def.type;
  }
  // For ammo, override subtype
  if (def.filterType === "Other Gear" && def.subType === "Ammunition") {
    subtype = "Ammunition";
  }

  // Determine location — if containerEntityId matches a container item, set location
  var location = "";
  if (item.containerEntityId && item.containerEntityId !== characterEntityId) {
    location = containerMap[item.containerEntityId] || "";
  }

  // extraData is shallow-merged OVER a matched compendium record, so only send
  // values DDB actually has. Empty placeholders (damage "", weight 0, "0 gp")
  // would otherwise wipe the compendium's real stats (Staff of the Woodlands
  // lost its 1d6 damage and 4 lb weight this way).
  var extraData = {
    count: item.quantity || 1,
    carried: item.equipped ? "equipped" : "",
    type: type,
  };
  if (def.weight) extraData.weight = def.weight;
  if (def.damage && def.damage.diceString) {
    extraData.damage = def.damage.diceString + " " + (def.damageType || "");
  }
  if (def.cost) extraData.cost = def.cost + " gp";
  if (def.description) extraData.description = def.description;
  if (location) extraData.location = location;

  if (subtype) {
    extraData.subtype = subtype;
  }

  if (isQuarterstaffStaff) {
    extraData.weaponType = "Quarterstaff";
    extraData.weaponMastery = "Topple";
    extraData.weaponProperties = ["Versatile"];
    if (!extraData.damage) extraData.damage = "1d6 bludgeoning";
    extraData.versatileDamage = "1d8 bludgeoning";
  }

  // Weapon-specific fields
  if (filterType === "Weapon") {
    // Weapon type (base weapon name for mastery system, e.g., "Longsword", "Shortbow")
    // DDB provides baseItemName for the base weapon type (like baseArmorName for armor).
    // For non-magic items, def.name IS the weapon type.
    // For magic items (e.g., "Flame Tongue"), baseItemName maps back to the base weapon,
    // or def.type carries it ("Moon Sickle, +2" has type "Sickle").
    var weaponTypeName = def.baseItemName || def.name || "";
    // Validate against known weapon types — only set if it matches a Realm dropdown value
    var KNOWN_WEAPONS = [
      "Club",
      "Dagger",
      "Greatclub",
      "Handaxe",
      "Javelin",
      "Light Hammer",
      "Mace",
      "Quarterstaff",
      "Sickle",
      "Spear",
      "Dart",
      "Light Crossbow",
      "Shortbow",
      "Sling",
      "Battleaxe",
      "Flail",
      "Glaive",
      "Greataxe",
      "Greatsword",
      "Halberd",
      "Lance",
      "Longsword",
      "Maul",
      "Morningstar",
      "Pike",
      "Rapier",
      "Scimitar",
      "Shortsword",
      "Trident",
      "Warhammer",
      "War Pick",
      "Whip",
      "Blowgun",
      "Hand Crossbow",
      "Heavy Crossbow",
      "Longbow",
      "Musket",
      "Pistol",
    ];
    if (
      KNOWN_WEAPONS.indexOf(weaponTypeName) === -1 &&
      KNOWN_WEAPONS.indexOf(def.type) !== -1
    ) {
      weaponTypeName = def.type;
    }
    if (KNOWN_WEAPONS.indexOf(weaponTypeName) !== -1) {
      extraData.weaponType = weaponTypeName;
    }

    // Weapon properties (Finesse, Heavy, Light, etc.). DDB lists the 2024 mastery
    // ("Nick", "Topple") alongside them.
    var WEAPON_MASTERIES = [
      "Cleave",
      "Graze",
      "Nick",
      "Push",
      "Sap",
      "Slow",
      "Topple",
      "Vex",
    ];
    var weaponProps = [];
    (def.properties || []).forEach(function (prop) {
      var name = prop.name || "";
      if (WEAPON_PROPERTY_MAP[name]) {
        weaponProps.push(WEAPON_PROPERTY_MAP[name]);
      } else if (WEAPON_MASTERIES.indexOf(name) !== -1) {
        extraData.weaponMastery = name;
      }
    });
    if (weaponProps.length > 0) {
      extraData.weaponProperties = weaponProps;
    }

    // Range — DDB uses flat numbers for weapons (not range objects like spells)
    if (def.range && typeof def.range === "number") {
      extraData.normalRange = def.range;
    }
    if (def.longRange && typeof def.longRange === "number") {
      extraData.maxRange = def.longRange;
    }

    // Versatile damage — DDB stores it in the Versatile property's notes field (e.g., "1d10")
    if (def.properties) {
      var versatileProp = def.properties.find(function (p) {
        return p.name === "Versatile";
      });
      if (versatileProp) {
        var versatileNotes = versatileProp.notes || "";
        if (versatileNotes) {
          extraData.versatileDamage =
            versatileNotes + " " + (def.damageType || "");
        }
      }
    }
  }

  // Armor/shield-specific fields from DDB
  // armorTypeId: 1=Light, 2=Medium, 3=Heavy
  // stealthCheck: 1=normal, 2=disadvantage
  if (filterType === "Armor") {
    if (def.armorClass) {
      extraData.armorClass = def.armorClass;
    }
    if (!isShield) {
      var ARMOR_CATEGORY_MAP = { 1: "Light", 2: "Medium", 3: "Heavy" };
      extraData.armorCategory = ARMOR_CATEGORY_MAP[def.armorTypeId] || "";
      // Light: full DEX, Medium: DEX capped at +2, Heavy: no DEX
      if (def.armorTypeId === 1) {
        extraData.addDex = true;
      } else if (def.armorTypeId === 2) {
        extraData.addDex = true;
        extraData.maxDex = 2;
      } else if (def.armorTypeId === 3) {
        extraData.addDex = false;
        extraData.maxDex = 0;
      }
      extraData.stealth = def.stealthCheck === 2 ? "disadvantage" : "none";
    }
    if (def.strengthRequirement) {
      extraData.strength = def.strengthRequirement;
    }
  }

  // Consumable items (potions, scrolls, etc.)
  if (def.isConsumable) {
    extraData.consumable = true;
  }

  // Rarity — Realm uses lowercase values
  if (def.rarity && def.rarity !== "Common") {
    extraData.rarity = def.rarity.toLowerCase();
  }

  // Attunement — mirror DDB. Realm applies the item's modifiers only while it is
  // equipped and (for attunement items) attuned, same as DDB.
  if (def.canAttune) {
    extraData.attunement = true;
    extraData.attuned = item.isAttuned ? "true" : "false";
  }

  // Magic-item modifiers from grantedModifiers. These replace the compendium
  // item's modifiers when it matches; DDB is the record of what this copy does.
  var itemModifiers = translateItemModifiers(def, item.id, isWeapon);
  if (itemModifiers.length > 0) {
    extraData.modifiers = itemModifiers;
  }

  // Roll this item into the derived data.armor object if it's equipped armor/shield.
  // ac is the armor's BASE AC (the magic +1/+2/+3 is applied separately as an
  // armorClassBonus modifier), matching how getBestEquippedArmor() reads the item.
  if (item.equipped && type === "armor" && extraData.armorClass) {
    if (extraData.armorClass > bestEquippedArmorObj.ac) {
      bestEquippedArmorObj.ac = extraData.armorClass;
      bestEquippedArmorObj.maxDex = extraData.addDex
        ? extraData.maxDex != null
          ? extraData.maxDex
          : 99
        : 0;
      bestEquippedArmorObj.stealthPenalty = extraData.stealth === "disadvantage";
    }
  } else if (item.equipped && type === "shield" && extraData.armorClass) {
    if (extraData.armorClass > bestEquippedArmorObj.shieldAc) {
      bestEquippedArmorObj.shieldAc = extraData.armorClass;
    }
  }

  var itemIcon = ddbIconForItem(def, extraData, isShield);
  if (itemIcon) extraData.ddbIcon = itemIcon;

  if (def.id != null) {
    (itemExtraDataByDefId[def.id] = itemExtraDataByDefId[def.id] || []).push({
      item: item,
      extraData: extraData,
    });
  }

  var itemPending = {
    recordType: "items",
    targetPath: "data.inventory",
    name: def.name || "Unknown Item",
    extraData: extraData,
  };
  var itemAlternates = ddbItemAlternateNames(def, isShield);
  if (itemAlternates.length > 0) itemPending.alternateNames = itemAlternates;
  _pendingRecords.push(itemPending);
});

// Persist the derived armor object so AC recalcs (on dex change, etc.) have the
// correct armor base immediately — without requiring the user to re-equip.
charData.armor = bestEquippedArmorObj;

// Custom items (user-created entries like "Contact: Guide", "Drone Blueprint").
// These have no definition — just a name, quantity, weight, cost, and description.
(ddb.customItems || []).forEach(function (item) {
  _pendingRecords.push({
    recordType: "items",
    targetPath: "data.inventory",
    name: item.name || "Custom Item",
    extraData: {
      count: item.quantity || 1,
      weight: item.weight || 0,
      cost: (item.cost || 0) + " gp",
      description: item.description || item.notes || "",
      type: "gear",
      ddbIcon: ddbIconForItem({ name: item.name }, { type: "gear" }, false),
    },
  });
});

// Classes -> data.classes
(ddb.classes || []).forEach(function (cls) {
  var def = cls.definition || {};
  var clsHitDie = def.hitDice || 8;
  _pendingRecords.push({
    recordType: "class",
    targetPath: "data.classes",
    name: def.name || "Unknown Class",
    extraData: {
      level: cls.level || 1,
      hitDie: "d" + clsHitDie,
    },
  });

  // Subclass -> data.subclasses (if the character has chosen a subclass)
  if (cls.subclassDefinition && cls.subclassDefinition.name) {
    _pendingRecords.push({
      recordType: "subclass",
      targetPath: "data.subclasses",
      name: cls.subclassDefinition.name,
      extraData: {
        level: cls.level || 1,
      },
    });
  }
});

// Species -> data.species
// Populate extraData from DDB so if the species isn't in the compendium,
// the bare record still has all the fields from species-main.html
if (ddb.race && ddb.race.fullName) {
  var speciesExtraData = {};

  // Size (dropdown value: tiny, small, medium, large, huge, gargantuan)
  var speciesSizeId = ddb.race.sizeId;
  if (speciesSizeId && SIZE_MAP[speciesSizeId]) {
    speciesExtraData.size = SIZE_MAP[speciesSizeId];
  }

  // Speed
  var raceWalk =
    ddb.race.weightSpeeds &&
    ddb.race.weightSpeeds.normal &&
    ddb.race.weightSpeeds.normal.walk;
  if (raceWalk) {
    speciesExtraData.speed = raceWalk + " feet";
    // Include other movement modes if present
    var otherSpeeds = [];
    var normal = ddb.race.weightSpeeds.normal;
    if (normal.fly) otherSpeeds.push("fly " + normal.fly + " ft.");
    if (normal.swim) otherSpeeds.push("swim " + normal.swim + " ft.");
    if (normal.climb) otherSpeeds.push("climb " + normal.climb + " ft.");
    if (normal.burrow) otherSpeeds.push("burrow " + normal.burrow + " ft.");
    if (otherSpeeds.length > 0) {
      speciesExtraData.speed += ", " + otherSpeeds.join(", ");
    }
  }

  // Creature Type — DDB stores as a number (type field), default to Humanoid
  speciesExtraData.creatureType = "Humanoid";

  // Senses — extract racial senses from modifiers (darkvision, etc.)
  var racialSenses = [];
  (ddb.modifiers && ddb.modifiers.race ? ddb.modifiers.race : []).forEach(
    function (mod) {
      if (mod.type === "sense" && mod.subType && mod.value) {
        var sName = mod.friendlySubtypeName || mod.subType;
        sName = sName.charAt(0).toUpperCase() + sName.slice(1);
        racialSenses.push(sName + " " + mod.value + " ft.");
      }
    },
  );
  if (racialSenses.length > 0) {
    speciesExtraData.senses = racialSenses.join(", ");
  }

  // Description
  if (ddb.race.description) {
    speciesExtraData.description = ddb.race.description;
  }

  // Build alternate name formats for fuzzy matching.
  // DDB uses "Stout Halfling" but Realm uses "Halfling, Stout".
  // Try: "BaseName, SubRace", "BaseName", and the DDB fullName.
  var speciesAlternates = [];
  if (ddb.race.isSubRace && ddb.race.baseName && ddb.race.subRaceShortName) {
    // Realm format: "Halfling, Stout" or "Elf, High"
    speciesAlternates.push(
      ddb.race.baseName + ", " + ddb.race.subRaceShortName,
    );
    // Also try just the base name as fallback
    speciesAlternates.push(ddb.race.baseName);
  }

  var speciesPending = {
    recordType: "species",
    targetPath: "data.species",
    name: ddb.race.fullName,
    extraData: speciesExtraData,
  };
  if (speciesAlternates.length > 0) {
    speciesPending.alternateNames = speciesAlternates;
  }
  _pendingRecords.push(speciesPending);
}

// Background -> data.backgrounds
// Populate extraData from DDB so if the background isn't in the compendium,
// the bare record still has all the fields from backgrounds-main.html
if (
  ddb.background &&
  ddb.background.definition &&
  ddb.background.definition.name
) {
  var bgDef = ddb.background.definition;
  var bgExtraData = {};

  // Skill proficiencies — extract from background modifiers that match known skills
  var bgSkills = [];
  var bgTools = [];
  (ddb.modifiers && ddb.modifiers.background
    ? ddb.modifiers.background
    : []
  ).forEach(function (mod) {
    if (mod.type === "proficiency" && mod.subType) {
      // Check if it's a skill
      if (SKILL_MAP[mod.subType]) {
        bgSkills.push(SKILL_MAP[mod.subType]);
      }
      // Otherwise it's likely a tool proficiency
      else if (
        mod.subType.indexOf("weapon") === -1 &&
        mod.subType.indexOf("armor") === -1 &&
        mod.subType.indexOf("shield") === -1 &&
        mod.subType.indexOf("saving-throws") === -1
      ) {
        bgTools.push(mod.friendlySubtypeName || mod.subType);
      }
    }
  });
  if (bgSkills.length > 0) {
    bgExtraData.skillProficiencies = bgSkills;
  }
  if (bgTools.length > 0) {
    bgExtraData.toolProficiencies = bgTools.join(", ");
  }

  // Description (note: field name is capitalized "Description" in backgrounds-main.html)
  if (bgDef.description) {
    bgExtraData.Description = bgDef.description;
  }

  _pendingRecords.push({
    recordType: "backgrounds",
    targetPath: "data.backgrounds",
    name: bgDef.name,
    extraData: bgExtraData,
  });
}

// ===== 8. Features =====
// Features are populated from compendium class/species/subclass feature_lists
// by the framework when it resolves _pendingRecords. We initialize the array
// so it exists on the character, and any DDB-only features (racial traits not
// in the compendium) will be added as bare entries by the framework.

// Also add species racial traits directly as _pendingRecords targeting data.features.
// If the species IS found in the compendium, the framework will add its feature_list.
// If NOT found, these bare entries ensure racial traits still appear on the character.
var speciesName = (ddb.race && ddb.race.fullName) || "";
((ddb.race && ddb.race.racialTraits) || []).forEach(function (trait) {
  var def = trait.definition || {};
  // Skip hidden/builder-only traits and ability score increases
  if (def.hideInSheet) return;
  var cats = (def.categories || []).map(function (c) {
    return c.tagName || "";
  });
  if (cats.indexOf("__INITIAL_ASI") !== -1) return;
  // Skip generic traits like Size, Speed, Creature Type, Languages, Age
  var skipNames = [
    "Size",
    "Speed",
    "Creature Type",
    "Languages",
    "Age",
    "Ability Score Increases",
    "Ability Score Increase",
  ];
  if (skipNames.indexOf(def.name) !== -1) return;

  _pendingRecords.push({
    recordType: "records",
    targetPath: "data.features",
    name: def.name || "Racial Trait",
    extraData: {
      description: def.description || def.snippet || "",
      source: speciesName,
      level: 1,
      ddbIcon: ddbIconLookup("fallbacks", "racial trait"),
    },
  });
});

// ===== 8c. Tool Proficiencies -> data.otherSkills =====
// Matches the 5e ruleset's guessAbility() for tool -> ability mapping
function guessToolAbility(tool) {
  var lower = tool.toLowerCase();
  if (lower.indexOf("thieve") !== -1) return "dexterity";
  if (lower.indexOf("alchemist") !== -1) return "intelligence";
  if (lower === "brewer") return "intelligence";
  if (lower.indexOf("calligrapher") !== -1) return "dexterity";
  if (lower.indexOf("carpenter") !== -1) return "strength";
  if (lower.indexOf("cartographer") !== -1) return "wisdom";
  if (lower.indexOf("cobbler") !== -1) return "dexterity";
  if (lower.indexOf("cook") !== -1) return "wisdom";
  if (lower.indexOf("glassblower") !== -1) return "intelligence";
  if (lower.indexOf("jeweler") !== -1) return "intelligence";
  if (lower.indexOf("leatherworker") !== -1) return "dexterity";
  if (lower.indexOf("mason") !== -1) return "strength";
  if (lower.indexOf("painter") !== -1) return "wisdom";
  if (lower.indexOf("potter") !== -1) return "intelligence";
  if (lower.indexOf("smith") !== -1) return "strength";
  if (lower.indexOf("tinker") !== -1) return "dexterity";
  if (lower.indexOf("weaver") !== -1) return "dexterity";
  if (lower.indexOf("woodcarver") !== -1) return "dexterity";
  if (lower.indexOf("disguise") !== -1) return "charisma";
  if (lower.indexOf("forgery") !== -1) return "dexterity";
  if (lower.indexOf("gaming") !== -1) return "wisdom";
  if (lower.indexOf("herbalism") !== -1) return "intelligence";
  if (lower.indexOf("navigator") !== -1) return "wisdom";
  if (lower.indexOf("poisoner") !== -1) return "intelligence";
  if (
    lower.indexOf("instrument") !== -1 ||
    lower.indexOf("lute") !== -1 ||
    lower.indexOf("harp") !== -1 ||
    lower.indexOf("lyre") !== -1 ||
    lower.indexOf("flute") !== -1 ||
    lower.indexOf("drum") !== -1 ||
    lower.indexOf("bagpipe") !== -1 ||
    lower.indexOf("dulcimer") !== -1
  )
    return "charisma";
  return "strength";
}

var otherSkills = [];
var toolsSeen = {};
allModifiers.forEach(function (mod) {
  if (mod.type !== "proficiency" || !mod.subType) return;
  var name = mod.friendlySubtypeName || "";
  if (!name) return;
  // Tool proficiencies have subtypes like "calligraphers-supplies", "thieves-tools", etc.
  // Skip weapon/armor/save/skill proficiencies and individual weapon types
  if (
    mod.subType.indexOf("weapon") !== -1 ||
    mod.subType.indexOf("armor") !== -1 ||
    mod.subType.indexOf("shield") !== -1 ||
    mod.subType.indexOf("saving-throws") !== -1 ||
    mod.subType.indexOf("martial") !== -1 ||
    mod.subType.indexOf("simple") !== -1 ||
    WEAPON_SUBTYPES.indexOf(mod.subType) !== -1
  )
    return;
  if (SKILL_MAP[mod.subType] || SAVE_MAP[mod.subType]) return;
  // Skip if it's a generic "choose" option
  if (mod.subType.indexOf("choose") !== -1) return;

  if (toolsSeen[name]) return;
  toolsSeen[name] = true;

  var ability = guessToolAbility(name);
  var abilityMod = statModNum(abilityScores[ability] || 10);
  var skillMod = abilityMod + profBonus;

  otherSkills.push({
    _id: "import-tool-" + mod.subType,
    name: name,
    unidentifiedName: name,
    recordType: "records",
    data: {
      skillProf: "true",
      ability: ability,
      skillMod: skillMod,
    },
  });
});

// Custom proficiencies — user-created skills like "Cybertech (Technology)",
// "Aura Manipulation", plus custom tool/instrument profs. DDB's proficiencyLevel:
//   1 = not proficient (listed only), 2 = half-proficient, 3 = proficient, 4 = expertise
// statId maps to the ability via STAT_MAP (same ids as stats array).
(ddb.customProficiencies || []).forEach(function (prof) {
  var name = prof.name || "";
  if (!name) return;
  if (toolsSeen[name]) return;
  toolsSeen[name] = true;

  var ability = STAT_MAP[prof.statId] || "strength";
  var abilityMod = statModNum(abilityScores[ability] || 10);

  var profValue = "";
  var profMultiplier = 0;
  if (prof.proficiencyLevel === 4) {
    profValue = "expertise";
    profMultiplier = 2;
  } else if (prof.proficiencyLevel === 3) {
    profValue = "true";
    profMultiplier = 1;
  } else if (prof.proficiencyLevel === 2) {
    profValue = "half";
    profMultiplier = 0.5;
  }

  var bonus = Math.floor(profBonus * profMultiplier);
  var magicBonus = prof.magicBonus || 0;
  var miscBonus = prof.miscBonus || 0;
  var skillMod = abilityMod + bonus + magicBonus + miscBonus;
  if (prof.override != null) skillMod = prof.override;

  otherSkills.push({
    _id: "import-custom-prof-" + prof.id,
    name: name,
    unidentifiedName: name,
    recordType: "records",
    data: {
      skillProf: profValue,
      ability: ability,
      skillMod: skillMod,
    },
  });
});

if (otherSkills.length > 0) {
  charData.otherSkills = otherSkills;
}

// ===== 8b. Feats =====
// Translate a DDB feat modifier into Realm modifier records (data.modifiers on the feat).
// Returns an array of Realm modifier records — one DDB modifier may expand to many
// (e.g. Tough's "+2 HP per level" becomes TWO modifiers of +level each).
function translateFeatModifier(ddbMod, featName, idx) {
  var out = [];
  if (!ddbMod || !ddbMod.type) return out;

  function makeModifier(data, suffix) {
    return {
      _id: "import-feat-" + featName + "-" + idx + "-" + suffix,
      name: "New Modifier",
      unidentifiedName: "Modifier",
      recordType: "records",
      identified: true,
      data: data,
    };
  }

  // HP per level (Tough, etc.) — each point = one "+level" hitpoints modifier
  if (
    ddbMod.type === "bonus" &&
    ddbMod.subType === "hit-points-per-level" &&
    ddbMod.value
  ) {
    for (var i = 0; i < ddbMod.value; i++) {
      out.push(
        makeModifier(
          {
            type: "hitpoints",
            valueType: "field",
            value: "level",
            active: true,
          },
          "hppl-" + i,
        ),
      );
    }
  }
  return out;
}

// Add real feats (skip hidden system entries like ASI and disguised feats)
(ddb.feats || []).forEach(function (feat) {
  var def = feat.definition || {};
  var cats = (def.categories || []).map(function (c) {
    return c.tagName || "";
  });
  // Skip hidden system feats
  if (cats.indexOf("__INITIAL_ASI") !== -1) return;
  if (cats.indexOf("__DISGUISE_FEAT") !== -1) return;

  // Translate feat modifiers into Realm's modifier record format.
  // If a feat isn't in the Realm compendium, the framework creates a bare record
  // — these modifiers ensure its mechanical effects (like Tough's +2/level HP) apply.
  var featName = (def.name || "feat").toLowerCase().replace(/\s+/g, "-");
  var realmModifiers = [];
  (def.modifiers || []).forEach(function (mod, mIdx) {
    var translated = translateFeatModifier(mod, featName, mIdx);
    for (var t = 0; t < translated.length; t++) realmModifiers.push(translated[t]);
  });

  // Fallback: detect Tough by name if DDB didn't expose the modifier
  if (realmModifiers.length === 0 && def.name === "Tough") {
    realmModifiers.push(
      {
        _id: "import-feat-tough-hppl-0",
        name: "New Modifier",
        unidentifiedName: "Modifier",
        recordType: "records",
        identified: true,
        data: {
          type: "hitpoints",
          valueType: "field",
          value: "level",
          active: true,
        },
      },
      {
        _id: "import-feat-tough-hppl-1",
        name: "New Modifier",
        unidentifiedName: "Modifier",
        recordType: "records",
        identified: true,
        data: {
          type: "hitpoints",
          valueType: "field",
          value: "level",
          active: true,
        },
      },
    );
  }

  var featExtra = {
    description: def.description || "",
    featureType: "feat",
    ddbIcon: ddbIconLookup("fallbacks", "feat"),
  };
  if (realmModifiers.length > 0) {
    featExtra.modifiers = realmModifiers;
  }

  _pendingRecords.push({
    recordType: "feats",
    targetPath: "data.features",
    name: def.name || "Unknown Feat",
    extraData: featExtra,
  });
});

// ===== 9. Build spells from all sources =====

// Collect all spells from spells.class, spells.race, spells.feat, and classSpells.
// spells.item is NOT the character's own spells — those are cast from the item and
// are attached to it in section 9b.
var allSpells = [];
var spellSources = ddb.spells || {};
["class", "race", "feat", "background"].forEach(function (source) {
  if (spellSources[source]) {
    spellSources[source].forEach(function (s) {
      if (s.definition) allSpells.push(s);
    });
  }
});
// Also gather from classSpells (prepared spells)
(ddb.classSpells || []).forEach(function (cs) {
  (cs.spells || []).forEach(function (s) {
    if (s.definition) {
      // Avoid duplicates by checking name
      var exists = allSpells.some(function (existing) {
        return (
          existing.definition && existing.definition.name === s.definition.name
        );
      });
      if (!exists) allSpells.push(s);
    }
  });
});

// DDB save DC ability ID -> Realm ability name
var SAVE_ABILITY_MAP = {
  1: "strength",
  2: "dexterity",
  3: "constitution",
  4: "intelligence",
  5: "wisdom",
  6: "charisma",
};

// Determine spellcasting ability from class
var spellcastingAbility = "intelligence"; // default
(ddb.classes || []).forEach(function (cls) {
  var spellAbilityId = cls.definition && cls.definition.spellCastingAbilityId;
  if (spellAbilityId && SAVE_ABILITY_MAP[spellAbilityId]) {
    spellcastingAbility = SAVE_ABILITY_MAP[spellAbilityId];
  }
});

// Build a Realm spell's data from a DDB spell definition. Used both as the
// extraData merged onto a compendium match and as the full data of a placeholder
// when the spell isn't in the compendium.
function buildSpellExtraData(def) {
  var spellLevel = def.level || 0;
  var isCantrip = spellLevel === 0;

  // Extract damage from modifiers
  var baseDamage = "";
  var damageType = "";
  var cantripScaling = {};
  var higherSlotDamage = null;
  (def.modifiers || []).forEach(function (mod) {
    if (mod.type === "damage" && mod.die && mod.die.diceString) {
      baseDamage = mod.die.diceString;
      damageType = mod.subType || "";
      // Check cantrip scaling (character level based)
      var ahl = mod.atHigherLevels && mod.atHigherLevels.higherLevelDefinitions;
      if (ahl && ahl.length > 0) {
        ahl.forEach(function (h) {
          if (h.dice && h.dice.diceString) {
            if (isCantrip) {
              cantripScaling[h.level] = h.dice.diceString + " " + damageType;
            } else if (!higherSlotDamage) {
              // For leveled spells, atHigherLevels level=1 means "+1 slot"
              higherSlotDamage = h.dice.diceString + " " + damageType;
            }
          }
        });
      }
    }
  });

  var damageStr = baseDamage ? baseDamage + " " + damageType : "";

  // Casting time
  var castingTime = "Action";
  if (def.activation) {
    switch (def.activation.activationType) {
      case 1:
        castingTime = "Action";
        break;
      case 3:
        castingTime = "Bonus Action";
        break;
      case 5:
        castingTime = "Reaction";
        break;
      case 6:
        castingTime = "1 Minute";
        break;
      case 7:
        castingTime = "10 Minutes";
        break;
      case 8:
        castingTime = "1 Hour";
        break;
    }
  }

  // Duration
  var duration = "Instantaneous";
  if (def.duration) {
    if (def.duration.durationType === "Concentration") {
      var interval = def.duration.durationInterval || 1;
      var unit = def.duration.durationUnit || "Minute";
      duration =
        "Concentration, up to " +
        interval +
        " " +
        unit +
        (interval > 1 ? "s" : "");
    } else if (def.duration.durationType === "Time") {
      var tInterval = def.duration.durationInterval || 1;
      var tUnit = def.duration.durationUnit || "Minute";
      duration = tInterval + " " + tUnit + (tInterval > 1 ? "s" : "");
    } else {
      duration = def.duration.durationType || "Instantaneous";
    }
  }

  // Range
  var range = "Self";
  if (def.range) {
    if (def.range.rangeValue && def.range.rangeValue > 0) {
      range = def.range.rangeValue + " feet";
    } else if (def.range.origin === "Touch") {
      range = "Touch";
    } else {
      range = def.range.origin || "Self";
    }
    // Add AoE info
    if (def.range.aoeType && def.range.aoeValue) {
      range += " (" + def.range.aoeValue + "-foot " + def.range.aoeType + ")";
    }
  }

  // Components
  var components = (def.components || [])
    .map(function (c) {
      if (c === 1) return "V";
      if (c === 2) return "S";
      if (c === 3) return "M";
      return "";
    })
    .filter(function (c) {
      return c;
    })
    .join(", ");
  if (def.componentsDescription) {
    components += " (" + def.componentsDescription + ")";
  }

  // Save info
  var savingThrow = "";
  if (def.requiresSavingThrow && def.saveDcAbilityId) {
    savingThrow = SAVE_ABILITY_MAP[def.saveDcAbilityId] || "";
  }

  // Build extraData
  var extraData = {
    level: isCantrip ? "Cantrip" : "" + spellLevel,
    school: def.school || "",
    description: def.description || "",
    concentration: def.concentration || false,
    ritual: def.ritual || false,
    castingTime: castingTime,
    duration: duration,
    range: range,
    components: components,
    isAttack: def.requiresAttackRoll || false,
    isSave: def.requiresSavingThrow || false,
    ability: spellcastingAbility,
    // No spellLists: DDB's def.tags are categories ("Damage", "Buff"), not class
    // lists, and sending them would overwrite a matched compendium spell's real
    // lists — which "spell:druid" predicates (Moon Sickle) depend on.
  };

  // Add damage if present
  if (damageStr) {
    extraData.damage = damageStr;
  }

  // Add save info
  if (savingThrow) {
    extraData.savingThrow = savingThrow;
  }

  // Add cantrip scaling
  if (isCantrip) {
    if (cantripScaling[5]) extraData.damageCharacterLevel5 = cantripScaling[5];
    if (cantripScaling[11])
      extraData.damageCharacterLevel11 = cantripScaling[11];
    if (cantripScaling[17])
      extraData.damageCharacterLevel17 = cantripScaling[17];
  }

  // Add higher slot damage for leveled spells
  if (!isCantrip && higherSlotDamage) {
    extraData.damageHigher = higherSlotDamage;
  }

  return extraData;
}

// Group spells by level into _pendingRecords
// Cantrips (level 0) -> data.cantrips
// Level 1 spells -> data.spells1, level 2 -> data.spells2, etc.
allSpells.forEach(function (s) {
  var def = s.definition;
  var spellLevel = def.level || 0;
  _pendingRecords.push({
    recordType: "spells",
    targetPath: spellLevel === 0 ? "data.cantrips" : "data.spells" + spellLevel,
    name: def.name || "Unknown Spell",
    extraData: Object.assign(buildSpellExtraData(def), {
      ddbIcon: ddbIconForSpell(def),
    }),
  });
});

// ===== 9b. Item spells -> the item's data.itemSpells =====
// _pendingRecords can only push onto the character, and a matched compendium item
// may already carry some of these spells, so they're stashed on the item as
// data.ddbItemSpells and resolved by the post-import script: each one is copied
// from the compendium when it exists, otherwise built from this placeholder data.
// Missing ones are added; ones the compendium item already has are left alone.
(spellSources.item || []).forEach(function (s) {
  if (!s.definition) return;
  var copies = itemExtraDataByDefId[s.componentId] || [];
  if (copies.length === 0) return;
  var def = s.definition;
  var castLevel = s.castAtLevel || def.level || 0;
  var lu = s.limitedUse || {};
  // DDB's charge cost for this spell; at-will item spells have no cost.
  var charges = lu.minNumberConsumed != null ? lu.minNumberConsumed : castLevel;
  var spellData = buildSpellExtraData(def);
  spellData.castLevel = castLevel;
  spellData.charges = charges;
  copies.forEach(function (copy) {
    var ed = copy.extraData;
    (ed.ddbItemSpells = ed.ddbItemSpells || []).push({
      name: def.name || "Unknown Spell",
      data: spellData,
      icon: ddbIconForSpell(def),
    });
    ed.hasSpells = true;
    if (s.overrideSaveDc) {
      // The item casts at a fixed DC instead of the holder's.
      ed.useOwnSpellcasting = false;
      ed.defaultSpellDC = s.overrideSaveDc;
    } else {
      ed.useOwnSpellcasting = true;
    }
    // Charges live on the inventory item's limitedUse.
    var itemUses = copy.item.limitedUse || {};
    if (itemUses.maxUses > 0) {
      ed.hasUseBtn = true;
      ed.maxUses = itemUses.maxUses;
      ed.usesRemaining = Math.max(
        0,
        itemUses.maxUses - (itemUses.numberUsed || 0),
      );
      // "regains 1d6 expended charges" -> recharge "1d6"
      var rechargeMatch = (itemUses.resetTypeDescription || "").match(
        /regains?\s+(\d+d\d+(?:\s*\+\s*\d+)?|\d+)/i,
      );
      if (rechargeMatch) {
        ed.recharge = rechargeMatch[1].replace(/\s+/g, "");
      }
    }
  });
});

// ===== 10. Spell Slots and Spellcaster Settings =====

// Spell slot table (same as 5e ruleset getSpellSlotCount)
var spellSlotTable = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0], // Level 0
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // Level 1
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // Level 2
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // Level 3
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // Level 4
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // Level 5
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // Level 6
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // Level 7
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // Level 8
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // Level 9
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // Level 10
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // Level 11
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // Level 12
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // Level 13
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // Level 14
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // Level 15
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // Level 16
  [4, 3, 3, 3, 2, 1, 1, 1, 1], // Level 17
  [4, 3, 3, 3, 3, 1, 1, 1, 1], // Level 18
  [4, 3, 3, 3, 3, 2, 1, 1, 1], // Level 19
  [4, 3, 3, 3, 3, 2, 2, 1, 1], // Level 20
];

// Calculate spellcaster level for multiclass using DDB's multiClassSpellSlotDivisor
// divisor 1 = full caster, 2 = half caster, 3 = third caster
var isMulticlass = (ddb.classes || []).length > 1;
var spellSlots = [0, 0, 0, 0, 0, 0, 0, 0, 0];

if (!isMulticlass) {
  // Single class: use the class's own spell slot table from DDB
  var singleClass = (ddb.classes || [])[0];
  var sr =
    singleClass && singleClass.definition && singleClass.definition.spellRules;
  if (sr && sr.levelSpellSlots && sr.levelSpellSlots[singleClass.level]) {
    spellSlots = sr.levelSpellSlots[singleClass.level];
  }
} else {
  // Multiclass: calculate combined spellcaster level, then use shared table
  var spellCasterLevel = 0;
  (ddb.classes || []).forEach(function (cls) {
    var def = cls.definition || {};
    var sr = def.spellRules;
    if (def.canCastSpells && sr && sr.multiClassSpellSlotDivisor) {
      var divisor = sr.multiClassSpellSlotDivisor;
      if (divisor === 1) spellCasterLevel += cls.level;
      else if (divisor === 2) spellCasterLevel += Math.ceil(cls.level / 2);
      else if (divisor === 3) spellCasterLevel += Math.floor(cls.level / 3);
    }
  });
  if (spellCasterLevel > 0) {
    var idx = Math.min(spellCasterLevel, 20);
    spellSlots = spellSlotTable[idx] || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
}

// Set spell slot data
charData.numSpellSlots1 = spellSlots[0];
charData.numSpellSlots2 = spellSlots[1];
charData.numSpellSlots3 = spellSlots[2];
charData.numSpellSlots4 = spellSlots[3];
charData.numSpellSlots5 = spellSlots[4];
charData.numSpellSlots6 = spellSlots[5];
charData.numSpellSlots7 = spellSlots[6];
charData.numSpellSlots8 = spellSlots[7];
charData.numSpellSlots9 = spellSlots[8];

// Calculate max spell level and set field visibility
var maxSpellLevel = 0;
for (var i = 8; i >= 0; i--) {
  if (spellSlots[i] > 0) {
    maxSpellLevel = i + 1;
    break;
  }
}
charData.maxSpellLevel = maxSpellLevel > 0 ? "" + maxSpellLevel : "0";

// Build fields visibility
var fieldsToSet = {};

// Show class/species/background lists and hide the "no levels" placeholder
fieldsToSet["classes"] = { hidden: false };
fieldsToSet["species"] = { hidden: false };
fieldsToSet["backgrounds"] = { hidden: false };
fieldsToSet["noLevelsLabel"] = { hidden: true };

// Show HP-per-level fields for each level the character has
for (var hpLvl = 1; hpLvl <= totalLevel; hpLvl++) {
  fieldsToSet["hpLevel" + hpLvl] = { hidden: false };
}

// Spell lists and accordions
var hasAnySpells =
  maxSpellLevel > 0 ||
  allSpells.some(function (s) {
    return s.definition && s.definition.level === 0;
  });

if (hasAnySpells) {
  fieldsToSet["spellSlotsBox"] = { hidden: false };
  fieldsToSet["spellSlotsLabel"] = { hidden: false };
  fieldsToSet["cantripsOpen"] = { hidden: false };
  charData.cantripsOpen = "cantripsOpen";
}

for (var lvl = 1; lvl <= 9; lvl++) {
  var hasSlots = spellSlots[lvl - 1] > 0;
  fieldsToSet["spellSlots" + lvl] = { hidden: !hasSlots };
  fieldsToSet["level" + lvl + "spellsOpen"] = { hidden: !hasSlots };
  if (hasSlots) {
    charData["level" + lvl + "spellsOpen"] = "level" + lvl + "spellsOpen";
  }
}

// ===== Portrait =====
// Use the DDB avatar URL directly if set
var portrait = (ddb.decorations && ddb.decorations.avatarUrl) || undefined;

// ===== Return =====

var result = {
  name: ddb.name || "Imported Character",
  data: charData,
  fields: fieldsToSet,
  _pendingRecords: _pendingRecords,
};
if (portrait) {
  result.portrait = portrait;
}
return result;
