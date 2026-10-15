import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".wrangler", "data"]);
const JS_URL = /(from\s*["']|import\(\s*["'])(\.\.?\/[^"'?]+\.js)(["'])/g;
const CSS_HREF = /(href=")(?!https?:)([^"?]+\.css)(")/g;
const EXISTING = /(\.(?:js|css))\?v=[^"'&]+/g;

function stampText(text, stamp) {
  let out = text.replace(EXISTING, "$1");
  out = out.replace(JS_URL, (_m, a, url, b) => `${a}${url}?v=${stamp}${b}`);
  out = out.replace(CSS_HREF, (_m, a, url, b) => `${a}${url}?v=${stamp}${b}`);
  return out;
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
    } else if (/\.(js|mjs|html)$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
}

const root = process.argv[2];
const stamp = process.argv[3] || Date.now().toString(36);
if (!root) {
  console.error("usage: node stamp_portal_assets.mjs <portalDir> [stamp]");
  process.exit(1);
}

const files = [];
walk(root, files);
let changed = 0;
for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  const after = stampText(before, stamp);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed++;
  }
}
console.log(`stamped ${changed}/${files.length} files with ?v=${stamp}`);
