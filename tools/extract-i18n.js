// Dump the localization table (key + 简体 text) grouped by namespace.
const fs = require("fs");
const lines = fs.readFileSync(__dirname + "/../fsu.js", "utf8").split("\n");
const slice = lines.slice(1136, 1642).join("\n"); // info.localization = { ... };

const entries = [];
const re = /"([a-zA-Z0-9_.\-]+)"\s*:\s*\[\s*("(?:[^"\\]|\\.)*")/g;
let m;
while ((m = re.exec(slice))) {
    entries.push([m[1], JSON.parse(m[2])]);
}

const groups = {};
for (const [k, v] of entries) {
    const ns = k.includes(".") ? k.slice(0, k.indexOf(".")) : "(root)";
    (groups[ns] = groups[ns] || []).push([k, v]);
}

const want = process.argv[2];
for (const ns of Object.keys(groups).sort()) {
    if (want && ns !== want) continue;
    console.log(`\n##### ${ns}  (${groups[ns].length})`);
    for (const [k, v] of groups[ns]) {
        console.log(`${k}\t${v.replace(/\n/g, " ").slice(0, 300)}`);
    }
}
if (!want) console.log(`\n总计 ${entries.length} 条，命名空间 ${Object.keys(groups).length} 个`);
