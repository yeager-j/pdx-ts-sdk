import { synthesizeMinimal } from "./src/example/synthesize.ts";

for (const [p, t] of synthesizeMinimal()) {
  console.log("=== " + p + " ===");
  console.log(t);
}
