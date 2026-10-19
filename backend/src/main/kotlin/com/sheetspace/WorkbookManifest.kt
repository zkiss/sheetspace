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
    val dataModels: Map<String, DataModel> = emptyMap(),
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

data class DataModel(val id: String, val name: String, val properties: List<DataModelProperty>)
enum class DataModelPropertyType { STRING, INT, FLOAT, BOOLEAN }
sealed interface DataModelProperty { val id: String; val name: String; val type: DataModelPropertyType }
data class ManualDataModelProperty(override val id: String, override val name: String, override val type: DataModelPropertyType) : DataModelProperty
data class CalculatedDataModelProperty(override val id: String, override val name: String, val formula: String, override val type: DataModelPropertyType) : DataModelProperty

fun emptyWorkbookState(): WorkbookState = WorkbookState()

/**
 * Publishes aggregate sheet revisions from the stored state after admission has accepted a
 * candidate. Client revisions are CAS baselines, never the revisions persisted for a change.
 */
internal fun WorkbookState.withPublishedSheetRevisionsFrom(current: WorkbookState): WorkbookState = copy(
    documents = documents.mapValues { (sheetId, candidate) ->
        val stored = current.documents[sheetId]
        when {
            stored == null -> candidate.copy(revision = 0)
            stored != candidate -> candidate.copy(revision = stored.revision + 1)
            else -> candidate
        }
    },
)

fun createSheetDocument(
    name: String,
    existingSheets: Collection<SheetDocument> = emptyList(),
    position: WorkspacePosition = WorkspacePosition(),
    frameSize: SheetFrameSize = SheetFrameSize(),
    visualScale: Double = 1.0,
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
                    visualScale = visualScale,
                    zIndex = zIndex ?: nextSheetZIndex(existingSheets),
                ),
            ),
        )
    }
}

private fun nextSheetZIndex(sheets: Collection<SheetDocument>): Int =
    (sheets.maxOfOrNull { it.frame.zIndex } ?: 0) + 1
