// Bundles src/index.ts and its dependencies into a single dist/index.js so the
// plugin runs on a plain Node install, with no npm install on the user's side.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
});

console.log("built dist/index.js");
