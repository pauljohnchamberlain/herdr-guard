import { readdirSync, readFileSync } from "node:fs";

function filesUnder(path) {
  return readdirSync(new URL(`../${path}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}
const files = ["src", "test", "skills", "docs"].flatMap(filesUnder);
const forbidden = ["child_process.exec(", "execSync(", "eval(", "Function(", "curl ", "wget ", "https://"];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const term of forbidden) if (text.includes(term)) throw new Error(`${file} contains forbidden ${term}`);
}
console.log(`security scan ok (${files.length} files)`);
