// Character PDF Export Script for RealmVTT 5e Ruleset
// Produces a multi-page pdfmake docDefinition mirroring the in-app character sheet:
//   1. Main     — portrait, identity, core stats, ability scores, saves
//   2. Actions  — name + portrait, attacks, abilities/features summary, spells by level
//   3. Skills   — skills table, other skills, proficiencies
//   4. Inventory — items, currency, treasure, carry weight
//   5. Features  — full feat + feature descriptions
//   6. Notes    — backstory, personality, physical description, misc
//
// Available at runtime:
//   record      — the character record (also exposed as `value`)
//   recordType  — "characters"
//   data.filename — the default filename from the ruleset template
//   api.loadImage(path) — async, returns a base64 data URL for embedding

const d = (record && record.data) || {};
const characterName = (record && record.name) || "Unnamed Character";

// ===== Helpers =====

function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<li[^>]*>/gi, "\u2022 ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(ul|ol|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nonEmpty(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
  x;
}

function val(v, fallback) {
  return nonEmpty(v) ? String(v) : fallback === undefined ? "—" : fallback;
}

function kv(label, value) {
  return {
    stack: [
      { text: label, style: "label" },
      { text: val(value), style: "value" },
    ],
  };
}

function signed(n) {
  const num = parseInt(n, 10);
  if (isNaN(num)) return val(n);
  return num >= 0 ? "+" + num : String(num);
}

function titleCase(s) {
  if (!nonEmpty(s)) return "—";
  return String(s).replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

function yesNo(v) {
  if (v === true || v === "true") return "Yes";
  if (v === false || v === "false") return "No";
  return val(v);
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

const DESC_MAX = 180;

// ===== Portrait =====

let portraitDataUrl = null;
if (record && record.portrait) {
  try {
    portraitDataUrl = await api.loadImage(record.portrait);
  } catch (e) {
    // Portrait fetch failed (CORS, 404, offline, decode error). Continue
    // without it, but surface the reason so it's not silently dropped.
    console.warn(
      "[characters.pdf] portrait load failed for",
      record.portrait,
      "—",
      e && e.message,
    );
    portraitDataUrl = null;
  }
}

// ===== Styles =====

const styles = {
  h1: { fontSize: 22, bold: true, margin: [0, 0, 0, 2] },
  h2: {
    fontSize: 15,
    bold: true,
    color: "#5b2a1e",
    margin: [0, 0, 0, 8],
  },
  h3: { fontSize: 12, bold: true, margin: [0, 10, 0, 4] },
  label: { fontSize: 8, color: "#666" },
  value: { fontSize: 11, bold: true },
  small: { fontSize: 9 },
  tiny: { fontSize: 8, color: "#555" },
  tableHeader: {
    fontSize: 9,
    bold: true,
    fillColor: "#eeeeee",
    margin: [2, 2, 2, 2],
  },
  pageTitle: {
    fontSize: 18,
    bold: true,
    color: "#5b2a1e",
    margin: [0, 0, 0, 10],
  },
};

const defaultStyle = { fontSize: 10, lineHeight: 1.15 };

// ===== Reusable fragments =====

function nameStrip(showPortrait, pageTitle) {
  const portraitBlock =
    showPortrait && portraitDataUrl
      ? {
          image: portraitDataUrl,
          width: 60,
          height: 60,
          fit: [60, 60],
        }
      : { text: "", width: 60 };

  return {
    columns: [
      portraitBlock,
      {
        stack: [
          { text: characterName, fontSize: 16, bold: true },
          {
            text: [
              d.className || d.classLevels || "",
              d.speciesName ? " \u2022 " + d.speciesName : "",
              d.level ? " \u2022 Level " + d.level : "",
            ]
              .filter(Boolean)
              .join(""),
            style: "small",
            color: "#555",
          },
        ],
        margin: [12, showPortrait ? 8 : 0, 0, 0],
      },
      pageTitle
        ? {
            text: pageTitle,
            style: "pageTitle",
            alignment: "right",
            margin: [0, 8, 0, 0],
          }
        : { text: "", width: 1 },
    ],
    margin: [0, 0, 0, 10],
  };
}

// ===== Page 1: Main =====

const ABILITIES = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];

const abilityTable = {
  table: {
    widths: ["*", "*", "*", "*", "*", "*"],
    body: [
      ABILITIES.map((a) => ({
        text: a.slice(0, 3).toUpperCase(),
        style: "tableHeader",
        alignment: "center",
      })),
      ABILITIES.map((a) => ({
        stack: [
          {
            text: val(d[a], "10"),
            alignment: "center",
            fontSize: 18,
            bold: true,
          },
          {
            text: signed(d[a + "Mod"]),
            alignment: "center",
            fontSize: 10,
            color: "#555",
          },
        ],
        margin: [0, 4, 0, 4],
      })),
    ],
  },
  layout: "lightHorizontalLines",
  margin: [0, 0, 0, 10],
};

const saveRows = [
  [
    { text: "Save", style: "tableHeader" },
    { text: "Prof", style: "tableHeader", alignment: "center" },
    { text: "Mod", style: "tableHeader", alignment: "center" },
  ],
  ...ABILITIES.map((a) => [
    { text: a.charAt(0).toUpperCase() + a.slice(1) },
    {
      text: d[a + "Prof"] === "true" ? "Y" : "—",
      alignment: "center",
    },
    {
      text: signed(d[a + "Save"] !== undefined ? d[a + "Save"] : d[a + "Mod"]),
      alignment: "center",
    },
  ]),
];

const mainContent = [
  nameStrip(true),
  {
    columns: [
      kv("HP", val(d.curhp, val(d.hitpoints)) + " / " + val(d.hitpoints)),
      kv("Temp HP", d.tempHp),
      kv("AC", d.ac),
      kv("Speed", d.speed),
      kv("Prof. Bonus", d.proficiencyBonus),
      kv("Level", d.level),
    ],
    columnGap: 8,
    margin: [0, 0, 0, 10],
  },
  {
    columns: [
      kv("Class", d.className || d.classLevels),
      kv("Species", d.speciesName),
      kv("Background", d.backgroundName),
      kv("Alignment", titleCase(d.alignment)),
    ],
    columnGap: 8,
    margin: [0, 0, 0, 10],
  },
  {
    columns: [
      kv("Size", titleCase(d.size)),
      kv("Senses", d.senses),
      kv("Inspiration", yesNo(d.inspiration)),
      kv("XP", d.xp),
    ],
    columnGap: 8,
    margin: [0, 0, 0, 10],
  },
  { text: "Ability Scores", style: "h3" },
  abilityTable,
  { text: "Saving Throws", style: "h3" },
  {
    table: { headerRows: 1, widths: ["*", 50, 60], body: saveRows },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 10],
  },
];

// ===== Page 2: Actions =====

function describeSpell(s) {
  const sd = (s && s.data) || {};
  const meta = [sd.castingTime, sd.range, sd.duration, sd.school]
    .filter(nonEmpty)
    .join(" \u2022 ");
  const desc = truncate(stripHtml(sd.description), DESC_MAX);
  return {
    stack: [
      {
        text: [
          { text: s.name || "Unnamed Spell", bold: true },
          meta ? { text: " \u2014 " + meta, style: "tiny" } : { text: "" },
        ],
      },
      desc
        ? {
            text: desc,
            style: "small",
            margin: [0, 1, 0, 4],
          }
        : { text: "", margin: [0, 0, 0, 2] },
    ],
  };
}

const attackItems = (d.inventory || []).filter((it) => {
  const itd = (it && it.data) || {};
  return (
    nonEmpty(itd.damage) ||
    nonEmpty(itd.attackBonus) ||
    nonEmpty(itd.toHit) ||
    itd.filterType === "Weapon" ||
    itd.itemType === "weapon"
  );
});

const actionsContent = [
  Object.assign(nameStrip(true, "Actions & Spells"), {
    pageBreak: "before",
  }),
];

if (attackItems.length > 0) {
  actionsContent.push({ text: "Attacks", style: "h3" });
  actionsContent.push({
    table: {
      headerRows: 1,
      widths: ["*", 45, 60, "*"],
      body: [
        [
          { text: "Name", style: "tableHeader" },
          { text: "To Hit", style: "tableHeader", alignment: "center" },
          { text: "Damage", style: "tableHeader", alignment: "center" },
          { text: "Notes", style: "tableHeader" },
        ],
        ...attackItems.map((it) => {
          const id = it.data || {};
          const hit = id.attackBonus !== undefined ? id.attackBonus : id.toHit;
          const notes = [id.properties, id.weaponProperties, id.range]
            .filter(nonEmpty)
            .join(" \u2022 ");
          return [
            { text: it.name || "" },
            { text: hit !== undefined ? signed(hit) : "", alignment: "center" },
            { text: val(id.damage, ""), alignment: "center" },
            { text: notes, style: "tiny" },
          ];
        }),
      ],
    },
    layout: "lightHorizontalLines",
    fontSize: 9,
    margin: [0, 0, 0, 10],
  });
}

// "Abilities" in the actions context: features the character can use. Show a
// compact summary here; the full details go on the Features page.
const featureList = (d.features || [])
  .slice()
  .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

if (featureList.length > 0) {
  actionsContent.push({ text: "Abilities", style: "h3" });
  actionsContent.push({
    ul: featureList.slice(0, 60).map((f) => {
      const fd = f.data || {};
      const source = fd.source ? " (" + fd.source + ")" : "";
      const short = truncate(stripHtml(fd.description), DESC_MAX);
      return {
        text: [
          { text: (f.name || "Unnamed") + source, bold: true },
          short ? { text: " \u2014 " + short, style: "small" } : { text: "" },
        ],
      };
    }),
    margin: [0, 0, 0, 10],
  });
  if (featureList.length > 60) {
    actionsContent.push({
      text: `(${featureList.length - 60} more on the Features page)`,
      style: "tiny",
      italics: true,
      margin: [0, 0, 0, 10],
    });
  }
}

// Spells by level
for (let lvl = 0; lvl <= 9; lvl++) {
  const spellList = lvl === 0 ? d.cantrips || [] : d["spells" + lvl] || [];
  if (spellList.length === 0) continue;
  const slots = lvl === 0 ? null : d["numSpellSlots" + lvl];
  const heading =
    lvl === 0
      ? "Cantrips"
      : "Level " + lvl + " Spells" + (slots ? " (" + slots + " slots)" : "");
  actionsContent.push({ text: heading, style: "h3" });
  actionsContent.push({
    stack: spellList.map(describeSpell),
    margin: [0, 0, 0, 6],
  });
}

// ===== Page 3: Skills =====

const SKILLS = [
  { key: "acrobatics", label: "Acrobatics", ability: "dexterity" },
  { key: "animalHandling", label: "Animal Handling", ability: "wisdom" },
  { key: "arcana", label: "Arcana", ability: "intelligence" },
  { key: "athletics", label: "Athletics", ability: "strength" },
  { key: "culture", label: "Culture", ability: "intelligence" },
  { key: "deception", label: "Deception", ability: "charisma" },
  { key: "history", label: "History", ability: "intelligence" },
  { key: "insight", label: "Insight", ability: "wisdom" },
  { key: "intimidation", label: "Intimidation", ability: "charisma" },
  { key: "investigation", label: "Investigation", ability: "intelligence" },
  { key: "medicine", label: "Medicine", ability: "wisdom" },
  { key: "nature", label: "Nature", ability: "intelligence" },
  { key: "perception", label: "Perception", ability: "wisdom" },
  { key: "performance", label: "Performance", ability: "charisma" },
  { key: "persuasion", label: "Persuasion", ability: "charisma" },
  { key: "religion", label: "Religion", ability: "intelligence" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dexterity" },
  { key: "stealth", label: "Stealth", ability: "dexterity" },
  { key: "survival", label: "Survival", ability: "wisdom" },
];

const PROF_LABEL = {
  true: "P",
  expertise: "E",
  half: "H",
  false: "—",
};

const skillRows = [
  [
    { text: "Skill", style: "tableHeader" },
    { text: "Ability", style: "tableHeader", alignment: "center" },
    { text: "Prof", style: "tableHeader", alignment: "center" },
    { text: "Mod", style: "tableHeader", alignment: "center" },
  ],
  ...SKILLS.map((s) => {
    const prof = d[s.key + "Prof"] || "false";
    const ability = d[s.key + "Ability"] || s.ability;
    return [
      { text: s.label },
      {
        text: (ability || "").slice(0, 3).toUpperCase(),
        alignment: "center",
      },
      { text: PROF_LABEL[prof] || "—", alignment: "center" },
      { text: signed(d[s.key + "Mod"]), alignment: "center" },
    ];
  }),
];

const skillsContent = [
  Object.assign(nameStrip(false, "Skills"), { pageBreak: "before" }),
  {
    columns: [
      kv("Passive Perception", d.passivePerception),
      kv("Passive Investigation", d.passiveInvestigation),
      kv("Passive Insight", d.passiveInsight),
    ],
    columnGap: 8,
    margin: [0, 0, 0, 10],
  },
  {
    table: { headerRows: 1, widths: ["*", 55, 40, 40], body: skillRows },
    layout: "lightHorizontalLines",
    fontSize: 10,
    margin: [0, 0, 0, 4],
  },
  {
    text: "P = Proficient  \u2022  E = Expertise  \u2022  H = Half Proficient",
    style: "tiny",
    margin: [0, 0, 0, 10],
  },
];

const otherSkills = d.otherSkills || [];
if (otherSkills.length > 0) {
  skillsContent.push({ text: "Other Skills", style: "h3" });
  skillsContent.push({
    ul: otherSkills.map((os) => {
      const mod = os && os.data && os.data.mod;
      return (
        (os.name || "Unnamed") + (nonEmpty(mod) ? " \u2014 " + signed(mod) : "")
      );
    }),
    margin: [0, 0, 0, 10],
  });
}

skillsContent.push({ text: "Proficiencies", style: "h3" });
const profRows = [
  ["Languages", d.languages],
  ["Armor Training", d.armorTraining],
  ["Weapons", d.weaponProficiencies],
  ["Tools", d.tools],
  ["Resistances", d.resistances],
  ["Immunities", d.immunities],
  ["Vulnerabilities", d.vulnerabilities],
].filter((r) => nonEmpty(r[1]));

if (profRows.length === 0) {
  skillsContent.push({
    text: "No proficiencies recorded.",
    style: "small",
    italics: true,
  });
} else {
  skillsContent.push({
    table: {
      widths: [100, "*"],
      body: profRows.map((r) => [
        { text: r[0], bold: true, style: "small" },
        { text: val(r[1]), style: "small" },
      ]),
    },
    layout: "lightHorizontalLines",
  });
}

// ===== Page 4: Inventory =====

const inventory = d.inventory || [];
const inventoryContent = [
  Object.assign(nameStrip(false, "Inventory"), { pageBreak: "before" }),
];

if (inventory.length === 0) {
  inventoryContent.push({
    text: "No items.",
    style: "small",
    italics: true,
    margin: [0, 0, 0, 10],
  });
} else {
  inventoryContent.push({
    table: {
      headerRows: 1,
      widths: ["*", 40, 45, 50, 50],
      body: [
        [
          { text: "Item", style: "tableHeader" },
          { text: "Count", style: "tableHeader", alignment: "center" },
          { text: "Weight", style: "tableHeader", alignment: "center" },
          { text: "Equipped", style: "tableHeader", alignment: "center" },
          { text: "Attuned", style: "tableHeader", alignment: "center" },
        ],
        ...inventory.map((it) => {
          const id = (it && it.data) || {};
          const requiresAttunement =
            id.attunement === true || id.attunement === "true";
          const isAttuned = id.attuned === true || id.attuned === "true";
          return [
            { text: it.name || "" },
            {
              text: String(id.count != null ? id.count : 1),
              alignment: "center",
            },
            {
              text: id.weight !== undefined ? String(id.weight) : "",
              alignment: "center",
            },
            {
              text: id.carried === "equipped" ? "\u25CF" : "",
              alignment: "center",
            },
            {
              text: isAttuned
                ? "\u25CF"
                : requiresAttunement
                  ? "\u25CB"
                  : "",
              alignment: "center",
            },
          ];
        }),
      ],
    },
    layout: "lightHorizontalLines",
    fontSize: 9,
    margin: [0, 0, 0, 10],
  });
}

if (nonEmpty(d.totalWeight) || nonEmpty(d.maxCarryWeight)) {
  inventoryContent.push({
    text:
      "Total Weight: " +
      val(d.totalWeight, "0") +
      " / " +
      val(d.maxCarryWeight, "—"),
    style: "small",
    margin: [0, 0, 0, 10],
  });
}

inventoryContent.push({ text: "Currency", style: "h3" });
inventoryContent.push({
  columns: [
    kv("CP", d.cp),
    kv("SP", d.sp),
    kv("EP", d.ep),
    kv("GP", d.gp),
    kv("PP", d.pp),
  ],
  columnGap: 8,
  margin: [0, 0, 0, 10],
});

const treasureItems = inventory.filter((it) => {
  const t = String(
    (it && it.data && (it.data.type || it.data.itemType || it.data.category)) ||
      "",
  ).toLowerCase();
  return t.indexOf("treasure") !== -1 || t.indexOf("valuable") !== -1;
});
if (treasureItems.length > 0) {
  inventoryContent.push({ text: "Treasure", style: "h3" });
  inventoryContent.push({
    ul: treasureItems.map((it) => {
      const id = it.data || {};
      return (
        (it.name || "Unnamed") +
        (id.count != null && id.count !== 1 ? " \u00d7" + id.count : "")
      );
    }),
    margin: [0, 0, 0, 10],
  });
}

// ===== Page 5: Features =====

const featuresContent = [
  Object.assign(nameStrip(false, "Features & Feats"), {
    pageBreak: "before",
  }),
];

const features = d.features || [];
if (features.length === 0) {
  featuresContent.push({
    text: "No features or feats.",
    style: "small",
    italics: true,
  });
} else {
  features.forEach((f) => {
    const fd = f.data || {};
    const headerBits = [
      { text: f.name || "Unnamed Feature", bold: true, fontSize: 11 },
    ];
    if (fd.source) {
      headerBits.push({
        text: "  " + fd.source,
        style: "tiny",
        color: "#777",
      });
    }
    if (fd.level) {
      headerBits.push({
        text: "  \u2022  Level " + fd.level,
        style: "tiny",
        color: "#777",
      });
    }
    const desc = truncate(stripHtml(fd.description), DESC_MAX);
    featuresContent.push({
      stack: [
        { text: headerBits, margin: [0, 0, 0, 2] },
        { text: desc || "—", style: "small", margin: [0, 0, 0, 8] },
      ],
    });
  });
}

// ===== Page 6: Notes =====

const notesContent = [
  Object.assign(nameStrip(false, "Notes & Backstory"), {
    pageBreak: "before",
  }),
];

function addRichSection(label, html) {
  const text = stripHtml(html);
  if (!text) return;
  notesContent.push({ text: label, style: "h3" });
  notesContent.push({ text, margin: [0, 0, 0, 8] });
}

addRichSection("Backstory", d.backstory);
addRichSection("Appearance", d.appearance);
addRichSection("Personality Traits", d.personalityTraits);
addRichSection("Ideals", d.ideals);
addRichSection("Bonds", d.bonds);
addRichSection("Flaws", d.flaws);
addRichSection("Notes", d.notes);

const physical = [
  d.gender && "Gender: " + d.gender,
  d.pronouns && "Pronouns: " + d.pronouns,
  d.age && "Age: " + d.age,
  d.height && "Height: " + d.height,
  d.weight && "Weight: " + d.weight,
  d.hair && "Hair: " + d.hair,
  d.eyes && "Eyes: " + d.eyes,
  d.skin && "Skin: " + d.skin,
].filter(Boolean);

if (physical.length > 0) {
  notesContent.push({ text: "Physical Description", style: "h3" });
  notesContent.push({
    ul: physical,
    style: "small",
    margin: [0, 0, 0, 8],
  });
}

if (nonEmpty(d.deity)) {
  notesContent.push({
    text: "Deity / Patron: " + d.deity,
    style: "small",
    margin: [0, 4, 0, 0],
  });
}

// ===== Assemble =====

return {
  pageSize: "LETTER",
  pageMargins: [40, 40, 40, 44],
  defaultStyle,
  styles,
  footer: (currentPage, pageCount) => ({
    columns: [
      { text: characterName, style: "tiny", margin: [40, 0, 0, 0] },
      {
        text: currentPage + " / " + pageCount,
        alignment: "right",
        style: "tiny",
        margin: [0, 0, 40, 0],
      },
    ],
    margin: [0, 10, 0, 0],
  }),
  content: [
    ...mainContent,
    ...actionsContent,
    ...skillsContent,
    ...inventoryContent,
    ...featuresContent,
    ...notesContent,
  ],
  filename: characterName + ".pdf",
};
