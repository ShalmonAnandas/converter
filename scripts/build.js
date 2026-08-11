import { access, mkdir, cp } from "node:fs/promises";

for (const file of ["public/index.html", "public/styles.css", "public/app.js", "public/core.js", "public/tools.js", "public/office.js", "public/favicon.svg", "vercel.json"]) await access(file);
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true, force: true });
console.log("Static deployment artifact validated and copied to dist/.");
