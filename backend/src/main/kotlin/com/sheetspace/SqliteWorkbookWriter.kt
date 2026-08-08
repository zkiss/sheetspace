package com.sheetspace

import java.sql.Connection

/** Persists normalized workbook aggregates inside one caller-owned transaction. */
internal class SqliteWorkbookWriter(
    private val connection: Connection,
    private val reader: SqliteWorkbookReader,
) {
    private val cellWriter = SqliteCellWriter(connection)

    fun replaceAll(workbook: WorkbookState) {
        connection.createStatement().use { it.executeUpdate("DELETE FROM sheet_documents") }
        workbook.sheetsInOrder.forEach(::insertSheet)
        replaceManifest(workbook.manifest)
    }

    fun writeCells(
        expectedRevision: ExpectedSheetRevision,
        writes: List<CellWrite>,
    ): SheetDocument {
        val sheetId = SheetId(expectedRevision.sheetId)
        val current = reader.loadSheet(sheetId)
            ?: throw NoSuchElementException("Sheet not found: ${sheetId.value}")
        if (current.revision != expectedRevision.revision) {
            throw SheetRevisionConflict(
                sheetId.value,
                expectedRevision.revision,
                current.revision,
            )
        }

        incrementSheetRevision(sheetId, expectedRevision.revision)
        cellWriter.apply(sheetId, writes)
        return reader.loadSheet(sheetId) ?: error("Updated sheet disappeared: ${sheetId.value}")
    }

    fun persistChanges(current: WorkbookState, updated: WorkbookState) {
        current.documents.keys
            .filterNot(updated.documents::containsKey)
            .forEach(::deleteSheet)

        updated.sheetsInOrder.forEach { updatedSheet ->
            val currentSheet = current.findSheet(updatedSheet.id)
            when {
                currentSheet == null -> insertSheet(updatedSheet)
                currentSheet != updatedSheet -> replaceSheet(currentSheet, updatedSheet)
            }
        }

        if (current.manifest != updated.manifest) replaceManifest(updated.manifest)
    }

    private fun insertSheet(sheet: SheetDocument) {
        connection.prepareStatement(
            "INSERT INTO sheet_documents (id, name, content_kind, revision) VALUES (?, ?, 'TABULAR', ?)",
        ).use { statement ->
            statement.setBytes(1, sheet.id.value.toUuidBytes())
            statement.setString(2, sheet.name)
            statement.setLong(3, sheet.revision)
            statement.executeUpdate()
        }
        insertFrame(sheet)
        insertTabularContent(sheet.id, sheet.tabularContent)
    }

    private fun replaceSheet(current: SheetDocument, updated: SheetDocument) {
        val updatedRows = connection.prepareStatement(
            """
            UPDATE sheet_documents
            SET name = ?, content_kind = 'TABULAR', revision = revision + 1
            WHERE id = ? AND revision = ?
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, updated.name)
            statement.setBytes(2, updated.id.value.toUuidBytes())
            statement.setLong(3, current.revision)
            statement.executeUpdate()
        }
        if (updatedRows == 0) {
            throw SheetRevisionConflict(
                updated.id.value,
                current.revision,
                reader.loadSheetRevision(updated.id) ?: -1,
            )
        }

        connection.prepareStatement(
            """
            UPDATE frame_state
            SET position_x = ?, position_y = ?, frame_width = ?, frame_height = ?, z_index = ?
            WHERE sheet_id = ?
            """.trimIndent(),
        ).use { statement ->
            statement.setDouble(1, updated.frame.position.x)
            statement.setDouble(2, updated.frame.position.y)
            statement.setDouble(3, updated.frame.size.width)
            statement.setDouble(4, updated.frame.size.height)
            statement.setInt(5, updated.frame.zIndex)
            statement.setBytes(6, updated.id.value.toUuidBytes())
            statement.executeUpdate()
        }
        connection.prepareStatement("DELETE FROM sheet_rows WHERE sheet_id = ?").use { statement ->
            statement.setBytes(1, updated.id.value.toUuidBytes())
            statement.executeUpdate()
        }
        connection.prepareStatement("DELETE FROM sheet_columns WHERE sheet_id = ?").use { statement ->
            statement.setBytes(1, updated.id.value.toUuidBytes())
            statement.executeUpdate()
        }
        insertTabularContent(updated.id, updated.tabularContent)
    }

    private fun insertFrame(sheet: SheetDocument) {
        connection.prepareStatement(
            """
            INSERT INTO frame_state (
                sheet_id, position_x, position_y, frame_width, frame_height, z_index
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
        ).use { statement ->
            statement.setBytes(1, sheet.id.value.toUuidBytes())
            statement.setDouble(2, sheet.frame.position.x)
            statement.setDouble(3, sheet.frame.position.y)
            statement.setDouble(4, sheet.frame.size.width)
            statement.setDouble(5, sheet.frame.size.height)
            statement.setInt(6, sheet.frame.zIndex)
            statement.executeUpdate()
        }
    }

    private fun insertTabularContent(sheetId: SheetId, content: TabularContent) {
        connection.prepareStatement(
            "INSERT INTO sheet_rows (sheet_id, row_id, row_order) VALUES (?, ?, ?)",
        ).use { statement ->
            content.rows.forEachIndexed { index, rowId ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setBytes(2, rowId.value.toUuidBytes())
                statement.setInt(3, index)
                statement.addBatch()
            }
            statement.executeBatch()
        }
        connection.prepareStatement(
            "INSERT INTO sheet_columns (sheet_id, column_id, column_order) VALUES (?, ?, ?)",
        ).use { statement ->
            content.columns.forEachIndexed { index, columnId ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setBytes(2, columnId.value.toUuidBytes())
                statement.setInt(3, index)
                statement.addBatch()
            }
            statement.executeBatch()
        }
        cellWriter.replace(sheetId, content.cellContents)
    }

    private fun incrementSheetRevision(sheetId: SheetId, expectedRevision: Long) {
        val updatedRows = connection.prepareStatement(
            "UPDATE sheet_documents SET revision = revision + 1 WHERE id = ? AND revision = ?",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.setLong(2, expectedRevision)
            statement.executeUpdate()
        }
        if (updatedRows == 0) {
            throw SheetRevisionConflict(
                sheetId.value,
                expectedRevision,
                reader.loadSheetRevision(sheetId) ?: -1,
            )
        }
    }

    private fun deleteSheet(sheetId: SheetId) {
        connection.prepareStatement("DELETE FROM sheet_documents WHERE id = ?").use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeUpdate()
        }
    }

    private fun replaceManifest(manifest: WorkbookManifest) {
        connection.prepareStatement(
            """
            UPDATE workbook_metadata
            SET schema_version = ?, manifest_revision = ?
            WHERE singleton_key = 1
            """.trimIndent(),
        ).use { statement ->
            statement.setInt(1, manifest.version)
            statement.setLong(2, manifest.revision)
            statement.executeUpdate()
        }
        connection.createStatement().use { it.executeUpdate("DELETE FROM workbook_sheets") }
        connection.prepareStatement(
            "INSERT INTO workbook_sheets (sheet_id, sheet_order) VALUES (?, ?)",
        ).use { statement ->
            manifest.sheetIds.forEachIndexed { index, sheetId ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setInt(2, index)
                statement.addBatch()
            }
            statement.executeBatch()
        }
    }
}
