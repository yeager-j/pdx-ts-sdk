import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { CONTENT_CONTRIBUTION_SINKS } from "../../packages/codegen-cwt/src/overlay.ts";

const root = path.join(import.meta.dirname, "../..");
const slices = ["examples", "packages/sdk/tests", "packages/stellaris-ids/tests"] as const;
const callKinds = [
  "define",
  "namespace",
  "collection",
  "buildMod",
  "discoverContent",
  "on",
  "patchTechnology",
  "contribution",
] as const;
const contributionMethods = new Set(
  [...CONTENT_CONTRIBUTION_SINKS.values()].map((sink) => sink.method)
);

type CallKind = (typeof callKinds)[number];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(absolute);
    }
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

function classifyIdentifier(name: string): CallKind | undefined {
  if (/^define[A-Z]/.test(name)) {
    return "define";
  }
  if (name === "on" || name === "patchTechnology") {
    return name;
  }
  if (contributionMethods.has(name)) {
    return "contribution";
  }
  return callKinds.find((kind) => kind === name);
}

function classify(expression: ts.LeftHandSideExpression): CallKind | undefined {
  if (ts.isIdentifier(expression)) {
    return classifyIdentifier(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression) && /^define[A-Z]/.test(expression.name.text)) {
    return "define";
  }
  return undefined;
}

const report: Record<
  string,
  { files: number; touchedFiles: number; calls: Record<CallKind, number> }
> = {};

for (const slice of slices) {
  const files = sourceFiles(path.join(root, slice));
  const calls = Object.fromEntries(callKinds.map((kind) => [kind, 0])) as Record<CallKind, number>;
  const touched = new Set<string>();

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const kind = classify(node.expression);
        if (kind !== undefined) {
          calls[kind] += 1;
          touched.add(file);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  report[slice] = {
    files: files.length,
    touchedFiles: touched.size,
    calls,
  };
}

console.log(JSON.stringify(report, null, 2));
