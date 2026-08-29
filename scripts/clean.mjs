import { readdirSync, rmSync } from "node:fs";

for (const name of readdirSync("packages")) {
  rmSync(`packages/${name}/dist`, { recursive: true, force: true });
}
