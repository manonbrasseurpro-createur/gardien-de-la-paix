const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const Q = sandbox.window.SpatialQuestionBank.createQuestions();

function normSvg(v) { return String(v || "").replace(/\s+/g, " ").trim(); }

// Extract hole positions from unfolded result SVG
function holeKey(svg) {
  const circles = [...svg.matchAll(/circle cx="([\d.]+)" cy="([\d.]+)"/g)].map(m => `c:${Math.round(m[1])},${Math.round(m[2])}`);
  const rects = [...svg.matchAll(/rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)]
    .filter(m => Number(m[3]) <= 15) // hole rects not frame
    .map(m => `r:${Math.round(Number(m[1])+6)},${Math.round(Number(m[2])+6)}`);
  return [...circles, ...rects].sort().join("|");
}

console.log("=== FOLDING hole pattern duplicates ===");
Q.filter(q => q.spatialType === "folding").forEach(q => {
  const keys = q.options.map((o, i) => ({ L: String.fromCharCode(65+i), k: holeKey(o.svg), svg: normSvg(o.svg), ans: i === q.answer }));
  const g = new Map();
  keys.forEach(x => { if (!g.has(x.k)) g.set(x.k, []); g.get(x.k).push(x); });
  g.forEach(grp => {
    if (grp.length > 1) console.log(q.id, grp.map(x => x.L + (x.ans ? "*" : "")));
  });
  // Also strict svg dup
  const sg = new Map();
  keys.forEach(x => { if (!sg.has(x.svg)) sg.set(x.svg, []); sg.get(x.svg).push(x); });
  sg.forEach(grp => {
    if (grp.length > 1) console.log(q.id, "SVG dup", grp.map(x => x.L));
  });
});

console.log("\nDone. Folding count:", Q.filter(q => q.spatialType === "folding").length);
