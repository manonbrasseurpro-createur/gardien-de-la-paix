const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const questions = sandbox.window.SpatialQuestionBank.createQuestions();

function getRotate(svg) {
  const match = svg.match(/rotate\(([-\d.]+)\)/);
  return match ? Number(match[1]) : null;
}

function canonicalCross(angle) {
  return ((angle % 360) + 360) % 360 % 90;
}

function formatOptions(indices) {
  return indices.map((index) => String.fromCharCode(65 + index)).join(", ");
}

const problems = [];

questions
  .filter((question) => question.spatialType === "rotations")
  .forEach((question) => {
    const shapeMatch = question.text.match(/figure (triangulaire|flèche|croix|étoile)/);
    const shape = shapeMatch ? shapeMatch[1] : null;
    const angles = question.options.map((option) => getRotate(option.svg));

    if (shape === "croix") {
      const groups = new Map();
      angles.forEach((angle, index) => {
        const key = canonicalCross(angle);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ index, angle });
      });

      groups.forEach((entries, canonical) => {
        if (entries.length <= 1) return;
        const indices = entries.map((entry) => entry.index);
        problems.push({
          id: question.id,
          type: "rotations",
          issue: indices.includes(question.answer) ? "ambiguïté" : "doublon",
          detail:
            `Croix (symétrie 90°) : options ${formatOptions(indices)} ` +
            `partagent la même orientation visuelle (angles ${entries.map((entry) => entry.angle + "°").join(", ")}, canon ${canonical}°). ` +
            `Question : ${question.text}`
        });
      });
    }
  });

console.log(JSON.stringify(problems, null, 2));
