import { Tab, Tabs } from "fumadocs-ui/components/tabs";

import { PdxCodeBlock } from "@/components/PdxCodeBlock";
import { pairedExample } from "@/src/paired-examples-manifest";

/**
 * One paired example: the TypeScript lesson on one tab, the PDXScript it
 * renders on the other.
 *
 * The data comes from `.examples/paired-examples.json`, written by
 * `scripts/check-examples.ts` — the execution half of the docs compile gate.
 * A name no example carries throws in the manifest reader, which fails
 * `next build` on the page that used it.
 */
export async function PairedExample({ name }: { name: string }) {
  const example = await pairedExample(name);

  return (
    <Tabs items={["TypeScript", "PDXScript"]} groupId="paired-example" persist>
      <Tab value="TypeScript">
        <PdxCodeBlock code={example.source} lang="typescript" />
      </Tab>
      <Tab value="PDXScript">
        <div className="flex flex-col gap-4">
          {example.files.map((file) => (
            <PdxCodeBlock
              key={file.path}
              code={file.text}
              lang={file.lang}
              codeblock={{ title: file.path }}
            />
          ))}
        </div>
      </Tab>
    </Tabs>
  );
}
