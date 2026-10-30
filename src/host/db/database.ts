import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Database = DatabaseSync

/** Opens the database, pass `:memory:` in tests, and brings the schema up to date. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function countBrokenReferences(db: Database): number {
  return db.prepare('PRAGMA foreign_key_check').all().length
}

/**
 * Foreign keys stay off here so a migration can rebuild a table, which is how SQLite changes
 * constraints. With them on, dropping the old table would cascade and delete its child rows.
 * The setting has no effect inside a transaction, so it is decided before the first one, and
 * each migration proves it left every reference intact before it commits.
 */
function migrate(db: Database): void {
  db.exec('PRAGMA foreign_keys = OFF')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  MIGRATIONS.slice(row.user_version).forEach((sql, index) => {
    db.exec('BEGIN')
    try {
      const brokenBefore = countBrokenReferences(db)
      db.exec(sql)
      if (countBrokenReferences(db) > brokenBefore) {
        throw new Error('A migration broke a foreign key reference.')
      }
      db.exec(`PRAGMA user_version = ${row.user_version + index + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
}
