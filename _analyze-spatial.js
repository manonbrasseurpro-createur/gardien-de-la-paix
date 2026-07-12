const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const questions = sandbox.window.SpatialQuestionBank.createQuestions();

const ROTATION_SYMMETRY = { cross: 90, star: 72, triangle: 360, arrow: 360 };

function normSvg(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getRotate(svg) {
  const match = svg.match(/rotate\(([-\d.]+)\)/);
  return match ? Number(match[1]) : null;
}

function getMirror(svg) {
  if (/scale\(\s*1\s+-1\s*\)/.test(svg)) return "h";
  if (/scale\(\s*-1\s+1\s*\)/.test(svg)) return "v";
  if (/scale\(\s*-1\s+-1\s*\)/.test(svg)) return "both";
  return "none";
}

function shapeFromQuestion(question) {
  const match = question.text.match(/figure (triangulaire|flèche|croix|étoile)/);
  if (!match) return null;
  return {
    triangulaire: "triangle",
    "flèche": "arrow",
    croix: "cross",
    "étoile": "star"
  }[match[1]];
}

function canonicalRotation(shape, angle) {
  const symmetry = ROTATION_SYMMETRY[shape] || 360;
  return ((angle % 360) + 360) % 360 % symmetry;
}

function formatOptions(indices) {
  return indices.map((index) => String.fromCharCode(65 + index)).join(", ");
}

function groupBy(items, keyFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()].filter(([, group]) => group.length > 1);
}

const problems = [];

function report(problem) {
  const exists = problems.some(
    (entry) => entry.id === problem.id && entry.issue === problem.issue && entry.detail === problem.detail
  );
  if (!exists) problems.push(problem);
}

questions.forEach((question) => {
  const svgKeys = question.options.map((option) => normSvg(option.svg));
  groupBy(
    svgKeys.map((key, index) => ({ key, index })),
    (item) => item.key
  ).forEach(([, group]) => {
    const indices = group.map((item) => item.index);
    report({
      id: question.id,
      type: question.spatialType || question.type,
      issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
      detail: `Propositions strictement identiques (SVG) : ${formatOptions(indices)}.`
    });
  });
});

questions
  .filter((question) => question.spatialType === "rotations")
  .forEach((question) => {
    const shape = shapeFromQuestion(question);
    if (!shape) return;

    const states = question.options.map((option, index) => ({
      index,
      angle: getRotate(option.svg),
      canonical: canonicalRotation(shape, getRotate(option.svg))
    }));

    groupBy(states, (state) => String(state.canonical)).forEach(([, group]) => {
      const indices = group.map((state) => state.index);
      if (indices.length <= 1) return;
      const angles = group.map((state) => state.angle).join("°, ");
      report({
        id: question.id,
        type: "rotations",
        issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
        detail:
          `Figure ${shape} — symétrie rotation ${ROTATION_SYMMETRY[shape]}° : les options ${formatOptions(indices)} ` +
          `sont visuellement indiscernables (angles ${angles}°) pour « ${question.text.replace("Quelle option montre la ", "").replace(" ?", "")} ».`
      });
    });
  });

questions
  .filter((question) => question.spatialType === "symmetries")
  .forEach((question) => {
    groupBy(
      question.options.map((option, index) => ({
        index,
        key: normSvg(option.svg)
      })),
      (item) => item.key
    ).forEach(([, group]) => {
      const indices = group.map((item) => item.index);
      report({
        id: question.id,
        type: "symmetries",
        issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
        detail: `Propositions strictement identiques (SVG) : ${formatOptions(indices)} — ${question.text}`
      });
    });
  });

questions
  .filter((question) => question.spatialType === "sequences")
  .forEach((question) => {
    const shape = shapeFromQuestion(question) || "triangle";
    groupBy(
      question.options.map((option, index) => ({
        index,
        key: `${canonicalRotation(shape, getRotate(option.svg))}|${getMirror(option.svg)}`
      })),
      (item) => item.key
    ).forEach(([, group]) => {
      const indices = group.map((item) => item.index);
      if (indices.length <= 1) return;
      report({
        id: question.id,
        type: "sequences",
        issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
        detail: `États visuellement équivalents (rotation canonique + miroir) : ${formatOptions(indices)}.`
      });
    });
  });

questions
  .filter((question) => question.spatialType === "cubes")
  .forEach((question) => {
    groupBy(
      question.options.map((option, index) => ({ index, key: normSvg(option.svg) })),
      (item) => item.key
    ).forEach(([, group]) => {
      const indices = group.map((item) => item.index);
      report({
        id: question.id,
        type: "cubes",
        issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
        detail: `Cubes strictement identiques : ${formatOptions(indices)}.`
      });
    });
  });

questions
  .filter((question) => question.spatialType === "folding")
  .forEach((question) => {
    groupBy(
      question.options.map((option, index) => ({ index, key: normSvg(option.svg) })),
      (item) => item.key
    ).forEach(([, group]) => {
      const indices = group.map((item) => item.index);
      report({
        id: question.id,
        type: "folding",
        issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
        detail: `Motifs dépliés strictement identiques : ${formatOptions(indices)}.`
      });
    });
  });

console.log(JSON.stringify({ totalQuestions: questions.length, problemCount: problems.length, problems }, null, 2));
