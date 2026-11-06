package com.sheetspace

import java.sql.DriverManager

internal class AtomicAdmissionScenario(val store: SqliteWorkbookStore) {
    val app = DefaultWorkbookApplication(store)
    val row = RowId.generate()
    val before: WorkbookState
    val target: SheetDocument
    val other: SheetDocument
    val untouched: SheetDocument
    val request: RecordAdmissionRequest

    init {
        val base = lifecycleBoundWorkbook(lifecycleWorkbook())
        val model = base.dataModels.getValue(LIFECYCLE_MODEL)
        val declaration = "=@A[2]*2"
        val updatedModel = model.copy(columns = model.columns.map { if (it is CalculatedModelColumn) it.copy(formula = declaration) else it })
        val changed = base.copy(dataModels = mapOf(model.id to updatedModel), documents = base.documents.mapValues { (_, sheet) ->
            val content = sheet.tabularContent
            val input = sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT)
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            sheet.copy(
                modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to BoundModelFormula("=@${input.value}[${content.rows[1].value}]*2")),
                content = TabularContent(content.rows, content.columns, content.cellContents.filterKeys { it.columnId != output }),
                sorting = listOf(SortCriterion(input.value, "ascending")),
            )
        })
        store.saveWorkbook(materializeDerivedContents(changed).addSheet(SheetDocument(id = SheetId.generate(), name = "Untouched")))
        before = store.loadWorkbookBundle()
        target = before.sheetsInOrder[0]
        other = before.sheetsInOrder[1]
        untouched = before.sheetsInOrder[2]
        request = RecordAdmissionRequest(row.value, mapOf(LIFECYCLE_INPUT to "2"), WorkbookReadTransportAdapter.bundle(before), listOf(
            RecordRowOrder(target.id.value, listOf(row.value) + target.tabularContent.rows.map { it.value }),
            RecordRowOrder(other.id.value, other.tabularContent.rows.reversed().map { it.value }),
        ))
    }

    fun admit(request: RecordAdmissionRequest = this.request, revision: Long = target.revision): RecordAdmissionResult =
        app.admitRecord(target.id.value, revision, request.rowId, request.values, request.before, request.rowOrders)
}

internal fun admissionReceipts(store: SqliteWorkbookStore): Int = DriverManager.getConnection(store.jdbcUrl).use { connection ->
    connection.createStatement().use { statement -> statement.executeQuery("SELECT COUNT(*) FROM record_admissions").use { result -> result.next(); result.getInt(1) } }
}

internal fun admissionSql(store: SqliteWorkbookStore, sql: String) = DriverManager.getConnection(store.jdbcUrl).use { connection ->
    connection.createStatement().use { it.execute(sql) }
}
