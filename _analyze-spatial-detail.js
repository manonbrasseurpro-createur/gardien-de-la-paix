const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("spatial-bank.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const Q = sandbox.window.SpatialQuestionBank.createQuestions();

const SHAPES = ["triangle", "arrow", "cross", "star"];
const ROT_SYM = { cross: 90, star: 72, triangle: 360, arrow: 360 };
const SHAPE_LABELS = { triangle: "figure triangulaire", arrow: "flèche", cross: "croix", star: "étoile" };

function normSvg(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function getRotate(svg) { const m = svg.match(/rotate\(([-\d.]+)\)/); return m ? Number(m[1]) : null; }
function getMirror(svg) {
  if (/scale\(\s*1\s+-1\s*\)/.test(svg)) return "h";
  if (/scale\(\s*-1\s+1\s*\)/.test(svg)) return "v";
  if (/matrix\(0 1 1 0/.test(svg)) return "diag";
  if (/matrix\(0 -1 -1 0/.test(svg)) return "anti";
  return "none";
}
function shapeFromQ(q) {
  for (const [s, l] of Object.entries(SHAPE_LABELS)) if (q.text.includes(l)) return s;
  const m = q.id.match(/^(rotation|symmetry|sequence)-(\d+)$/);
  if (!m) return null;
  const i = Number(m[2]) - 1;
  if (m[1] === "rotation") return SHAPES[i % 4];
  if (m[1] === "symmetry") return SHAPES[(i + 1) % 4];
  if (m[1] === "sequence") return SHAPES[(i + 2) % 4];
  return null;
}
function canon(shape, angle) { const s = ROT_SYM[shape] || 360; return ((angle % 360) + 360) % 360 % s; }
function opt(i) { return String.fromCharCode(65 + i); }

// Cube face extraction from generated SVG fill colors / we re-derive from question generation logic
// Parse cube option faces by matching fill colors to CUBE_FACES
const FACE_BY_FILL = {
  "#2f5f9f": "A", "#8fb3e8": "B", "#dce7ff": "C", "#f3a64a": "D", "#42a67f": "E", "#ffffff": "F"
};
function cubeFacesFromSvg(svg) {
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]+)"/gi)].map(m => m[1].toLowerCase());
  const faces = fills.filter(f => FACE_BY_FILL[f]).map(f => FACE_BY_FILL[f]);
  return faces.length >= 3 ? faces.slice(0, 3) : null;
}

// Standard cube net adjacency (face neighbors when folded)
const ADJ = {
  A: ["B", "C", "D", "E"],
  B: ["A", "C", "F", "E"],
  C: ["A", "B", "D", "F"],
  D: ["A", "C", "F", "E"],
  E: ["A", "B", "F", "D"],
  F: ["B", "C", "D", "E"]
};

function areAdjacent(a, b) { return ADJ[a]?.includes(b); }
function isValidCornerTriple([top, left, right]) {
  return areAdjacent(top, left) && areAdjacent(top, right) && areAdjacent(left, right);
}

const ROT_LABELS = {
  "90° vers la droite": 90, "180°": 180, "90° vers la gauche": 270,
  "270° vers la droite": 270, "un quart de tour dans le sens horaire": 90
};

const out = { strictSvgDup: [], rotation: [], symmetry: [], sequence: [], cube: [], folding: [] };

Q.forEach(q => {
  const keys = q.options.map(o => normSvg(o.svg));
  const seen = new Map();
  keys.forEach((k, i) => {
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(i);
  });
  seen.forEach((indices, k) => {
    if (indices.length > 1) {
      out.strictSvgDup.push({ id: q.id, type: q.spatialType, indices: indices.map(opt), includesAnswer: indices.includes(q.answer) });
    }
  });
});

Q.filter(q => q.spatialType === "rotations").forEach(q => {
  const shape = shapeFromQ(q);
  const base = getRotate(q.visual.svg);
  const label = q.text.match(/rotation de (.+?) \?/)[1];
  const delta = ROT_LABELS[label];
  const expected = ((base + delta) % 360 + 360) % 360;
  const expCanon = canon(shape, expected);
  const opts = q.options.map((o, i) => {
    const a = getRotate(o.svg);
    return { i, a, c: canon(shape, a), ok: canon(shape, a) === expCanon };
  });
  const visGroups = new Map();
  opts.forEach(o => {
    const k = String(o.c);
    if (!visGroups.has(k)) visGroups.set(k, []);
    visGroups.get(k).push(o);
  });
  visGroups.forEach((g, k) => {
    if (g.length > 1) {
      out.rotation.push({
        id: q.id, shape, label, base, expected, expCanon,
        kind: "visuellement_identiques",
        options: g.map(x => ({ letter: opt(x.i), angle: x.a, correct: x.ok })),
        allCorrect: g.every(x => x.ok)
      });
    }
  });
  const corrects = opts.filter(o => o.ok);
  if (corrects.length > 1) {
    out.rotation.push({
      id: q.id, shape, label, base, expected,
      kind: "plusieurs_bonnes_reponses",
      options: corrects.map(x => ({ letter: opt(x.i), angle: x.a }))
    });
  }
  // Star-specific: check if distractors at wrong canon still look like valid rotation answers
  if (shape === "star") {
    const starGroups = opts.filter(o => o.c === expCanon);
    if (starGroups.length > 1) {
      out.rotation.push({ id: q.id, shape: "star", kind: "star_ambiguity", count: starGroups.length });
    }
  }
});

Q.filter(q => q.spatialType === "symmetries").forEach(q => {
  const shape = shapeFromQ(q);
  const axis = q.text.match(/axe (horizontal|vertical|diagonal descendant|diagonal montant)/)?.[1];
  const opts = q.options.map((o, i) => ({ i, mirror: getMirror(o.svg), angle: getRotate(o.svg), svg: normSvg(o.svg) }));
  const dup = new Map();
  opts.forEach(o => {
    if (!dup.has(o.svg)) dup.set(o.svg, []);
    dup.get(o.svg).push(o);
  });
  dup.forEach(g => {
    if (g.length > 1) {
      out.symmetry.push({
        id: q.id, shape, axis,
        kind: "svg_identiques",
        options: g.map(x => ({ letter: opt(x.i), mirror: x.mirror }))
      });
    }
  });
  // cross/star: "none" option might look like correct reflection for symmetric figures
  opts.forEach(o => {
    if (o.mirror === "none" && o.i !== q.answer) {
      // compare with answer option
    }
  });
});

Q.filter(q => q.spatialType === "sequences").forEach(q => {
  const shape = shapeFromQ(q);
  const opts = q.options.map((o, i) => ({
    i, a: getRotate(o.svg), m: getMirror(o.svg), c: `${canon(shape, getRotate(o.svg))}|${getMirror(o.svg)}`
  }));
  const g = new Map();
  opts.forEach(o => {
    if (!g.has(o.c)) g.set(o.c, []);
    g.get(o.c).push(o);
  });
  g.forEach(grp => {
    if (grp.length > 1) {
      out.sequence.push({
        id: q.id, shape,
        options: grp.map(x => ({ letter: opt(x.i), angle: x.a, mirror: x.m, isAnswer: x.i === q.answer })),
        text: q.text
      });
    }
  });
});

Q.filter(q => q.spatialType === "cubes").forEach(q => {
  const faces = q.options.map((o, i) => ({ i, faces: cubeFacesFromSvg(o.svg), svgKey: normSvg(o.svg) }));
  const dup = new Map();
  faces.forEach(f => {
    if (!f.faces) return;
    const k = f.faces.join("-");
    if (!dup.has(k)) dup.set(k, []);
    dup.get(k).push(f);
  });
  dup.forEach(g => {
    if (g.length > 1) {
      out.cube.push({ id: q.id, kind: "memes_faces", triplets: g.map(x => ({ letter: opt(x.i), faces: x.faces })) });
    }
  });
  faces.forEach(f => {
    if (!f.faces) return;
    const valid = isValidCornerTriple(f.faces);
    if (valid && f.i !== q.answer) {
      // could be valid cube view but wrong for this net - need net-specific check
    }
  });
  // All options with valid corner triples that share two faces with correct answer
  const correct = faces[q.answer];
  if (correct?.faces) {
    const alsoValid = faces.filter(f => f.i !== q.answer && f.faces && isValidCornerTriple(f.faces));
    if (alsoValid.length) {
      out.cube.push({
        id: q.id, kind: "triplets_geometriquement_valides",
        correct: { letter: opt(q.answer), faces: correct.faces },
        others: alsoValid.map(x => ({ letter: opt(x.i), faces: x.faces }))
      });
    }
  }
});

Q.filter(q => q.spatialType === "folding").forEach(q => {
  const keys = q.options.map((o, i) => ({ i, k: normSvg(o.svg) }));
  const m = new Map();
  keys.forEach(x => {
    if (!m.has(x.k)) m.set(x.k, []);
    m.get(x.k).push(x.i);
  });
  m.forEach((indices, k) => {
    if (indices.length > 1) {
      out.folding.push({ id: q.id, indices: indices.map(opt), includesAnswer: indices.includes(q.answer) });
    }
  });
});

console.log(JSON.stringify({
  strictSvgDupCount: out.strictSvgDup.length,
  rotationIssues: out.rotation.length,
  symmetryIssues: out.symmetry.length,
  sequenceIssues: out.sequence.length,
  cubeIssues: out.cube.length,
  foldingIssues: out.folding.length,
  out
}, null, 2));
