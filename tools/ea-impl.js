#!/usr/bin/env node
/**
 * Print EA's own implementation of a method out of the minified FC27 bundle.
 * Balances braces so the whole function body comes out, then lightly
 * pretty-prints it so it can be diffed against fsu.js by eye.
 *
 * Usage:
 *   node tools/ea-impl.js UTHomeHubView.prototype.getSBCTile
 *   node tools/ea-impl.js UTSBCSetsViewModel.prototype.getCategories --raw
 */

const fs = require("fs");
const path = require("path");

const BUNDLE = path.join(__dirname, "..", "reference", "webapp", "all.js");
const target = process.argv[2];
const raw = process.argv.includes("--raw");

if (!target) {
    console.error("用法: node tools/ea-impl.js <Class.prototype.method> [--raw]");
    process.exit(1);
}

const src = fs.readFileSync(BUNDLE, "utf8");
const needle = `${target}=function`;
const at = src.indexOf(needle);
if (at === -1) {
    console.error(`bundle 里找不到 ${needle}`);
    process.exit(2);
}

// Walk from the opening brace of the function body, tracking strings/regex so
// braces inside literals don't throw the depth off.
const bodyStart = src.indexOf("{", at + needle.length);
let i = bodyStart;
let depth = 0;
let quote = null;
for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
}

const code = src.slice(at, i);

if (raw) {
    console.log(code);
    process.exit(0);
}

/** Minimal pretty-printer: newline + indent on structural punctuation. */
function pretty(s) {
    let out = "";
    let ind = 0;
    let q = null;
    const pad = () => "\n" + "    ".repeat(Math.max(0, ind));
    for (let k = 0; k < s.length; k++) {
        const c = s[k];
        if (q) {
            out += c;
            if (c === "\\") { out += s[++k]; continue; }
            if (c === q) q = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
        if (c === "{") { ind++; out += c + pad(); continue; }
        if (c === "}") { ind--; out += pad() + c; continue; }
        if (c === ";") { out += c + pad(); continue; }
        if (c === ",' ".trim() && ind > 0) { out += c; continue; }
        out += c;
    }
    return out.replace(/\n\s*\n+/g, "\n");
}

console.log(`// ===== FC27 bundle: ${target} =====`);
console.log(pretty(code));
console.log(`\n// ${code.length} 字节`);
