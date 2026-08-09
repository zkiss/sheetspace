package com.sheetspace

import java.util.UUID

@JvmInline
value class SheetId(val value: String) {
    companion object {
        fun generate(): SheetId = SheetId(UUID.randomUUID().toString())
    }
}

data class SheetDocument(
    val id: SheetId,
    val revision: Long = 0,
    val name: String,
    val frame: FrameState = FrameState(),
    val content: SheetContent = TabularContent(),
) {
    val tabularContent: TabularContent
        get() = content as? TabularContent
            ?: error("Sheet ${id.value} content is not tabular")

    fun rename(name: String): SheetDocument = copy(name = name)

    fun updateFrame(transform: (FrameState) -> FrameState): SheetDocument =
        copy(frame = transform(frame))

    fun updateTabularContent(transform: (TabularContent) -> TabularContent): SheetDocument =
        copy(content = transform(tabularContent))
}

sealed class SheetNameResult<out T> {
    data class Valid<T>(val value: T) : SheetNameResult<T>()
    data class Invalid(val reason: SheetNameError) : SheetNameResult<Nothing>()
}

enum class SheetNameError {
    EMPTY,
    DUPLICATE,
}

fun validateSheetName(
    name: String,
    existingSheets: Collection<SheetDocument>,
    currentSheetId: SheetId? = null,
): SheetNameResult<String> {
    val trimmedName = name.trim()
    if (trimmedName.isEmpty()) {
        return SheetNameResult.Invalid(SheetNameError.EMPTY)
    }

    val duplicate = existingSheets.any { sheet ->
        sheet.id != currentSheetId && sheet.name == trimmedName
    }
    return if (duplicate) {
        SheetNameResult.Invalid(SheetNameError.DUPLICATE)
    } else {
        SheetNameResult.Valid(trimmedName)
    }
}
