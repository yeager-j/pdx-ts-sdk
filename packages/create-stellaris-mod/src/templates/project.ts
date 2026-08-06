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
  sdk: "^0.2.0",
  sdkTesting: "^0.2.0",
} as const;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * `@pdx-ts/sdk` and `@pdx-ts/pdxscript` resolve either from the registry or
 * from a local checkout. The local form exists because the packages are not
 * published yet; either way the project consumes their built `dist/`, so a
 * `--local` checkout has to have been built (the CLI checks, and says so).
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

/**
 * The mod-logic interpreter, a devDependency because it never ships with the
 * mod — it is a separate package from the SDK precisely because its matchers
 * integrate with a test framework.
 */
function testingDependency(resolved: Resolved): Record<string, string> {
  return {
    "@pdx-ts/sdk-testing":
      resolved.localSdk === undefined
        ? VERSIONS.sdkTesting
        : `file:${resolved.localSdk}/packages/sdk-testing`,
  };
}

/**
 * Whether the identifier package can be pinned at all.
 *
 * Its npm version carries the game version, so only a plain `major.minor.patch`
 * has a counterpart to install — a four-part Paradox build has none. Exported
 * because the source templates must ask the same question: emitting the
 * `import "@pdx-ts/stellaris-ids"` side effect for a dependency this declined
 * to add produces a scaffold that fails on a missing package, instead of
 * degrading to unchecked strings the way a no-install scaffold does.
 */
export function canPinIds(resolved: Resolved): boolean {
  return resolved.gameVersion !== undefined && /^\d+\.\d+\.\d+$/.test(resolved.gameVersion);
}

function idsDependency(resolved: Resolved): Record<string, string> {
  const gameVersion = resolved.gameVersion;
  if (!canPinIds(resolved) || gameVersion === undefined) {
    return {};
  }
  if (resolved.localSdk !== undefined) {
    return { "@pdx-ts/stellaris-ids": `file:${resolved.localSdk}/packages/stellaris-ids` };
  }
  return { "@pdx-ts/stellaris-ids": idsRange(gameVersion) };
}

/**
 * The range selecting the newest *revision* of one game build's identifiers.
 *
 * The package's version is the game version carrying a `-r.<n>` revision
 * suffix, because a package can need a fix — a widened peer range, a
 * regenerated registry — between two game releases, and npm can never reuse a
 * version number. So `4.4.6` names a build and `-r.1`, `-r.2` name successive
 * publishes of it.
 *
 * Both bounds earn their place. `>=4.4.6-0` is what admits prereleases at all:
 * an ordinary range like `^4.4.6` matches no prerelease, so it would find
 * nothing. `<4.4.6` then *excludes the bare build* — every published version is
 * a revision, and a bare `4.4.6` on the registry is by definition one that
 * predates this scheme. Highest-wins within the range then means newest
 * revision, which is the whole point.
 */
export function idsRange(gameVersion: string): string {
  return `>=${gameVersion}-0 <${gameVersion}`;
}

export function packageJson(resolved: Resolved, packageName: string): string {
  const devDependencies: Record<string, string> = {
    "@types/node": VERSIONS.types_node,
    typescript: VERSIONS.typescript,
    vitest: VERSIONS.vitest,
    ...testingDependency(resolved),
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
 * Two namespaces in one module mean one feature would claim two event
 * identities. The fix is always to split the module, which is no loss — a
 * namespace is a feature's event chain, and two of them are two features.
 */
const oneNamespacePerFile = {
  meta: {
    type: "problem",
    docs: { description: "An event namespace and an event file are in bijection" },
    schema: [],
    messages: {
      duplicate:
        "A second mod.namespace() in one module (the first is on line {{line}}). An event " +
        "namespace and an event file are in bijection, so move this namespace and its " +
        "events into their own module.",
    },
  },
  create(context) {
    let first = null;
    return {
      "CallExpression[callee.type='MemberExpression'][callee.property.name='namespace']"(node) {
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

/**
 * A capability event handle is an immutable declaration that can be defined
 * once after its first use. The SDK's compile step remains authoritative, but
 * this catches the local direct-call mistake while it is being written.
 *
 * Only direct calls on one local binding are tracked. Aliases, helper-mediated
 * calls, and cross-module reasoning are deliberately out of scope; two direct
 * calls are reported even when control flow makes them mutually exclusive.
 */
const oneDefinitionPerEventHandle = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A CapabilityEventHandle may have one direct define call per local binding",
    },
    schema: [],
    messages: {
      duplicate:
        "This event handle was already defined on line {{line}}. A CapabilityEventHandle may have " +
        "one direct define() call per local binding.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (services.program == null || services.esTreeNodeToTSNodeMap == null) {
      return {};
    }
    const checker = services.program.getTypeChecker();
    const firstDefinitions = new Map();

    function isCapabilityEventHandle(node) {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      const type = checker.getTypeAtLocation(tsNode);
      const symbol = type.aliasSymbol ?? type.getSymbol();
      return symbol?.getName() === "CapabilityEventHandle";
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.computed ||
          node.callee.object.type !== "Identifier" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "define" ||
          !isCapabilityEventHandle(node.callee.object)
        ) {
          return;
        }

        const tsNode = services.esTreeNodeToTSNodeMap.get(node.callee.object);
        const symbol = checker.getSymbolAtLocation(tsNode);
        if (symbol === undefined) {
          return;
        }
        const first = firstDefinitions.get(symbol);
        if (first === undefined) {
          firstDefinitions.set(symbol, node);
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
    plugins: {
      pdx: {
        rules: {
          "one-definition-per-event-handle": oneDefinitionPerEventHandle,
          "one-namespace-per-file": oneNamespacePerFile,
        },
      },
    },
    rules: {
      "pdx/one-definition-per-event-handle": "error",
      "pdx/one-namespace-per-file": "error",
    },
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
    // Tests live beside the content they test, inside src/content/. Explicit
    // feature discovery selects modules before import, so its default skips
    // these companion files — see src/content/example.test.ts.
    include: ["src/**/*.test.ts"],
  },
});
`;
}
