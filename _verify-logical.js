const fs = require("fs");
const vm = require("vm");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync("spatial-bank.js", "utf8"), sandbox);
const questions = sandbox.window.SpatialQuestionBank.createQuestions();

const ROTATION_SHAPE_OVERRIDE = { 2: "triangle", 6: "arrow", 10: "triangle", 14: "arrow", 18: "triangle" };
const SHAPES = ["triangle", "arrow", "cross", "star"];
const rotations = [
  { label: "90° vers la droite", value: 90 },
  { label: "180°", value: 180 },
  { label: "90° vers la gauche", value: 270 },
  { label: "90° vers la gauche", value: 270 },
  { label: "90° vers la droite", value: 90 }
];
const steps = [45, 60, 90, 120, 135];
const SEQUENCE_SHAPE_OVERRIDE = { 0: "triangle", 4: "arrow", 12: "triangle" };

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function getRotate(svg) {
  const m = svg.match(/rotate\(([-\d.]+)\)/);
  return m ? Number(m[1]) : null;
}

function getMirror(svg) {
  if (/scale\(\s*1\s+-1\s*\)/.test(svg)) return "h";
  if (/scale\(\s*-1\s+1\s*\)/.test(svg)) return "v";
  return "none";
}

function optionState(svg) {
  return { angle: normalizeAngle(getRotate(svg)), mirror: getMirror(svg) };
}

function statesEqual(a, b) {
  return a.angle === b.angle && a.mirror === b.mirror;
}

console.log("=== TABLE rotations : mapping index → libellé (texte de la question uniquement) ===\n");
for (let index = 0; index < 20; index += 1) {
  const r = rotations[index % rotations.length];
  console.log(
    `rotation-${index + 1}  →  rotations[${index % 5}]  =  « ${r.label} »  (value=${r.value})`
  );
}

const rotationIds = ["rotation-3", "rotation-7", "rotation-11", "rotation-15", "rotation-19"];
const sequenceIds = ["sequence-1", "sequence-5", "sequence-13"];

console.log("\n=== ROTATIONS : unicité logique de la bonne réponse ===\n");

rotationIds.forEach((id) => {
  const q = questions.find((x) => x.id === id);
  const index = Number(id.split("-")[1]) - 1;
  const rotation = rotations[index % rotations.length];
  const baseAngle = normalizeAngle(getRotate(q.visual.svg));
  const expectedAngle = normalizeAngle(baseAngle + rotation.value);

  const matching = q.options
    .map((o, i) => ({ i, ...optionState(o.svg) }))
    .filter((o) => o.angle === expectedAngle);

  console.log(`${id}`);
  console.log(`  Énoncé : rotation de ${rotation.label}`);
  console.log(`  Départ ${baseAngle}° + ${rotation.value}° → attendu ${expectedAngle}°`);
  console.log(`  Options : ${q.options.map((o, i) => {
    const s = optionState(o.svg);
    return `${String.fromCharCode(65 + i)}=${s.angle}°`;
  }).join(", ")}`);
  console.log(`  Options avec l'angle attendu : ${matching.map((m) => String.fromCharCode(65 + m.i)).join(", ") || "aucune"}`);
  console.log(`  → ${matching.length === 1 && matching[0].i === q.answer ? "OK — une seule réponse logique" : "PROBLÈME"}\n`);
});

console.log("=== SUITES : unicité logique de la bonne réponse ===\n");

sequenceIds.forEach((id) => {
  const q = questions.find((x) => x.id === id);
  const index = Number(id.split("-")[1]) - 1;
  const startAngle = [0, 30, 45, 90][index % 4];
  const step = steps[index % steps.length];
  const mirrors = index % 3 === 0 ? ["none", "v", "none", "v"] : ["none", "none", "none", "none"];
  const expected = {
    angle: normalizeAngle(startAngle + 4 * step),
    mirror: "none"
  };

  const matching = q.options
    .map((o, i) => ({ i, ...optionState(o.svg) }))
    .filter((o) => statesEqual(o, expected));

  console.log(`${id}`);
  console.log(`  Règle : +${step}°/étape, départ ${startAngle}°${index % 3 === 0 ? ", miroir v alterné dans la suite" : ""}`);
  console.log(`  Suite affichée : ${[0, 1, 2, 3].map((o) => {
    const a = normalizeAngle(startAngle + o * step);
    const m = mirrors[o];
    return `${a}°${m !== "none" ? " (miroir " + m + ")" : ""}`;
  }).join(" → ")} → ?`);
  console.log(`  Attendu : ${expected.angle}°, miroir ${expected.mirror}`);
  console.log(`  Options : ${q.options.map((o, i) => {
    const s = optionState(o.svg);
    return `${String.fromCharCode(65 + i)}=${s.angle}° m=${s.mirror}`;
  }).join(", ")}`);
  console.log(`  Correspondances exactes : ${matching.map((m) => String.fromCharCode(65 + m.i)).join(", ") || "aucune"}`);
  console.log(`  → ${matching.length === 1 && matching[0].i === q.answer ? "OK — une seule réponse logique" : "PROBLÈME"}\n`);
});
