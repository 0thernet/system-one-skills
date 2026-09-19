#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const PKG = fileURLToPath(new URL("../", import.meta.url));

export function skillFootprint() {
  const rows = readdirSync(join(PKG,"skills"),{withFileTypes:true}).filter(e=>e.isDirectory()).map(entry=>{
    const text = readFileSync(join(PKG,"skills",entry.name,"SKILL.md"),"utf8");
    const header = text.match(/^---\n([\s\S]*?)\n---\n/)!;
    const meta = Bun.YAML.parse(header[1]!) as {name:string;description:string};
    return {skill:entry.name, file_sha256:createHash("sha256").update(text).digest("hex"), name_description_bytes:Buffer.byteLength(meta.name+"\n"+meta.description), full_skill_file_bytes:Buffer.byteLength(text)};
  }).sort((a,b)=>a.skill.localeCompare(b.skill));
  return {method:"UTF-8 bytes of name plus newline plus description, and full SKILL.md files. Static discovery/loading footprint only; actual harness wrappers, tokenizer, caching and whether a skill is loaded vary. Full files are normally loaded selectively, not all at once.", skills:rows, total_name_description_bytes:rows.reduce((n,r)=>n+r.name_description_bytes,0)};
}
if (import.meta.main) {
  const report=skillFootprint();
  writeFileSync(join(PKG,"bench/report/skill-footprint.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({skills:report.skills.length,total_name_description_bytes:report.total_name_description_bytes}));
}
