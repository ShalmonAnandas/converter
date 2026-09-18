import { access, mkdir, cp, readdir } from "node:fs/promises";
import { join } from "node:path";

const required = ["public/index.html", "public/styles.css", "public/app.js", "public/registry.js", "public/favicon.svg", "vercel.json"];
for (const file of required) await access(file);

const modules = await readdir("public/lib");
if (modules.length < 15) throw new Error(`public/lib only contains ${modules.length} modules — the build looks incomplete.`);
for (const file of modules) await access(join("public/lib", file));

await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true, force: true });
console.log(`Static artifact validated: ${required.length} entry files and ${modules.length} library modules copied to dist/.`);
