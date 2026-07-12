const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const Q = sandbox.window.SpatialQuestionBank.createQuestions();

function normSvg(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function getMirror(svg) {
  if (/scale\(\s*1\s+-1\s*\)/.test(svg)) return "h";
  if (/scale\(\s*-1\s+1\s*\)/.test(svg)) return "v";
  if (/matrix\(0 1 1 0/.test(svg)) return "diag";
  if (/matrix\(0 -1 -1 0/.test(svg)) return "anti";
  return "none";
}
function getRotate(svg) { const m = svg.match(/rotate\(([-\d.]+)\)/); return m ? Number(m[1]) : null; }

const AXES = { horizontal: "h", vertical: "v", "diagonal descendant": "diag", "diagonal montant": "anti" };
const SHAPE_LABELS = { triangle: "figure triangulaire", arrow: "flèche", cross: "croix", star: "étoile" };
function shapeFromQ(q) {
  for (const [s, l] of Object.entries(SHAPE_LABELS)) if (q.text.includes(l)) return s;
  return null;
}

console.log("=== SYMMETRY: identical SVG between answer and other options ===");
Q.filter(q => q.spatialType === "symmetries").forEach(q => {
  const shape = shapeFromQ(q);
  const axisLabel = q.text.match(/axe (horizontal|vertical|diagonal descendant|diagonal montant)/)?.[1];
  const axis = AXES[axisLabel];
  const opts = q.options.map((o, i) => ({ L: String.fromCharCode(65+i), svg: normSvg(o.svg), m: getMirror(o.svg), ans: i === q.answer }));
  const correct = opts[q.answer];
  const sameAsCorrect = opts.filter(o => o.svg === correct.svg && o.L !== correct.L);
  if (sameAsCorrect.length) {
    console.log(q.id, shape, axisLabel, "correct", correct.L, "mirror", correct.m, "same:", sameAsCorrect.map(x => `${x.L}(${x.m})`));
  }
});

console.log("\n=== SYMMETRY: cross with axis matching its symmetry ===");
// Cross has h and v symmetry in its markup (symmetric cross shape)
// Orange dot at top breaks perfect symmetry unless rotated
Q.filter(q => q.spatialType === "symmetries" && shapeFromQ(q) === "cross").forEach(q => {
  const axisLabel = q.text.match(/axe (horizontal|vertical|diagonal descendant|diagonal montant)/)?.[1];
  const baseAngle = getRotate(q.visual.svg);
  const opts = q.options.map((o, i) => ({ L: String.fromCharCode(65+i), m: getMirror(o.svg), svg: normSvg(o.svg), ans: i === q.answer }));
  // group by svg
  const g = new Map();
  opts.forEach(o => { if (!g.has(o.svg)) g.set(o.svg, []); g.get(o.svg).push(o); });
  g.forEach((grp, svg) => {
    if (grp.length > 1) console.log(q.id, "angle", baseAngle, "axis", axisLabel, grp);
  });
});

console.log("\n=== ALL sequences with visual dup groups ===");
const SHAPES = ["triangle", "arrow", "cross", "star"];
const ROT_SYM = { cross: 90, star: 72, triangle: 360, arrow: 360 };
function canon(shape, a) { return ((a % 360) + 360) % 360 % (ROT_SYM[shape] || 360); }

Q.filter(q => q.spatialType === "sequences").forEach(q => {
  const idx = Number(q.id.split("-")[1]) - 1;
  const shape = SHAPES[(idx + 2) % 4];
  const opts = q.options.map((o, i) => ({
    L: String.fromCharCode(65+i), a: getRotate(o.svg), m: getMirror(o.svg),
    c: `${canon(shape, getRotate(o.svg))}|${getMirror(o.svg)}`, ans: i === q.answer
  }));
  const g = new Map();
  opts.forEach(o => { if (!g.has(o.c)) g.set(o.c, []); g.get(o.c).push(o); });
  g.forEach((grp, k) => {
    if (grp.length > 1) console.log(q.id, shape, k, grp.map(x => x.L + (x.ans ? "*" : "") + `@${x.a}`));
  });
});
