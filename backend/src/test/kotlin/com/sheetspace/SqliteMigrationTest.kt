package com.sheetspace

import org.flywaydb.core.Flyway
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class SqliteMigrationTest {
    @Test
    fun `UUID blob migration discards legacy text-id sheets`() {
        assertMigrationDiscardsLegacySheet(
            targetVersion = "3",
            insertSql =
                """
                INSERT INTO sheets (
                    id, display_order, name, row_count, column_count, position_x, position_y,
                    cells_json, revision, z_index, frame_width, frame_height
                ) VALUES ('legacy-sheet', 0, 'Legacy', 20, 10, 0, 0, '{"cells":{}}', 0, 1, 240, 160)
                """.trimIndent(),
        )
    }

    @Test
    fun `formula reference migration discards legacy cell JSON`() {
        assertMigrationDiscardsLegacySheet(
            targetVersion = "4",
            insertSql =
                """
                INSERT INTO sheets (
                    id, display_order, name, row_count, column_count, position_x, position_y,
                    cells_json, revision, z_index, frame_width, frame_height
                ) VALUES (X'00000000000000000000000000000001', 0, 'Legacy', 20, 10, 0, 0, '{"cells":{}}', 0, 1, 240, 160)
                """.trimIndent(),
        )
    }

    @Test
    fun `string cell migration discards object-valued cells`() {
        assertMigrationDiscardsLegacySheet(
            targetVersion = "6",
            insertSql =
                """
                INSERT INTO sheets (
                    id, name, row_count, column_count, position_x, position_y,
                    cells_json, revision, z_index, frame_width, frame_height
                ) VALUES (X'00000000000000000000000000000001', 'Inputs', 25, 14, 12.5, -8.25, '{"cells":{"A1":{"raw":"7"}}}', 3, 9, 360, 240)
                """.trimIndent(),
        )
    }

    private fun assertMigrationDiscardsLegacySheet(targetVersion: String, insertSql: String) {
        val jdbcUrl = "jdbc:sqlite:file:sheetspace-migration-${UUID.randomUUID()}?mode=memory&cache=shared"
        val keeper = DriverManager.getConnection(jdbcUrl)
        migrateTo(jdbcUrl, targetVersion)
        keeper.createStatement().use { it.executeUpdate(insertSql) }

        SqliteWorkbookStore(jdbcUrl, keeper).use { store ->
            assertEquals(emptyWorkbookState(), store.loadWorkbook())
        }
    }

    private fun migrateTo(jdbcUrl: String, targetVersion: String) {
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .target(targetVersion)
            .load()
            .migrate()
    }
}
