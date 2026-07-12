const fs = require("fs");
const html = fs.readFileSync("culture-generale.html", "utf8");
const matches = [...html.matchAll(/q\("([^"]+)",\s*"([^"]+)"/g)];
const byCat = {};
const bySub = {};

matches.forEach(([, cat, sub]) => {
  byCat[cat] = (byCat[cat] || 0) + 1;
  if (!bySub[cat]) bySub[cat] = {};
  bySub[cat][sub] = (bySub[cat][sub] || 0) + 1;
});

const cats = Object.keys(byCat).sort();
console.log(`TOTAL: ${matches.length}\n`);
cats.forEach((cat) => {
  console.log(`${cat} (${byCat[cat]} questions)`);
  Object.keys(bySub[cat])
    .sort()
    .forEach((sub) => {
      console.log(`  - ${sub}: ${bySub[cat][sub]}`);
    });
  console.log("");
});
