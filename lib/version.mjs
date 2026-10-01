// Read from package.json rather than written twice: `npx @vatio-ai/cli` resolves a
// version from the registry, and a constant in here could disagree with the
// one the developer actually downloaded.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const VERSION = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
