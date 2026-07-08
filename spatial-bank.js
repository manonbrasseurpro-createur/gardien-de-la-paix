(function () {
  const TYPES = [
    { key: "rotations", label: "Rotations" },
    { key: "symmetries", label: "Symétries" },
    { key: "folding", label: "Pliages de papier" },
    { key: "cubes", label: "Patrons de cubes" },
    { key: "sequences", label: "Suites de figures" }
  ];

  const COLORS = {
    navy: "#1a2744",
    blue: "#2f5f9f",
    lightBlue: "#8fb3e8",
    paleBlue: "#dce7ff",
    orange: "#f3a64a",
    green: "#42a67f",
    red: "#cc5a5a",
    white: "#ffffff",
    offWhite: "#f5f7fb",
    border: "#d8deea"
  };

  const SHAPES = ["triangle", "arrow", "cross", "star"];

  // Croix remplacée sur ces indices : symétrie 90° rendant plusieurs options indiscernables.
  const ROTATION_SHAPE_OVERRIDE = {
    2: "triangle",
    6: "arrow",
    10: "triangle",
    14: "arrow",
    18: "triangle"
  };

  const SEQUENCE_SHAPE_OVERRIDE = {
    0: "triangle",
    4: "arrow",
    12: "triangle"
  };

  const AXES = [
    { key: "h", label: "horizontal", explanation: "Le reflet horizontal inverse le haut et le bas de la figure." },
    { key: "v", label: "vertical", explanation: "Le reflet vertical inverse la gauche et la droite de la figure." },
    { key: "diag", label: "diagonal descendant", explanation: "Le reflet diagonal échange les positions par rapport à la diagonale descendante." },
    { key: "anti", label: "diagonal montant", explanation: "Le reflet diagonal échange les positions par rapport à la diagonale montante." }
  ];

  const CUBE_FACES = {
    A: { fill: COLORS.blue, mark: COLORS.white, symbol: "circle" },
    B: { fill: COLORS.lightBlue, mark: COLORS.navy, symbol: "triangle" },
    C: { fill: COLORS.paleBlue, mark: COLORS.navy, symbol: "diamond" },
    D: { fill: COLORS.orange, mark: COLORS.navy, symbol: "bar" },
    E: { fill: COLORS.green, mark: COLORS.white, symbol: "dotpair" },
    F: { fill: COLORS.white, mark: COLORS.navy, symbol: "cross" }
  };

  function createQuestions() {
    return [
      ...createRotationQuestions(),
      ...createSymmetryQuestions(),
      ...createFoldingQuestions(),
      ...createCubeQuestions(),
      ...createSequenceQuestions()
    ];
  }

  function createRotationQuestions() {
    const questions = [];
    const rotations = [
      { label: "90° vers la droite", value: 90 },
      { label: "180°", value: 180 },
      { label: "90° vers la gauche", value: 270 },
      { label: "90° vers la gauche", value: 270 },
      { label: "90° vers la droite", value: 90 }
    ];

    for (let index = 0; index < 20; index += 1) {
      const shape = ROTATION_SHAPE_OVERRIDE[index] ?? SHAPES[index % SHAPES.length];
      const baseAngle = [0, 45, 90, 135, 180, 225, 270, 315][index % 8];
      const rotation = rotations[index % rotations.length];
      const answerAngle = normalizeAngle(baseAngle + rotation.value);
      const distractors = [
        normalizeAngle(baseAngle - rotation.value),
        normalizeAngle(answerAngle + 90),
        normalizeAngle(answerAngle + 180)
      ];
      const optionAngles = uniqueValues([answerAngle, ...distractors, baseAngle]);
      [45, 90, 135, 180, 225, 270, 315].forEach((offset) => {
        const candidate = normalizeAngle(answerAngle + offset);
        if (optionAngles.length < 4 && !optionAngles.includes(candidate)) {
          optionAngles.push(candidate);
        }
      });

      questions.push({
        id: `rotation-${index + 1}`,
        type: "Rotations",
        spatialType: "rotations",
        text: `Quelle option montre la ${shapeLabel(shape)} après une rotation de ${rotation.label} ?`,
        answer: 0,
        visual: {
          label: "Figure de départ",
          svg: shapeSvg(shape, baseAngle)
        },
        options: optionAngles.map((angle) => ({
          label: "Figure proposée",
          svg: shapeSvg(shape, angle)
        })),
        explanation: `La figure doit tourner de ${rotation.label}. L'orientation attendue est celle de la première option correcte avant mélange.`
      });
    }

    return questions;
  }

  function createSymmetryQuestions() {
    const questions = [];
    const transformsByAxis = {
      h: ["h", "none", "v", "diag"],
      v: ["v", "none", "h", "anti"],
      diag: ["diag", "none", "anti", "h"],
      anti: ["anti", "none", "diag", "v"]
    };

    for (let index = 0; index < 20; index += 1) {
      const shape = SHAPES[(index + 1) % SHAPES.length];
      const axis = AXES[index % AXES.length];
      const baseAngle = [0, 30, 60, 90, 120][index % 5];

      questions.push({
        id: `symmetry-${index + 1}`,
        type: "Symétries",
        spatialType: "symmetries",
        text: `Quelle option est le symétrique de la ${shapeLabel(shape)} orientée à ${baseAngle}° selon l'axe ${axis.label} ?`,
        answer: 0,
        visual: {
          label: `Figure de départ avec axe ${axis.label}`,
          svg: symmetryPromptSvg(shape, baseAngle, axis.key)
        },
        options: transformsByAxis[axis.key].map((mirror) => ({
          label: "Figure proposée",
          svg: symmetryOptionSvg(shape, baseAngle, mirror)
        })),
        explanation: axis.explanation
      });
    }

    return questions;
  }

  function createFoldingQuestions() {
    const questions = [];
    const foldPatterns = [
      { folds: ["v"], label: "pli vertical" },
      { folds: ["h"], label: "pli horizontal" },
      { folds: ["v", "h"], label: "pli vertical puis horizontal" },
      { folds: ["diag"], label: "pli diagonal" },
      { folds: ["h", "diag"], label: "pli horizontal puis diagonal" }
    ];
    const cuts = [
      [[34, 30], [78, 48]],
      [[28, 72], [70, 88]],
      [[44, 38], [84, 80]],
      [[24, 52], [58, 28]],
      [[52, 72], [90, 42]],
      [[36, 92], [82, 68]],
      [[30, 34], [66, 86]],
      [[48, 46], [96, 74]],
      [[26, 82], [74, 34]],
      [[56, 24], [88, 94]]
    ];

    for (let index = 0; index < 20; index += 1) {
      const pattern = foldPatterns[index % foldPatterns.length];
      const cutSet = canonicalFoldedCuts(cuts[index % cuts.length], pattern.folds);
      const correctPoints = unfoldPoints(cutSet, pattern.folds);
      const optionPointSets = paperOptionSets(correctPoints, pattern.folds, index);

      questions.push({
        id: `folding-${index + 1}`,
        type: "Pliages de papier",
        spatialType: "folding",
        text: `La feuille du schéma ${index + 1} est pliée (${pattern.label}) puis découpée. Quel résultat obtient-on une fois dépliée ?`,
        answer: 0,
        visual: {
          label: "Zone visible de la feuille pliée avec découpes",
          svg: foldedPaperSvg(pattern.folds, cutSet)
        },
        options: optionPointSets.map((points) => ({
          label: "Résultat déplié proposé",
          svg: paperResultSvg(points)
        })),
        explanation: "Chaque découpe se répète par symétrie à chaque pli lorsque la feuille est dépliée."
      });
    }

    return questions;
  }

  function createCubeQuestions() {
    const questions = [];
    const nets = [
      {
        name: "croix centrale",
        cells: [[1, 0, "A"], [0, 1, "B"], [1, 1, "C"], [2, 1, "D"], [1, 2, "E"], [1, 3, "F"]],
        visible: ["A", "B", "C"]
      },
      {
        name: "bande avec rabats",
        cells: [[0, 1, "A"], [1, 1, "B"], [2, 1, "C"], [3, 1, "D"], [1, 0, "E"], [1, 2, "F"]],
        visible: ["E", "A", "B"]
      },
      {
        name: "escalier",
        cells: [[0, 0, "A"], [0, 1, "B"], [1, 1, "C"], [1, 2, "D"], [2, 2, "E"], [2, 3, "F"]],
        visible: ["A", "B", "C"]
      },
      {
        name: "T allongé",
        cells: [[1, 0, "A"], [1, 1, "B"], [0, 2, "C"], [1, 2, "D"], [2, 2, "E"], [1, 3, "F"]],
        visible: ["B", "C", "D"]
      },
      {
        name: "zigzag compact",
        cells: [[2, 0, "A"], [0, 1, "B"], [1, 1, "C"], [2, 1, "D"], [1, 2, "E"], [1, 3, "F"]],
        visible: ["A", "C", "D"]
      }
    ];

    for (let index = 0; index < 20; index += 1) {
      const net = rotateNetFaces(nets[index % nets.length], index);
      const correct = net.visible;
      const optionFaces = uniqueFaceOptions([
        correct,
        [net.faces[3], correct[1], correct[2]],
        [correct[0], correct[2], correct[1]],
        [net.faces[5], net.faces[0], net.faces[4]],
        [net.faces[1], net.faces[4], net.faces[2]]
      ]);

      questions.push({
        id: `cube-${index + 1}`,
        type: "Patrons de cubes",
        spatialType: "cubes",
        text: `Quel cube correspond au patron de cube ${net.name}, variante ${index + 1} ?`,
        answer: 0,
        visual: {
          label: "Patron déplié",
          svg: cubeNetSvg(net.cells)
        },
        options: optionFaces.map((faces) => ({
          label: "Cube proposé",
          svg: cubeSvg(faces)
        })),
        explanation: "Le bon cube conserve les faces voisines du patron : les trois faces visibles se touchent autour du même sommet."
      });
    }

    return questions;
  }

  function createSequenceQuestions() {
    const questions = [];
    const steps = [45, 60, 90, 120, 135];

    for (let index = 0; index < 20; index += 1) {
      const shape = SEQUENCE_SHAPE_OVERRIDE[index] ?? SHAPES[(index + 2) % SHAPES.length];
      const startAngle = [0, 30, 45, 90][index % 4];
      const step = steps[index % steps.length];
      const mirrors = index % 3 === 0 ? ["none", "v", "none", "v"] : ["none", "none", "none", "none"];
      const sequence = [0, 1, 2, 3].map((offset) => ({
        angle: normalizeAngle(startAngle + offset * step),
        mirror: mirrors[offset]
      }));
      const correct = {
        angle: normalizeAngle(startAngle + 4 * step),
        mirror: index % 3 === 0 ? "none" : "none"
      };
      const optionStates = uniqueStates([
        correct,
        { angle: normalizeAngle(correct.angle + step), mirror: correct.mirror },
        { angle: normalizeAngle(correct.angle - step), mirror: correct.mirror },
        { angle: normalizeAngle(correct.angle + 180), mirror: correct.mirror === "none" ? "v" : "none" },
        { angle: startAngle, mirror: "h" }
      ]).slice(0, 4);

      questions.push({
        id: `sequence-${index + 1}`,
        type: "Suites de figures",
        spatialType: "sequences",
        text: `Quelle figure vient ensuite dans la séquence ${shapeLabel(shape)} n°${index + 1} ?`,
        answer: 0,
        visual: {
          label: "Suite de figures",
          svg: sequenceSvg(shape, sequence)
        },
        options: optionStates.map((state) => ({
          label: "Figure proposée",
          svg: shapeSvg(shape, state.angle, state.mirror)
        })),
        explanation: `La règle applique une rotation régulière de ${step}° à chaque étape${index % 3 === 0 ? " avec une alternance de symétrie verticale" : ""}.`
      });
    }

    return questions;
  }

  function shapeSvg(shape, angle = 0, mirror = "none") {
    return svgFrame(`
      <g transform="${centerTransform(angle, mirror)}">
        ${shapeMarkup(shape)}
      </g>
    `, "Illustration géométrique");
  }

  function symmetryOptionSvg(shape, angle = 0, mirror = "none") {
    return svgFrame(`
      <g transform="${worldMirrorTransform(angle, mirror)}">
        ${shapeMarkup(shape)}
      </g>
    `, "Illustration géométrique");
  }

  function symmetryPromptSvg(shape, angle, axis) {
    return svgFrame(`
      <g transform="${centerTransform(angle, "none")}">
        ${shapeMarkup(shape)}
      </g>
      ${axisLine(axis)}
    `, "Figure avec axe de symétrie");
  }

  function sequenceSvg(shape, states) {
    const cells = states.map((state, index) => {
      const left = 16 + index * 47;
      return `
        <rect x="${left}" y="58" width="40" height="54" rx="9" fill="${COLORS.white}" stroke="${COLORS.border}"/>
        <g transform="translate(${left} 64) scale(0.2)">
          <g transform="${centerTransform(state.angle, state.mirror)}">
            ${shapeMarkup(shape)}
          </g>
        </g>
      `;
    }).join("");

    return svgFrame(`
      ${cells}
      <rect x="204" y="58" width="40" height="54" rx="9" fill="${COLORS.paleBlue}" stroke="${COLORS.navy}" stroke-dasharray="5 4"/>
      <text x="224" y="92" text-anchor="middle" fill="${COLORS.navy}" font-size="26" font-family="Arial" font-weight="700">?</text>
    `, "Suite de figures", "0 0 260 170");
  }

  function shapeMarkup(shape) {
    const markup = {
      triangle: `
        <polygon points="100,24 174,162 26,162" fill="${COLORS.blue}" stroke="${COLORS.navy}" stroke-width="3"/>
        <circle cx="72" cy="124" r="12" fill="${COLORS.orange}"/>
        <rect x="94" y="70" width="12" height="58" rx="6" fill="${COLORS.white}"/>
      `,
      arrow: `
        <path d="M56 30 L150 100 L56 170 L56 130 L24 130 L24 70 L56 70 Z" fill="${COLORS.navy}"/>
        <circle cx="72" cy="100" r="11" fill="${COLORS.orange}"/>
        <path d="M88 72 L122 100 L88 128" fill="none" stroke="${COLORS.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      `,
      cross: `
        <path d="M78 28 H122 V78 H172 V122 H122 V172 H78 V122 H28 V78 H78 Z" fill="${COLORS.green}" stroke="${COLORS.navy}" stroke-width="3"/>
        <circle cx="100" cy="100" r="13" fill="${COLORS.white}"/>
        <circle cx="100" cy="50" r="8" fill="${COLORS.orange}"/>
      `,
      star: `
        <polygon points="100,22 119,75 176,76 131,111 147,166 100,134 53,166 69,111 24,76 81,75" fill="${COLORS.orange}" stroke="${COLORS.navy}" stroke-width="3"/>
        <circle cx="100" cy="100" r="13" fill="${COLORS.navy}"/>
        <circle cx="119" cy="75" r="7" fill="${COLORS.white}"/>
      `
    };

    return markup[shape];
  }

  function foldedPaperSvg(folds, cuts) {
    const foldedRegion = foldedRegionPolygon(folds)
      .map(([x, y]) => paperPoint(x, y).join(","))
      .join(" ");
    const foldLines = folds.map(axisLine).join("");
    const cutMarks = cuts.map(([x, y], index) => {
      const [cx, cy] = paperPoint(x, y);
      return index % 2 === 0
        ? `<circle cx="${cx}" cy="${cy}" r="7" fill="${COLORS.orange}" stroke="${COLORS.navy}" stroke-width="2"/>`
        : `<rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="3" fill="${COLORS.red}" stroke="${COLORS.navy}" stroke-width="2"/>`;
    }).join("");

    return svgFrame(`
      <rect x="40" y="40" width="120" height="120" rx="8" fill="${COLORS.paleBlue}" stroke="${COLORS.border}" stroke-width="2" opacity="0.55"/>
      <polygon points="${foldedRegion}" fill="${COLORS.white}" stroke="${COLORS.navy}" stroke-width="3" stroke-linejoin="round"/>
      ${foldLines}
      ${cutMarks}
      <text x="100" y="184" text-anchor="middle" fill="${COLORS.navy}" font-size="12" font-family="Arial" font-weight="700">feuille pliée + découpes</text>
    `, "Feuille pliée");
  }

  function paperResultSvg(points) {
    const holes = points.map(([x, y], index) => {
      const [cx, cy] = paperPoint(x, y);
      return index % 2 === 0
        ? `<circle cx="${cx}" cy="${cy}" r="6" fill="${COLORS.orange}" stroke="${COLORS.navy}" stroke-width="1.8"/>`
        : `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" rx="3" fill="${COLORS.red}" stroke="${COLORS.navy}" stroke-width="1.8"/>`;
    }).join("");

    return svgFrame(`
      <rect x="40" y="40" width="120" height="120" rx="8" fill="${COLORS.white}" stroke="${COLORS.navy}" stroke-width="3"/>
      ${holes}
    `, "Résultat déplié");
  }

  function cubeNetSvg(cells) {
    const size = 34;
    const gap = 3;
    const minX = Math.min(...cells.map(([x]) => x));
    const maxX = Math.max(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    const maxY = Math.max(...cells.map(([, y]) => y));
    const width = (maxX - minX + 1) * (size + gap) - gap;
    const height = (maxY - minY + 1) * (size + gap) - gap;
    const offsetX = 100 - width / 2;
    const offsetY = 100 - height / 2;

    const rects = cells.map(([x, y, face]) => {
      const left = offsetX + (x - minX) * (size + gap);
      const top = offsetY + (y - minY) * (size + gap);
      return `
        <rect x="${left}" y="${top}" width="${size}" height="${size}" fill="${CUBE_FACES[face].fill}" stroke="${COLORS.navy}" stroke-width="2"/>
        ${cubeMark(face, left + size / 2, top + size / 2, 0.7)}
      `;
    }).join("");

    return svgFrame(rects, "Patron de cube");
  }

  function cubeSvg(faces) {
    const [top, left, right] = faces;
    return svgFrame(`
      <polygon points="100,28 158,62 100,96 42,62" fill="${CUBE_FACES[top].fill}" stroke="${COLORS.navy}" stroke-width="2.5"/>
      <polygon points="42,62 100,96 100,166 42,132" fill="${CUBE_FACES[left].fill}" stroke="${COLORS.navy}" stroke-width="2.5"/>
      <polygon points="158,62 100,96 100,166 158,132" fill="${CUBE_FACES[right].fill}" stroke="${COLORS.navy}" stroke-width="2.5"/>
      ${cubeMark(top, 100, 64, 0.85)}
      ${cubeMark(left, 72, 116, 0.85)}
      ${cubeMark(right, 128, 116, 0.85)}
    `, "Cube proposé");
  }

  function cubeMark(face, cx, cy, scale) {
    const style = CUBE_FACES[face];
    const color = style.mark;
    const size = 14 * scale;
    if (style.symbol === "circle") {
      return `<circle cx="${cx}" cy="${cy}" r="${size}" fill="${color}"/>`;
    }
    if (style.symbol === "triangle") {
      return `<polygon points="${cx},${cy - size} ${cx + size},${cy + size} ${cx - size},${cy + size}" fill="${color}"/>`;
    }
    if (style.symbol === "diamond") {
      return `<polygon points="${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}" fill="${color}"/>`;
    }
    if (style.symbol === "bar") {
      return `<rect x="${cx - size}" y="${cy - size / 3}" width="${size * 2}" height="${size * 0.66}" rx="3" fill="${color}"/>`;
    }
    if (style.symbol === "dotpair") {
      return `<circle cx="${cx - size / 2}" cy="${cy}" r="${size / 2}" fill="${color}"/><circle cx="${cx + size / 2}" cy="${cy}" r="${size / 2}" fill="${color}"/>`;
    }
    return `
      <rect x="${cx - size}" y="${cy - size / 4}" width="${size * 2}" height="${size / 2}" rx="2" fill="${color}"/>
      <rect x="${cx - size / 4}" y="${cy - size}" width="${size / 2}" height="${size * 2}" rx="2" fill="${color}"/>
    `;
  }

  function unfoldPoints(cuts, folds) {
    let points = cuts.map(([x, y]) => [x, y]);
    for (let index = folds.length - 1; index >= 0; index -= 1) {
      const fold = folds[index];
      points = uniquePoints([...points, ...points.map((point) => reflectPoint(point, fold))]);
    }
    return points;
  }

  function canonicalFoldedCuts(cuts, folds) {
    return cuts.map((point) => {
      let foldedPoint = [...point];
      for (let pass = 0; pass < folds.length * 2; pass += 1) {
        folds.forEach((fold) => {
          foldedPoint = canonicalFoldedPoint(foldedPoint, fold);
        });
      }
      return foldedPoint;
    });
  }

  function canonicalFoldedPoint([x, y], fold) {
    if (fold === "v" && x > 60) {
      return [120 - x, y];
    }
    if (fold === "h" && y > 60) {
      return [x, 120 - y];
    }
    if (fold === "diag" && x > y) {
      return [y, x];
    }
    if (fold === "anti" && x + y > 120) {
      return [120 - y, 120 - x];
    }
    return [x, y];
  }

  function paperOptionSets(correctPoints, folds, index) {
    const candidates = [
      correctPoints,
      correctPoints.map((point) => reflectPoint(point, "v")),
      correctPoints.map((point) => reflectPoint(point, "h")),
      correctPoints.map((point) => reflectPoint(point, "diag")),
      unfoldPoints(correctPoints.slice(0, Math.max(1, Math.ceil(correctPoints.length / 2))), folds),
      correctPoints.map(([x, y]) => [normalizePaper(x + 12 + index), normalizePaper(y + 7)])
    ];
    const unique = [];
    const keys = new Set();
    candidates.forEach((points) => {
      const normalized = uniquePoints(points);
      const key = pointSetKey(normalized);
      if (!keys.has(key)) {
        keys.add(key);
        unique.push(normalized);
      }
    });

    while (unique.length < 4) {
      const shifted = correctPoints.map(([x, y]) => [normalizePaper(x + unique.length * 13), normalizePaper(y + unique.length * 9)]);
      const key = pointSetKey(shifted);
      if (!keys.has(key)) {
        keys.add(key);
        unique.push(shifted);
      }
    }

    return unique.slice(0, 4);
  }

  function reflectPoint([x, y], fold) {
    if (fold === "v") {
      return [120 - x, y];
    }
    if (fold === "h") {
      return [x, 120 - y];
    }
    if (fold === "diag") {
      return [y, x];
    }
    if (fold === "anti") {
      return [120 - y, 120 - x];
    }
    return [x, y];
  }

  function uniquePoints(points) {
    const seen = new Set();
    return points.filter(([x, y]) => {
      const key = `${Math.round(x)}:${Math.round(y)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function pointSetKey(points) {
    return points
      .map(([x, y]) => `${Math.round(x)}:${Math.round(y)}`)
      .sort()
      .join("|");
  }

  function normalizePaper(value) {
    return ((Math.round(value) % 100) + 100) % 100 + 10;
  }

  function paperPoint(x, y) {
    return [40 + x, 40 + y];
  }

  function foldedRegionPolygon(folds) {
    return folds.reduce((polygon, fold) => clipPolygon(polygon, fold), [
      [0, 0],
      [120, 0],
      [120, 120],
      [0, 120]
    ]);
  }

  function clipPolygon(polygon, fold) {
    const clipped = [];
    polygon.forEach((current, index) => {
      const previous = polygon[(index + polygon.length - 1) % polygon.length];
      const currentInside = isInsideFoldRegion(current, fold);
      const previousInside = isInsideFoldRegion(previous, fold);

      if (currentInside && !previousInside) {
        clipped.push(intersectionWithFold(previous, current, fold));
      }
      if (currentInside) {
        clipped.push(current);
      } else if (previousInside) {
        clipped.push(intersectionWithFold(previous, current, fold));
      }
    });
    return clipped;
  }

  function isInsideFoldRegion(point, fold) {
    return foldDistance(point, fold) <= 0.0001;
  }

  function intersectionWithFold(start, end, fold) {
    const startDistance = foldDistance(start, fold);
    const endDistance = foldDistance(end, fold);
    const ratio = startDistance / (startDistance - endDistance);
    return [
      roundCoordinate(start[0] + (end[0] - start[0]) * ratio),
      roundCoordinate(start[1] + (end[1] - start[1]) * ratio)
    ];
  }

  function foldDistance([x, y], fold) {
    if (fold === "v") {
      return x - 60;
    }
    if (fold === "h") {
      return y - 60;
    }
    if (fold === "diag") {
      return x - y;
    }
    if (fold === "anti") {
      return x + y - 120;
    }
    return 0;
  }

  function roundCoordinate(value) {
    return Math.round(value * 100) / 100;
  }

  function rotateNetFaces(net, offset) {
    const faces = ["A", "B", "C", "D", "E", "F"];
    const rotated = faces.slice(offset % faces.length).concat(faces.slice(0, offset % faces.length));
    const faceMap = faces.reduce((map, face, index) => {
      map[face] = rotated[index];
      return map;
    }, {});

    return {
      name: net.name,
      faces: rotated,
      cells: net.cells.map(([x, y, face]) => [x, y, faceMap[face]]),
      visible: net.visible.map((face) => faceMap[face])
    };
  }

  function uniqueFaceOptions(candidates) {
    const options = [];
    const keys = new Set();
    candidates.forEach((faces) => {
      const key = faces.join("-");
      if (!keys.has(key)) {
        keys.add(key);
        options.push(faces);
      }
    });

    const fallbackFaces = Object.keys(CUBE_FACES);
    let cursor = 0;
    while (options.length < 4) {
      const faces = [fallbackFaces[cursor % 6], fallbackFaces[(cursor + 2) % 6], fallbackFaces[(cursor + 4) % 6]];
      const key = faces.join("-");
      if (!keys.has(key)) {
        keys.add(key);
        options.push(faces);
      }
      cursor += 1;
    }

    return options.slice(0, 4);
  }

  function uniqueStates(candidates) {
    const states = [];
    const keys = new Set();
    candidates.forEach((state) => {
      const key = `${state.angle}-${state.mirror}`;
      if (!keys.has(key)) {
        keys.add(key);
        states.push(state);
      }
    });
    return states;
  }

  function uniqueValues(values) {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  function axisLine(axis) {
    const common = `stroke="${COLORS.orange}" stroke-width="4" stroke-linecap="round" stroke-dasharray="9 7"`;
    if (axis === "h") {
      return `<line x1="28" y1="100" x2="172" y2="100" ${common}/>`;
    }
    if (axis === "v") {
      return `<line x1="100" y1="28" x2="100" y2="172" ${common}/>`;
    }
    if (axis === "anti") {
      return `<line x1="172" y1="28" x2="28" y2="172" ${common}/>`;
    }
    return `<line x1="28" y1="28" x2="172" y2="172" ${common}/>`;
  }

  function centerTransform(angle, mirror) {
    return `translate(100 100) rotate(${angle}) ${mirrorTransform(mirror)} translate(-100 -100)`;
  }

  function worldMirrorTransform(angle, mirror) {
    return `translate(100 100) ${mirrorTransform(mirror)} rotate(${angle}) translate(-100 -100)`;
  }

  function mirrorTransform(mirror) {
    if (mirror === "h") {
      return "scale(1 -1)";
    }
    if (mirror === "v") {
      return "scale(-1 1)";
    }
    if (mirror === "diag") {
      return "matrix(0 1 1 0 0 0)";
    }
    if (mirror === "anti") {
      return "matrix(0 -1 -1 0 0 0)";
    }
    return "scale(1 1)";
  }

  function svgFrame(content, label, viewBox = "0 0 200 200") {
    const [minX, minY, width, height] = viewBox.split(" ").map(Number);
    return `
      <svg viewBox="${viewBox}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${minX + 8}" y="${minY + 8}" width="${width - 16}" height="${height - 16}" rx="20" fill="${COLORS.offWhite}" stroke="${COLORS.border}"/>
        ${content}
      </svg>
    `;
  }

  function shapeLabel(shape) {
    const labels = {
      triangle: "figure triangulaire",
      arrow: "flèche",
      cross: "croix",
      star: "étoile"
    };
    return labels[shape];
  }

  function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  window.SpatialQuestionBank = {
    types: TYPES,
    createQuestions
  };
}());
