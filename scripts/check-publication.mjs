import fs from "node:fs";
import path from "node:path";
const roots = ["src", "public", ".github", "supabase"];
let count = 0;
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, x.name);
    if (x.isDirectory()) {
      scan(p);
      continue;
    }
    if (/\.(xlsx?|csv)$/i.test(p))
      throw Error("Private data file in published source");
    const text = fs.readFileSync(p, "utf8");
    if (
      /sb_secret_[A-Za-z0-9_-]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|pESPN_S2\s*=\s*"[^"\s]{20,}/.test(
        text,
      )
    )
      throw Error(`Possible credential in ${p}`);
    count++;
  }
}
roots.forEach(scan);
console.log(`Publication scan passed for ${count} source files.`);
