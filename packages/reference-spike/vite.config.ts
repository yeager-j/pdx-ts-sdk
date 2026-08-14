import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import remarkFrontmatter from "remark-frontmatter";
import { defineConfig, type Plugin } from "vite";

import { headingIds, storyPanels } from "./src/app/remark-plugins.ts";
import { PAGES } from "./src/build/pages.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Regenerates the extracted stories and the snapshot when the page changes.
 *
 * Authoring is the point of this format, and without this the dev loop has a
 * quiet trap in it: editing a fence updates the prose through HMR while the
 * story panel keeps showing the previous code and the previous output, because
 * the panel reads both out of the committed snapshot. The page would look
 * updated and be lying.
 *
 * It shells out to the same two scripts the gates run rather than importing
 * their modules. That keeps this config light — the snapshot pulls in the whole
 * CWT rule set — and it means the dev loop and CI cannot drift apart, because
 * they are running the same command. It also leaves the regenerated files on
 * disk, which is right: they are committed artifacts that had to be rebuilt
 * anyway, and doing it here is what stops somebody reaching CI with a stale
 * extraction.
 */
function regenerateOnEdit(): Plugin {
  // Every page's prose, plus the one module their conventions are declared in.
  // Read off the page registry rather than listed, so a third page is watched
  // the moment it exists.
  const watched = new Set([
    ...PAGES.map((page) => path.join(ROOT, page.mdxPath)),
    path.join(HERE, "content/conventions.ts"),
  ]);
  return {
    name: "reference-spike:regenerate",
    apply: "serve",
    configureServer(server) {
      let running = false;
      server.watcher.on("change", (file) => {
        if (!watched.has(path.normalize(file)) || running) {
          return;
        }
        running = true;
        for (const script of ["src/build/stories-cli.ts", "src/build/cli.ts"]) {
          try {
            execFileSync("node", ["--conditions=pdx-source", script], {
              cwd: HERE,
              stdio: "pipe",
            });
          } catch (error) {
            // A refusal at assembly: a convention with no prose, a `<Claim>`
            // naming nothing, a story that throws during the fold. Report it
            // and leave the last good snapshot in place rather than taking the
            // dev server down.
            //
            // Type errors are not caught here and are not meant to be. Node
            // strips types rather than checking them, so a fence that stopped
            // typechecking still regenerates cleanly; `npm run typecheck` and
            // the editor are what catch that, which is the same division as
            // for any other source file in the repo.
            server.config.logger.error(
              `[reference-spike] ${script} failed:\n${(error as { stderr?: Buffer }).stderr ?? error}`
            );
            running = false;
            return;
          }
        }
        server.config.logger.info(
          "[reference-spike] re-extracted stories and rebuilt the snapshot"
        );
        running = false;
      });
    },
  };
}

/**
 * Serves the highlighted story HTML as a virtual module.
 *
 * A virtual module rather than a generated file, because this is the one thing
 * in the package that is purely presentational. It has no reviewable content —
 * it is the snapshot's own text with colours attached — so it belongs in the
 * bundle and nowhere else. Writing it to disk would create a second committed
 * artifact that says nothing the first one does not.
 */
function highlightedStories(): Plugin {
  const id = "virtual:highlighted-stories";
  const resolved = `\0${id}`;
  return {
    name: "reference-spike:highlight",
    resolveId: (source) => (source === id ? resolved : null),
    async load(source) {
      if (source !== resolved) {
        return null;
      }
      const { readSnapshot } = await import("./src/build/snapshot.ts");
      const { highlightStories } = await import("./src/build/highlight.ts");
      const byPage: Record<string, unknown> = {};
      for (const page of PAGES) {
        byPage[page.id] = await highlightStories(readSnapshot(page).stories);
      }
      return `export default ${JSON.stringify(byPage)};`;
    },
  };
}

/**
 * The viewer is a static bundle with no service behind it: the snapshot is
 * imported as JSON at build time, so `dist/` is one immutable Reference build
 * and serving it needs nothing but a file server. `vite preview` is that file
 * server — the spike had a hand-written one until it turned out to be a
 * reimplementation of a command Vite already ships, down to the port.
 *
 * `base: "./"` keeps every asset reference relative, so the same bundle works
 * from a loopback root, a subdirectory, or a `file://` open. The spike does not
 * need hosting and nothing here assumes it.
 */
export default defineConfig({
  base: "./",
  plugins: [
    // Before `react()`, because the MDX plugin produces JSX that React's
    // plugin then transforms. The order is not optional.
    {
      enforce: "pre",
      // `remark-frontmatter` makes the YAML block a node MDX ignores rather
      // than a paragraph it renders. The build reads the same block with its
      // own reader, so without this the page prints its own metadata at the top.
      ...mdx({
        remarkPlugins: [remarkFrontmatter, headingIds, storyPanels],
        providerImportSource: "@mdx-js/react",
      }),
    },
    react(),
    tailwindcss(),
    highlightedStories(),
    regenerateOnEdit(),
  ],
  build: { outDir: "dist", emptyOutDir: true },
  // Loopback, spelled out. A documentation viewer that quietly listens on every
  // interface is a documentation viewer somebody's colleague can read off the
  // office wifi. `strictPort` because a silently reassigned port breaks the URL
  // in the README and anyone's bookmark.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
