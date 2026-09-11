import { reporter } from "./helpers.mjs";
import { normalizeProject } from "../src/lib/types.ts";

/**
 * normalizeProject() の性質を確認する（ブラウザ不要・純粋関数のテスト）。
 * 完了条件: refinements / glossary が無い既存プロジェクトを読んでも壊れず、
 * 既にある場合はそのまま保たれる。
 */
export default async function run() {
  const r = reporter("normalizeProject");

  const legacy = { id: "p1", title: "旧データ" };
  const normalized = normalizeProject(legacy);
  r.check(
    "refinements が無ければ空オブジェクトを補う",
    typeof normalized.refinements === "object" &&
      Object.keys(normalized.refinements).length === 0
  );
  r.check(
    "glossary が無ければ空配列を補う",
    Array.isArray(normalized.glossary) && normalized.glossary.length === 0
  );
  r.check(
    "他のフィールドはそのまま保たれる",
    normalized.id === "p1" && normalized.title === "旧データ"
  );

  const withData = {
    id: "p2",
    refinements: { abc123: { text: "整文済み", edited: true, updatedAt: 1 } },
    glossary: ["九附後連"],
  };
  const kept = normalizeProject(withData);
  r.check(
    "既にある refinements は上書きしない",
    kept.refinements.abc123?.text === "整文済み"
  );
  r.check("既にある glossary は上書きしない", kept.glossary[0] === "九附後連");

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
