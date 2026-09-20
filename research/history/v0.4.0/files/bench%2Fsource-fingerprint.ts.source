import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const PKG = fileURLToPath(new URL("../", import.meta.url));

export function benchmarkFingerprint(): string {
  const hash = createHash("sha256");
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(PKG, relative), {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path);
      else { hash.update(path); hash.update(readFileSync(join(PKG,path))); }
    }
  };
  for (const dir of ["src","bin","skills"]) walk(dir);
  for (const file of ["bench/run-bench.ts","bench/source-fingerprint.ts","package.json","bun.lock"]) {
    hash.update(file); hash.update(readFileSync(join(PKG,file)));
  }
  return hash.digest("hex");
}
