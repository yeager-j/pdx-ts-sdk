import { Card, Cards } from "fumadocs-ui/components/card";

import type { ScopeReferenceModel } from "@/src/scope-reference";

export function ScopeIdentity({ model }: { model: ScopeReferenceModel }) {
  return (
    <Cards>
      <Card title="Scope literal">
        <code>{model.scope}</code>
      </Card>
      <Card title="Generated SDK interface">
        <code>{model.interfaceName}</code>
      </Card>
    </Cards>
  );
}
