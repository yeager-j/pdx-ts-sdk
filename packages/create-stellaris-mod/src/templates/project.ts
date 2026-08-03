/**
 * The generated project's configuration files.
 *
 * Templates are functions returning strings rather than a `templates/`
 * directory of real files, for two reasons that are not preferences. npm strips
 * `.gitignore` out of published tarballs, so a literal template dotfile would
 * silently vanish from the published CLI; and real `.ts` template files would
 * be typechecked by the repo's own `tsc --noEmit` as though they were source,
 * against placeholder ids. The cost — the repo's typechecker never sees this
 * code — is paid back by the end-to-end test, which runs the real `tsc` against
 * the interpolated result.
 */

import type { Resolved } from "../options.ts";

/** Pinned so a scaffold is reproducible, and matching what the SDK develops against. */
const VERSIONS = {
  types_node: "^26.1.2",
  typescript: "^6.0.3",
  vitest: "^4.0.5",
  prettier: "^3.9.6",
  eslint: "^9.0.0",
  eslint_js: "^9.0.0",
  typescript_eslint: "^8.0.0",
  sdk: "^1.0.0",
} as const;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * `@pdx-ts/sdk` and `@pdx-ts/pdxscript` resolve either from the registry or
 * from a local checkout. The local form exists because the packages are not
 * published yet, and it is not a hack: npm materializes a `file:` dependency as
 * a symlink, whose realpath escapes `node_modules`, which is the only reason
 * Node will strip types from the SDK's raw `.ts` sources at all.
 */
function sdkDependencies(resolved: Resolved): Record<string, string> {
  if (resolved.localSdk === undefined) {
    return { "@pdx-ts/sdk": VERSIONS.sdk };
  }
  return {
    "@pdx-ts/sdk": `file:${resolved.localSdk}/packages/sdk`,
    "@pdx-ts/pdxscript": `file:${resolved.localSdk}/packages/pdxscript`,
  };
}

function idsDependency(resolved: Resolved): Record<string, string> {
  if (resolved.gameVersion === undefined || !/^\d+\.\d+\.\d+$/.test(resolved.gameVersion)) {
    return {};
  }
  if (resolved.localSdk !== undefined) {
    return { "@pdx-ts/stellaris-ids": `file:${resolved.localSdk}/packages/stellaris-ids` };
  }
  // The package's npm version *is* the game version, so this is an exact pin
  // rather than a range: 4.4.6 carries the identifiers of Stellaris 4.4.6 and
  // the SDK refuses a build whose install disagrees.
  return { "@pdx-ts/stellaris-ids": resolved.gameVersion };
}

export function packageJson(resolved: Resolved, packageName: string): string {
  const devDependencies: Record<string, string> = {
    "@types/node": VERSIONS.types_node,
    typescript: VERSIONS.typescript,
    vitest: VERSIONS.vitest,
  };
  if (resolved.eslint) {
    devDependencies["@eslint/js"] = VERSIONS.eslint_js;
    devDependencies["eslint"] = VERSIONS.eslint;
    devDependencies["typescript-eslint"] = VERSIONS.typescript_eslint;
  }
  if (resolved.prettier) {
    devDependencies["prettier"] = VERSIONS.prettier;
  }

  const scripts: Record<string, string> = {
    build: "node src/index.ts",
    "install-mod": "node src/install.ts",
    test: "vitest run",
    "test:watch": "vitest",
    typecheck: "tsc --noEmit",
  };
  if (resolved.prettier) {
    scripts["format"] = "prettier --write .";
  }
  if (resolved.eslint) {
    scripts["lint"] = "eslint .";
  }

  return json({
    name: packageName,
    version: "0.1.0",
    private: true,
    type: "module",
    // Not advisory: `npm run build` is `node src/index.ts`, which needs Node's
    // native TypeScript type stripping.
    engines: { node: ">=22.18.0" },
    scripts,
    dependencies: { ...sdkDependencies(resolved), ...idsDependency(resolved) },
    devDependencies: Object.fromEntries(Object.entries(devDependencies).sort()),
  });
}

export function tsconfigJson(): string {
  return `{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    // These four are not style. Node runs this project's TypeScript directly,
    // so relative imports must carry a real ".ts" extension, which needs
    // "allowImportingTsExtensions"; "erasableSyntaxOnly" then makes "tsc
    // accepts this" and "node can run this" the same statement, by rejecting
    // syntax (enums, parameter properties) that type stripping cannot erase.
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "rewriteRelativeImportExtensions": true,
    "noEmit": true,

    "esModuleInterop": true,
    "isolatedModules": true,
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleDetection": "force",
    "moduleResolution": "nodenext",
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "es2024",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
`;
}

export function gitignore(): string {
  return ["node_modules/", "out/", "*.log", ".DS_Store", ""].join("\n");
}

export function prettierrc(): string {
  return json({
    endOfLine: "lf",
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "es5",
    printWidth: 100,
  });
}

export function eslintConfig(): string {
  // `.js`, not `.ts`: ESLint can only load a TypeScript flat config through
  // `jiti`, and that is a dependency this project has no other use for.
  return `// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * An event namespace and an event file are in bijection: one namespace per
 * file, one file per namespace. The build enforces it too, but it can only do
 * so once you run it — this says the same thing while you are still typing, and
 * says it where the mistake is.
 *
 * Two namespaces in one module means the file cannot be the unit of event
 * identity any more: \`discoverContent\` names one collection per file, so both
 * namespaces would claim the same emitted events file. The fix is always to
 * split the module, which is no loss — a namespace is a feature's event chain,
 * and two of them are two features.
 */
const oneNamespacePerFile = {
  meta: {
    type: "problem",
    docs: { description: "An event namespace and an event file are in bijection" },
    schema: [],
    messages: {
      duplicate:
        "A second namespace() in one module (the first is on line {{line}}). An event " +
        "namespace and an event file are in bijection, so move this namespace and its " +
        "events into their own module.",
    },
  },
  create(context) {
    let first = null;
    return {
      "CallExpression[callee.name='namespace']"(node) {
        if (first === null) {
          first = node;
          return;
        }
        context.report({
          node,
          messageId: "duplicate",
          data: { line: String(first.loc.start.line) },
        });
      },
    };
  },
};

export default tseslint.config(
  { ignores: ["out/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { pdx: { rules: { "one-namespace-per-file": oneNamespacePerFile } } },
    rules: { "pdx/one-namespace-per-file": "error" },
  },
  // This file is JavaScript and deliberately outside tsconfig's \`include\`, so
  // the type-aware rules have no program for it and would fail to parse it.
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked }
);
`;
}

export function vitestConfig(): string {
  return `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live beside the content they test, inside src/content/.
    // \`discoverContent\` skips them when it builds the mod, so colocation costs
    // nothing — see the note at the top of src/content/example.test.ts.
    include: ["src/**/*.test.ts"],
  },
});
`;
}
