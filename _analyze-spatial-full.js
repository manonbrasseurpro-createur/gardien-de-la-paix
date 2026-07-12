const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const questions = sandbox.window.SpatialQuestionBank.createQuestions();

const SHAPES = ["triangle", "arrow", "cross", "star"];
const ROTATION_SYMMETRY = { cross: 90, star: 72, triangle: 360, arrow: 360 };
const SHAPE_LABELS = {
  triangle: "figure triangulaire",
  arrow: "flèche",
  cross: "croix",
  star: "étoile"
};

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
  if (/matrix\(0 1 1 0/.test(svg)) return "diag";
  if (/matrix\(0 -1 -1 0/.test(svg)) return "anti";
  return "none";
}

function shapeFromQuestion(question) {
  for (const [shape, label] of Object.entries(SHAPE_LABELS)) {
    if (question.text.includes(label)) return shape;
  }
  const m = question.id.match(/^(rotation|symmetry|sequence)-(\d+)$/);
  if (m) {
    const idx = Number(m[2]) - 1;
    if (m[1] === "rotation") return SHAPES[idx % SHAPES.length];
    if (m[1] === "symmetry") return SHAPES[(idx + 1) % SHAPES.length];
    if (m[1] === "sequence") return SHAPES[(idx + 2) % SHAPES.length];
  }
  return null;
}

function canonicalRotation(shape, angle) {
  const symmetry = ROTATION_SYMMETRY[shape] || 360;
  return ((angle % 360) + 360) % 360 % symmetry;
}

function formatOptions(indices) {
  return indices.map((i) => String.fromCharCode(65 + i)).join(", ");
}

function groupBy(items, keyFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()].filter(([, g]) => g.length > 1);
}

function report(problems, problem) {
  const exists = problems.some(
    (e) => e.id === problem.id && e.issue === problem.issue && e.detail === problem.detail
  );
  if (!exists) problems.push(problem);
}

function parseRotationPrompt(text) {
  const m = text.match(/rotation de (.+?) \?/);
  return m ? m[1] : null;
}

function rotationDelta(label) {
  const map = {
    "90° vers la droite": 90,
    "180°": 180,
    "90° vers la gauche": 270,
    "270° vers la droite": 270,
    "un quart de tour dans le sens horaire": 90
  };
  return map[label] ?? null;
}

function equivalentRotationLabels() {
  return [
    ["90° vers la gauche", "270° vers la droite"]
  ];
}

const problems = [];

// 1. Strict SVG duplicates (all types)
questions.forEach((q) => {
  groupBy(
    q.options.map((o, i) => ({ i, key: normSvg(o.svg) })),
    (x) => x.key
  ).forEach(([, g]) => {
    const indices = g.map((x) => x.i);
    report(problems, {
      id: q.id,
      type: q.spatialType || q.type,
      issue: indices.includes(q.answer) ? "ambiguïté" : "doublon",
      detail: `Propositions strictement identiques (SVG) : ${formatOptions(indices)}.`
    });
  });
});

// 2. Rotations — visual equivalence under shape symmetry
questions
  .filter((q) => q.spatialType === "rotations")
  .forEach((q) => {
    const shape = shapeFromQuestion(q);
    if (!shape) return;

    const baseAngle = getRotate(q.visual.svg);
    const promptLabel = parseRotationPrompt(q.text);
    const delta = rotationDelta(promptLabel);
    if (baseAngle === null || delta === null) return;

    const expectedAngle = ((baseAngle + delta) % 360 + 360) % 360;
    const expectedCanon = canonicalRotation(shape, expectedAngle);

    const states = q.options.map((o, i) => {
      const angle = getRotate(o.svg);
      return {
        i,
        angle,
        canon: canonicalRotation(shape, angle),
        matchesExpected: canonicalRotation(shape, angle) === expectedCanon
      };
    });

    // Visual duplicates via canonical rotation
    groupBy(states, (s) => String(s.canon)).forEach(([, g]) => {
      if (g.length <= 1) return;
      const indices = g.map((s) => s.i);
      const angles = g.map((s) => s.angle).join("°, ");
      const hasCorrect = g.some((s) => s.matchesExpected);
      report(problems, {
        id: q.id,
        type: "rotations",
        issue: hasCorrect && g.filter((s) => s.matchesExpected).length > 1 ? "ambiguïté" : hasCorrect ? "ambiguïté" : "doublon",
        detail:
          `Figure « ${SHAPE_LABELS[shape]} » (symétrie rotation ${ROTATION_SYMMETRY[shape]}°) : options ${formatOptions(indices)} ` +
          `visuellement indiscernables (angles ${angles}°).` +
          (hasCorrect
            ? ` Plusieurs correspondent à la rotation demandée (${promptLabel}, attendu canon ${expectedCanon}°).`
            : "")
      });
    });

    // Multiple options match expected rotation
    const matching = states.filter((s) => s.matchesExpected);
    if (matching.length > 1) {
      report(problems, {
        id: q.id,
        type: "rotations",
        issue: "ambiguïté",
        detail:
          `Plusieurs propositions (${formatOptions(matching.map((s) => s.i))}) satisfont la rotation « ${promptLabel} » ` +
          `(figure de départ ${baseAngle}° → attendu ${expectedAngle}°, canon ${expectedCanon}°).`
      });
    }

    // Equivalent wording in prompt (90° gauche = 270° droite) — note if same question bank index pattern
    equivalentRotationLabels().forEach(([a, b]) => {
      if (promptLabel === a || promptLabel === b) {
        // Only flag if another rotation question uses the equivalent label for same shape+base
        // This is informational — check distractors that ARE the correct answer under equivalent description
      }
    });
  });

// 3. Rotations — equivalent rotation labels across question set (pedagogical ambiguity in wording)
const rotationQuestions = questions.filter((q) => q.spatialType === "rotations");
rotationQuestions.forEach((q) => {
  const label = parseRotationPrompt(q.text);
  if (label === "90° vers la gauche" || label === "270° vers la droite") {
    report(problems, {
      id: q.id,
      type: "rotations",
      issue: "ambiguïté",
      detail: `Libellé « ${label} » : formulation équivalente à « ${label === "90° vers la gauche" ? "270° vers la droite" : "90° vers la gauche"} » (même rotation). Ambiguïté pédagogique du libellé, pas des options SVG.`
    });
  }
});

// 4. Symmetries — strict duplicates already covered; check "none" mirror = original when shape+angle has symmetry
questions
  .filter((q) => q.spatialType === "symmetries")
  .forEach((q) => {
    const shape = shapeFromQuestion(q);
    const baseAngle = getRotate(q.visual.svg);
    const axisMatch = q.text.match(/axe (horizontal|vertical|diagonal descendant|diagonal montant)/);
    const axis = axisMatch
      ? { horizontal: "h", vertical: "v", "diagonal descendant": "diag", "diagonal montant": "anti" }[axisMatch[1]]
      : null;

    q.options.forEach((o, i) => {
      const mirror = getMirror(o.svg);
      if (mirror === "none" && i !== q.answer) {
        const origSvg = normSvg(
          sandbox.window.SpatialQuestionBank
            ? null
            : null
        );
        // Compare option "none" SVG to a pure rotation of original (symmetry prompt uses centerTransform on shape only for options via worldMirrorTransform)
      }
    });

    // Visual equivalence: two different mirror transforms yielding same SVG
    groupBy(
      q.options.map((o, i) => ({
        i,
        key: normSvg(o.svg),
        mirror: getMirror(o.svg),
        angle: getRotate(o.svg)
      })),
      (x) => x.key
    ).forEach(([, g]) => {
      if (g.length <= 1) return;
      const indices = g.map((x) => x.i);
      report(problems, {
        id: q.id,
        type: "symmetries",
        issue: indices.includes(q.answer) ? "ambiguïté" : "doublon",
        detail: `Propositions visuellement identiques (SVG) : ${formatOptions(indices)} — miroirs ${g.map((x) => x.mirror).join(", ")}.`
      });
    });

    // If correct answer mirror applied equals another option's visual under shape symmetry
    const shapeSym = ROTATION_SYMMETRY[shape] || 360;
    if (shapeSym < 360) {
      groupBy(
        q.options.map((o, i) => ({
          i,
          canon: `${canonicalRotation(shape, getRotate(o.svg))}|${getMirror(o.svg)}`
        })),
        (x) => x.canon
      ).forEach(([, g]) => {
        if (g.length <= 1) return;
        const indices = g.map((x) => x.i);
        report(problems, {
          id: q.id,
          type: "symmetries",
          issue: indices.includes(q.answer) ? "ambiguïté" : "doublon",
          detail: `Figure « ${SHAPE_LABELS[shape]} » : options ${formatOptions(indices)} équivalentes modulo symétrie rotation ${shapeSym}° + miroir.`
        });
      });
    }
  });

// 5. Sequences — visual equivalence
questions
  .filter((q) => q.spatialType === "sequences")
  .forEach((q) => {
    const shape = shapeFromQuestion(q);
    groupBy(
      q.options.map((o, i) => ({
        i,
        key: `${canonicalRotation(shape, getRotate(o.svg))}|${getMirror(o.svg)}`
      })),
      (x) => x.key
    ).forEach(([, g]) => {
      if (g.length <= 1) return;
      const indices = g.map((x) => x.i);
      report(problems, {
        id: q.id,
        type: "sequences",
        issue: indices.includes(q.answer) ? "ambiguïté" : "doublon",
        detail: `États visuellement équivalents (rotation canonique + miroir) : ${formatOptions(indices)}.`
      });
    });
  });

// 6. Cubes — duplicate SVG + check if wrong options could be valid for different vertex views
questions
  .filter((q) => q.spatialType === "cubes")
  .forEach((q) => {
    // face triplets from SVG are hard to parse; strict SVG dup already handled
    // Check if option face sets appear as permutations that could be same cube orientation
    const facePattern = /CUBE_FACES\[(\w)\]/g;
  });

// 7. Folding — duplicate point sets (strict SVG already); check reflect symmetry of wrong answers
questions
  .filter((q) => q.spatialType === "folding")
  .forEach((q) => {
    groupBy(
      q.options.map((o, i) => ({ i, key: normSvg(o.svg) })),
      (x) => x.key
    ).forEach(([, g]) => {
      if (g.length <= 1) return;
      const indices = g.map((x) => x.i);
      report(problems, {
        id: q.id,
        type: "folding",
        issue: indices.includes(q.answer) ? "ambiguïté" : "doublon",
        detail: `Motifs dépliés strictement identiques : ${formatOptions(indices)}.`
      });
    });
  });

// Dedupe overlapping reports for same id+issue type
const byId = new Map();
problems.forEach((p) => {
  const key = `${p.id}|${p.issue}|${p.detail.slice(0, 40)}`;
  if (!byId.has(key)) byId.set(key, p);
});

const final = [...byId.values()].sort((a, b) => {
  const typeOrder = { rotations: 0, symmetries: 1, sequences: 2, cubes: 3, folding: 4 };
  return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || a.id.localeCompare(b.id, undefined, { numeric: true });
});

console.log(
  JSON.stringify(
    {
      totalQuestions: questions.length,
      problemCount: final.length,
      byType: final.reduce((acc, p) => {
        acc[p.type] = (acc[p.type] || 0) + 1;
        return acc;
      }, {}),
      problems: final
    },
    null,
    2
  )
);
