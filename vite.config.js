import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { scanAbilityAssets, ABILITY_ASSET_DIR } from "./scripts/abilityAssetIndex.mjs";

// Ability icons (Patch Notes): turns whatever is in public/assets/abilities/<champion-id>/ into the `virtual:ability-assets` module that
// src/data/abilityAssets.js imports. Runs at dev-server start, on every added/removed file in that folder, and at `vite build` -- never in
// the browser. Problems (misnamed files, unknown file types) are printed as warnings; they never fail the build and never affect Patch Notes data.
function abilityAssets() {
  const VIRTUAL = "virtual:ability-assets";
  const RESOLVED = "\0" + VIRTUAL;
  let root = process.cwd();
  return {
    name: "nyx-ability-assets",
    configResolved(config) { root = config.root; },
    resolveId(id) { return id === VIRTUAL ? RESOLVED : null; },
    load(id) {
      if (id !== RESOLVED) return null;
      const { index, problems } = scanAbilityAssets(root);
      for (const p of problems) this.warn(`[ability-assets] ${p.message}`);
      return `export default ${JSON.stringify(index)};`;
    },
    configureServer(server) {
      const dir = path.resolve(root, ABILITY_ASSET_DIR);
      server.watcher.add(dir);
      const onChange = (file) => {
        if (!path.resolve(file).startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

export default defineConfig({
  plugins: [react(), abilityAssets()],
});
