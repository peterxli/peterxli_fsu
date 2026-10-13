// Map every prototype override to the comment that documents it.
const fs = require("fs");
const lines = fs.readFileSync(__dirname + "/../fsu.js", "utf8").split("\n");

const out = [];
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Z][A-Za-z0-9_$]*)\.prototype\.([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function/);
    if (!m) continue;
    // Walk back over contiguous comment lines.
    const cmts = [];
    for (let j = i - 1; j >= 0 && j > i - 8; j--) {
        const c = lines[j].match(/^\s*\/\/\s*(.*)$/);
        if (c) { cmts.unshift(c[1]); continue; }
        if (lines[j].trim() === "" || /^\s*const [A-Za-z_$]+ = [A-Za-z_$]+\.prototype\./.test(lines[j])) continue;
        break;
    }
    out.push({ line: i + 1, hook: `${m[1]}.${m[2]}`, note: cmts.join(" / ") });
}

for (const o of out) {
    console.log(`${String(o.line).padStart(5)}  ${o.hook.padEnd(56)} ${o.note}`);
}
console.log(`\n共 ${out.length} 个 prototype 覆写，其中 ${out.filter((o) => o.note).length} 个有注释`);
