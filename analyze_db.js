const Database = require('better-sqlite3');
const db = new Database('C:/Users/Administrator/Desktop/claude-code-deployer/db_backup_20260525_112407.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
  console.log('\n=== ' + t.name + ' ===');
  const rows = db.prepare('SELECT * FROM "' + t.name + '"').all();
  for (const r of rows) console.log(JSON.stringify(r, null, 2));
}
db.close();
