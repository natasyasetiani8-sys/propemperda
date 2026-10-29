import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
function readFirst(paths, fallback) {
  for (const path of paths) {
    try { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return fallback;
}
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const db = readFirst(['data/db.json', 'db.json'], { propemperda: [], ranperda: [] });
const surveys = readFirst(['data/survey.json', 'survey.json'], []);
const statements = [];

for (const kind of ['propemperda', 'ranperda']) {
  for (const [sortOrder, item] of (db[kind] || []).entries()) {
    statements.push(`INSERT INTO records (kind, id, year, sort_order, data) VALUES (${quote(kind)}, ${quote(item.id)}, ${Number(item.year)}, ${sortOrder}, ${quote(JSON.stringify(item))}) ON CONFLICT(kind, id) DO UPDATE SET year = excluded.year, sort_order = excluded.sort_order, data = excluded.data;`);
  }
}
for (const survey of surveys) {
  statements.push(`INSERT INTO surveys (id, at, data) VALUES (${quote(survey.id)}, ${quote(survey.at)}, ${quote(JSON.stringify(survey))}) ON CONFLICT(id) DO UPDATE SET at = excluded.at, data = excluded.data;`);
}

process.stdout.write(`${statements.join('\n')}\n`);
console.error(`D1 seed SQL dibuat: ${(db.propemperda || []).length} PROPEMPERDA, ${(db.ranperda || []).length} Ranperda, ${surveys.length} survei.`);
