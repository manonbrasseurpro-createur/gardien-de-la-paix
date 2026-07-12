const fs = require("fs");
const vm = require("vm");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync("spatial-bank.js", "utf8"), sandbox);
const questions = sandbox.window.SpatialQuestionBank.createQuestions();

const ids = [
  "rotation-3", "rotation-7", "rotation-11", "rotation-15", "rotation-19",
  "sequence-1", "sequence-5", "sequence-13"
];
const ROT = { cross: 90, star: 72, triangle: 360, arrow: 360 };
const labels = { triangle: "figure triangulaire", arrow: "flèche", cross: "croix", star: "étoile" };

function shapeFrom(q) {
  for (const [k, v] of Object.entries(labels)) {
    if (q.text.includes(v)) return k;
  }
  return null;
}
function ang(svg) {
  const m = svg.match(/rotate\(([-\d.]+)\)/);
  return m ? Number(m[1]) : null;
}
function canon(shape, a) {
  return ((a % 360) + 360) % 360 % (ROT[shape] || 360);
}
function mir(svg) {
  if (/scale\(\s*1\s+-1/.test(svg)) return "h";
  if (/scale\(\s*-1\s+1/.test(svg)) return "v";
  return "none";
}

ids.forEach((id) => {
  const q = questions.find((x) => x.id === id);
  const sh = shapeFrom(q);
  const keys = q.options.map((o, i) => {
    const a = ang(o.svg);
    return `${canon(sh, a)}|${mir(o.svg)}`;
  });
  const dup = keys.length !== new Set(keys).size;
  console.log(`${id} shape=${sh} dup=${dup} text=${q.text.slice(0, 70)}...`);
  q.options.forEach((o, i) => {
    console.log(`  ${String.fromCharCode(65 + i)}: ${ang(o.svg)}° mirror=${mir(o.svg)}`);
  });
});
