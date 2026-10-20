// openapi.yaml'daki `x-enum-varnames` taşıyan sayısal enum'lardan adlı sabitler üretir
// (ör. ChannelType.GUILD_TEXT === 0) ve izin bitlerinden PERMISSIONS (bigint) tablosunu.
// Girdi tek kaynak: contracts/out/openapi.yaml (TypeSpec'ten üretilmiş). Elle düzenleme yok.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const spec = parse(await readFile(resolve(here, "../../../contracts/out/openapi.yaml"), "utf8"));
const schemas = spec.components.schemas;

const out = [
  "// BU DOSYA ÜRETİLDİ (packages/api-types/scripts/postgen.mjs) — elle düzenleme yok.",
  "// Kaynak: contracts/out/openapi.yaml. Her şema için kök tip; sayısal enum'larda aynı adla sabit nesne.",
  'import type { components } from "./openapi.gen.ts";',
  "",
];
for (const name of Object.keys(schemas).sort()) {
  const s = schemas[name];
  out.push(`export type ${name} = components["schemas"][${JSON.stringify(name)}];`);
  const names = s["x-enum-varnames"];
  if (!names) continue;
  out.push(`export const ${name} = {`);
  names.forEach((n, i) => out.push(`  ${n}: ${JSON.stringify(s.enum[i])},`));
  out.push(`} as const satisfies Record<string, ${name}>;`);
}
out.push("");

const bits = schemas.PermissionBit;
if (!bits) throw new Error("PermissionBit şeması yok");
out.push("/** İzin değerleri (`1n << bit`). API'de string taşınır: `BigInt(role.permissions) & PERMISSIONS.SEND_MESSAGES`. */");
out.push("export const PERMISSIONS = {");
bits["x-enum-varnames"].forEach((n, i) => out.push(`  ${n}: 1n << ${bits.enum[i]}n,`));
out.push("} as const;");
out.push("export type PermissionName = keyof typeof PERMISSIONS;");
out.push("");

await writeFile(resolve(here, "../src/constants.gen.ts"), out.join("\n"));
console.log("postgen: src/constants.gen.ts yazıldı");
