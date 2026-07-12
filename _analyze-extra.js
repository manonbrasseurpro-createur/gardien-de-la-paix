const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const Q = sandbox.window.SpatialQuestionBank.createQuestions();

const FACE_BY_FILL = {
  "#2f5f9f": "A", "#8fb3e8": "B", "#dce7ff": "C",
  "#f3a64a": "D", "#42a67f": "E", "#ffffff": "F"
};
function cubeFacesFromSvg(svg) {
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]+)"/gi)].map(m => m[1].toLowerCase());
  return fills.filter(f => FACE_BY_FILL[f]).map(f => FACE_BY_FILL[f]).slice(0, 3);
}
function getRotate(svg) { const m = svg.match(/rotate\(([-\d.]+)\)/); return m ? Number(m[1]) : null; }
function getMirror(svg) {
  if (/scale\(\s*1\s+-1\s*\)/.test(svg)) return "h";
  if (/scale\(\s*-1\s+1\s*\)/.test(svg)) return "v";
  if (/matrix\(0 1 1 0/.test(svg)) return "diag";
  if (/matrix\(0 -1 -1 0/.test(svg)) return "anti";
  return "none";
}
const ROT_SYM = { cross: 90, star: 72, triangle: 360, arrow: 360 };
function canon(shape, a) { const s = ROT_SYM[shape] || 360; return ((a % 360) + 360) % 360 % s; }
const SHAPES = ["triangle", "arrow", "cross", "star"];
const SHAPE_LABELS = { triangle: "figure triangulaire", arrow: "flèche", cross: "croix", star: "étoile" };
function shapeFromQ(q) {
  for (const [s, l] of Object.entries(SHAPE_LABELS)) if (q.text.includes(l)) return s;
  return null;
}
const ROT_LABELS = {
  "90° vers la droite": 90, "180°": 180, "90° vers la gauche": 270,
  "270° vers la droite": 270, "un quart de tour dans le sens horaire": 90
};

// Star rotation analysis
console.log("=== STAR ROTATIONS ===");
Q.filter(q => q.spatialType === "rotations" && shapeFromQ(q) === "star").forEach(q => {
  const base = getRotate(q.visual.svg);
  const label = q.text.match(/rotation de (.+?) \?/)[1];
  const delta = ROT_LABELS[label];
  const expected = ((base + delta) % 360 + 360) % 360;
  const expC = canon("star", expected);
  const opts = q.options.map((o, i) => {
    const a = getRotate(o.svg);
    return { L: String.fromCharCode(65+i), a, c: canon("star", a), ok: canon("star", a) === expC };
  });
  const ok = opts.filter(o => o.ok);
  const vis = new Map();
  opts.forEach(o => { if (!vis.has(o.c)) vis.set(o.c, []); vis.get(o.c).push(o.L); });
  const visDup = [...vis.entries()].filter(([,v]) => v.length > 1);
  console.log(q.id, label, "base", base, "exp", expected, "expCanon", expC);
  console.log("  opts", opts);
  if (ok.length > 1) console.log("  MULTIPLE CORRECT:", ok.map(o => o.L));
  if (visDup.length) console.log("  VIS DUP:", visDup);
});

// Symmetry: compare option SVGs for visual equivalence under rotation for symmetric shapes
console.log("\n=== SYMMETRIES cross/star ===");
Q.filter(q => q.spatialType === "symmetries").forEach(q => {
  const shape = shapeFromQ(q);
  if (shape !== "cross" && shape !== "star") return;
  const opts = q.options.map((o, i) => ({
    L: String.fromCharCode(65+i),
    m: getMirror(o.svg),
    a: getRotate(o.svg),
    c: `${canon(shape, getRotate(o.svg))}|${getMirror(o.svg)}`,
    ans: i === q.answer
  }));
  const groups = new Map();
  opts.forEach(o => { if (!groups.has(o.c)) groups.set(o.c, []); groups.get(o.c).push(o); });
  const amb = [...groups.entries()].filter(([,g]) => g.length > 1);
  if (amb.length) {
    console.log(q.id, shape, q.text.match(/axe .+/)[0]);
    amb.forEach(([k, g]) => console.log(" ", k, g));
  }
});

// Cube: same multiset of faces (permutation)
console.log("\n=== CUBE PERMUTATIONS (same 3 faces, different order) ===");
Q.filter(q => q.spatialType === "cubes").forEach(q => {
  const opts = q.options.map((o, i) => ({ L: String.fromCharCode(65+i), f: cubeFacesFromSvg(o.svg), ans: i === q.answer }));
  const correct = opts[q.answer];
  if (!correct?.f) return;
  const set = correct.f.slice().sort().join("");
  const perm = opts.filter(o => o.f && o.f.slice().sort().join("") === set && o.L !== correct.L);
  if (perm.length) {
    console.log(q.id, "correct", correct.L, correct.f, "same-set others:", perm.map(p => `${p.L}:${p.f.join(",")}`));
  }
});

// Sequence: verify logic - compute expected next step
console.log("\n=== SEQUENCE logic check ===");
const steps = [45, 60, 90, 120, 135];
Q.filter(q => q.spatialType === "sequences").forEach(q => {
  const idx = Number(q.id.split("-")[1]) - 1;
  const shape = SHAPES[(idx + 2) % 4];
  const startAngle = [0, 30, 45, 90][idx % 4];
  const step = steps[idx % steps.length];
  const expected = ((startAngle + 4 * step) % 360 + 360) % 360;
  const opts = q.options.map((o, i) => ({
    L: String.fromCharCode(65+i),
    a: getRotate(o.svg),
    m: getMirror(o.svg),
    c: canon(shape, getRotate(o.svg)),
    ans: i === q.answer
  }));
  const alsoMatch = opts.filter(o => o.a === expected && o.m === "none" && !o.ans);
  const visDup = new Map();
  opts.forEach(o => {
    const k = `${o.c}|${o.m}`;
    if (!visDup.has(k)) visDup.set(k, []);
    visDup.get(k).push(o);
  });
  const vd = [...visDup.entries()].filter(([,g]) => g.length > 1);
  if (alsoMatch.length || vd.some(([,g]) => g.some(x => x.ans) && g.length > 1)) {
    console.log(q.id, shape, "expected angle", expected);
    console.log("  opts", opts);
    if (alsoMatch.length) console.log("  ALSO LOGICALLY CORRECT:", alsoMatch);
    vd.forEach(([k,g]) => { if (g.length > 1) console.log("  vis equiv", k, g.map(x => x.L + (x.ans ? "*" : ""))); });
  }
});
