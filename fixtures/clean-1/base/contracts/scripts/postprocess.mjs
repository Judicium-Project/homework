// tsp compile sonrası: sayısal enum'lara üye adlarını `x-enum-varnames` olarak ekler.
// Neden: OpenAPI sayısal enum'da adları taşımaz; Go (oapi-codegen) ve TS (api-types postgen)
// sabit adlarını bu uzantıdan alır. Adların tek kaynağı TypeSpec enum'larıdır (kopya yok).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compile, NodeHost, navigateProgram } from "@typespec/compiler";
import { isSeq, parseDocument, visit } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const program = await compile(NodeHost, resolve(root, "main.tsp"), { noEmit: true });
if (program.hasError()) {
  console.error("postprocess: TypeSpec derlemesi hatalı");
  process.exit(1);
}

const numericEnums = new Map();
navigateProgram(program, {
  enum(e) {
    const members = [...e.members.values()];
    if (members.length > 0 && members.every((m) => typeof m.value === "number")) {
      numericEnums.set(e.name, members.map((m) => [m.name, m.value]));
    }
  },
});

const outPath = resolve(root, "out/openapi.yaml");
const doc = parseDocument(await readFile(outPath, "utf8"));
let touched = 0;
for (const [name, members] of numericEnums) {
  const path = ["components", "schemas", name];
  const schema = doc.getIn(path);
  if (!schema) continue;
  const values = doc.getIn([...path, "enum"])?.toJSON();
  const expected = members.map(([, v]) => v);
  if (JSON.stringify(values) !== JSON.stringify(expected)) {
    console.error(`postprocess: ${name} enum değerleri beklenen sırada değil`, values, expected);
    process.exit(1);
  }
  doc.setIn([...path, "x-enum-varnames"], members.map(([n]) => n));
  touched++;
}
// Tamsayı değerli enum/literal'ler `type: number` yerine `integer` olsun (Go'da float32 değil int).
let ints = 0;
visit(doc, {
  Map(_, node) {
    const type = node.get("type");
    const en = node.get("enum");
    if (type === "number" && isSeq(en) && en.items.every((i) => Number.isInteger(i.value ?? i))) {
      node.set("type", "integer");
      ints++;
    }
  },
});

await writeFile(outPath, doc.toString({ lineWidth: 0 }));
console.log(`postprocess: ${touched} enum adlandırıldı, ${ints} sayısal enum integer yapıldı`);
