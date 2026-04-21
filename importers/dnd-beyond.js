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

// Gather all modifiers from all sources
var allModifiers = [].concat(
  ddb.modifiers && ddb.modifiers.race ? ddb.modifiers.race : [],
  ddb.modifiers && ddb.modifiers.class ? ddb.modifiers.class : [],
  ddb.modifiers && ddb.modifiers.background ? ddb.modifiers.background : [],
  ddb.modifiers && ddb.modifiers.feat ? ddb.modifiers.feat : [],
  ddb.modifiers && ddb.modifiers.item ? ddb.modifiers.item : [],
  ddb.modifiers && ddb.modifiers.condition ? ddb.modifiers.condition : [],
);

// Apply ability score bonuses from modifiers
allModifiers.forEach(function (mod) {
  if (
    mod.type === "bonus" &&
    mod.subType &&
    mod.subType.indexOf("-score") !== -1 &&
    mod.value
  ) {
    var ability = mod.subType.replace("-score", "");
    if (abilityScores[ability] !== undefined) {
      abilityScores[ability] += mod.value;
    }
  }
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
  charData[name + "Base"] = val;
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

// Check for equipped armor in inventory
var hasEquippedArmor = false;
(ddb.inventory || []).forEach(function (item) {
  var def = item.definition || {};
  if (item.equipped && def.armorClass && def.filterType === "Armor") {
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
// Check for equipped shield
(ddb.inventory || []).forEach(function (item) {
  var def = item.definition || {};
  if (
    item.equipped &&
    def.armorClass &&
    def.filterType === "Armor" &&
    def.type === "Shield"
  ) {
    baseAc += def.armorClass;
  }
});
// Apply AC bonuses from modifiers
allModifiers.forEach(function (mod) {
  if (mod.type === "bonus" && mod.subType === "armor-class" && mod.value) {
    baseAc += mod.value;
  }
});
charData.ac = baseAc;

// Senses — extract from modifiers (darkvision, blindsight, tremorsense, truesight)
var senses = [];
allModifiers.forEach(function (mod) {
  if (mod.type === "sense" && mod.subType && mod.value) {
    var senseName = mod.friendlySubtypeName || mod.subType;
    senseName = senseName.charAt(0).toUpperCase() + senseName.slice(1);
    senses.push(senseName + " " + mod.value + " ft.");
  }
});
if (senses.length > 0) {
  charData.senses = senses.join(", ");
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

// Passive scores
charData.passivePerception = 10 + (charData.perceptionMod || 0);
charData.passiveInsight = 10 + (charData.insightMod || 0);
charData.passiveInvestigation = 10 + (charData.investigationMod || 0);

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

(ddb.inventory || []).forEach(function (item) {
  var def = item.definition || {};
  var filterType = def.filterType || "Other Gear";
  var type = "gear";
  if (filterType === "Weapon") type = "melee weapon";
  if (filterType === "Armor") {
    type = def.type === "Shield" ? "shield" : "armor";
  }
  if (def.attackType === 2) type = "ranged weapon";

  // Determine subtype from DDB type field
  var subtype = "";
  if (def.type) {
    // DDB types like "Potion", "Ring", "Rod", "Scroll", "Staff", "Wand", "Wondrous Item"
    // Also "Light Armor", "Medium Armor", "Heavy Armor" for armor
    // And "Simple Melee Weapon", "Martial Ranged Weapon", etc. for weapons
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

  var extraData = {
    count: item.quantity || 1,
    carried: item.equipped ? "equipped" : "",
    weight: def.weight || 0,
    damage:
      def.damage && def.damage.diceString
        ? def.damage.diceString + " " + (def.damageType || "")
        : "",
    type: type,
    cost: (def.cost || 0) + " gp",
    description: def.description || "",
    location: location,
  };

  if (subtype) {
    extraData.subtype = subtype;
  }

  // Weapon-specific fields
  if (filterType === "Weapon") {
    // Weapon type (base weapon name for mastery system, e.g., "Longsword", "Shortbow")
    // DDB provides baseItemName for the base weapon type (like baseArmorName for armor).
    // For non-magic items, def.name IS the weapon type.
    // For magic items (e.g., "Flame Tongue"), baseItemName maps back to the base weapon.
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
    if (KNOWN_WEAPONS.indexOf(weaponTypeName) !== -1) {
      extraData.weaponType = weaponTypeName;
    }

    // Weapon properties (Finesse, Heavy, Light, etc.)
    var weaponProps = [];
    (def.properties || []).forEach(function (prop) {
      var name = prop.name || "";
      if (WEAPON_PROPERTY_MAP[name]) {
        weaponProps.push(WEAPON_PROPERTY_MAP[name]);
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
    if (def.type !== "Shield") {
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

  // Attunement
  if (def.canAttune) {
    extraData.attunement = true;
    extraData.attuned = item.isAttuned ? "true" : "false";
  }

  _pendingRecords.push({
    recordType: "items",
    targetPath: "data.inventory",
    name: def.name || "Unknown Item",
    extraData: extraData,
  });
});

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

// Collect all spells from spells.class, spells.race, spells.feat, and classSpells
var allSpells = [];
var spellSources = ddb.spells || {};
["class", "race", "feat", "item", "background"].forEach(function (source) {
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

// Group spells by level into _pendingRecords
// Cantrips (level 0) -> data.cantrips
// Level 1 spells -> data.spells1, level 2 -> data.spells2, etc.
allSpells.forEach(function (s) {
  var def = s.definition;
  var spellLevel = def.level || 0;
  var isCantrip = spellLevel === 0;
  var targetPath = isCantrip ? "data.cantrips" : "data.spells" + spellLevel;

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
    spellLists: def.tags || [],
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

  _pendingRecords.push({
    recordType: "spells",
    targetPath: targetPath,
    name: def.name || "Unknown Spell",
    extraData: extraData,
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
