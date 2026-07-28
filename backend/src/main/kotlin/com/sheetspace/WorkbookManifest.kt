package com.sheetspace

data class WorkbookManifest(
    val version: Int = WORKBOOK_SCHEMA_VERSION,
    val revision: Long = 0,
    val sheetIds: List<SheetId> = emptyList(),
) {
    init {
        require(sheetIds.distinct().size == sheetIds.size) {
            "Workbook manifest cannot contain duplicate sheet ids"
        }
    }

    fun append(sheetId: SheetId): WorkbookManifest {
        require(sheetId !in sheetIds) { "Sheet already belongs to workbook: ${sheetId.value}" }
        return copy(revision = revision + 1, sheetIds = sheetIds + sheetId)
    }

    fun remove(sheetId: SheetId): WorkbookManifest {
        require(sheetId in sheetIds) { "Sheet does not belong to workbook: ${sheetId.value}" }
        return copy(revision = revision + 1, sheetIds = sheetIds.filterNot { it == sheetId })
    }
}

data class WorkbookState(
    val manifest: WorkbookManifest = WorkbookManifest(),
    val documents: Map<SheetId, SheetDocument> = emptyMap(),
) {
    init {
        require(manifest.sheetIds.toSet() == documents.keys) {
            "Workbook manifest membership must match sheet documents"
        }
    }

    val sheetsInOrder: List<SheetDocument>
        get() = manifest.sheetIds.map(documents::getValue)

    fun findSheet(id: SheetId): SheetDocument? = documents[id]

    fun addSheet(sheet: SheetDocument): WorkbookState = copy(
        manifest = manifest.append(sheet.id),
        documents = documents + (sheet.id to sheet),
    )

    fun replaceSheet(sheet: SheetDocument): WorkbookState {
        require(sheet.id in documents) { "Sheet does not belong to workbook: ${sheet.id.value}" }
        return copy(documents = documents + (sheet.id to sheet))
    }

    fun removeSheet(id: SheetId): WorkbookState = copy(
        manifest = manifest.remove(id),
        documents = documents - id,
    )
}

fun emptyWorkbookState(): WorkbookState = WorkbookState()

fun createSheetDocument(
    name: String,
    existingSheets: Collection<SheetDocument> = emptyList(),
    position: WorkspacePosition = WorkspacePosition(),
    frameSize: SheetFrameSize = SheetFrameSize(),
    zIndex: Int? = null,
): SheetNameResult<SheetDocument> {
    return when (val validation = validateSheetName(name, existingSheets)) {
        is SheetNameResult.Invalid -> validation
        is SheetNameResult.Valid -> SheetNameResult.Valid(
            SheetDocument(
                id = SheetId.generate(),
                name = validation.value,
                frame = FrameState(
                    position = position,
                    size = frameSize,
                    zIndex = zIndex ?: nextSheetZIndex(existingSheets),
                ),
            ),
        )
    }
}

private fun nextSheetZIndex(sheets: Collection<SheetDocument>): Int =
    (sheets.maxOfOrNull { it.frame.zIndex } ?: 0) + 1
