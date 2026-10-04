package com.sheetspace

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals

class WorkbookTransportContractTest {
    @Test
    fun `sheet command and revision values serialize their public fields`() {
        assertEquals(
            """{"name":"Inputs","position":{"x":10.0,"y":20.0},"frameSize":{"width":300.0,"height":200.0},"visualScale":1.5,"zIndex":2}""",
            testJson.encodeToString(
                CreateSheetRequest(
                    name = "Inputs",
                    position = WorkspacePosition(10.0, 20.0),
                    frameSize = SheetFrameSize(300.0, 200.0),
                    visualScale = 1.5,
                    zIndex = 2,
                ),
            ),
        )
        assertEquals(
            """{"name":"Outputs","position":{"x":30.0,"y":40.0},"frameSize":{"width":400.0,"height":250.0},"visualScale":0.75}""",
            testJson.encodeToString(
                UpdateSheetRequest(
                    name = "Outputs",
                    position = WorkspacePosition(30.0, 40.0),
                    frameSize = SheetFrameSize(400.0, 250.0),
                    visualScale = 0.75,
                ),
            ),
        )
        assertEquals(
            """{"sheetId":"sheet-1","expectedRevision":3,"zIndex":2}""",
            testJson.encodeToString(SheetZOrderUpdateRequest("sheet-1", 3, 2)),
        )
        assertEquals(
            SheetRevisionResponse("sheet-1", 4),
            testJson.decodeFromString("""{"sheetId":"sheet-1","revision":4}"""),
        )
    }

    @Test
    fun `mutation request and response values serialize their public fields`() {
        assertEquals("""{"writes":[{"axis":"row","axisId":"row-1","size":20.0}]}""", testJson.encodeToString(PresentationWriteRequest(listOf(AxisSizeWrite("row", "row-1", 20.0)))))
        assertEquals("""{"updates":[{"sheetId":"sheet-1","expectedRevision":3,"zIndex":2}]}""", testJson.encodeToString(UpdateSheetZOrderRequest(listOf(SheetZOrderUpdateRequest("sheet-1", 3, 2)))))
        assertEquals("""{"sheets":[{"sheetId":"sheet-1","revision":3}]}""", testJson.encodeToString(UpdateSheetZOrderResponse(listOf(SheetRevisionResponse("sheet-1", 3)))))
        assertEquals("""{"sheets":[{"sheetId":"sheet-1","revision":3}]}""", testJson.encodeToString(CellPatchResponse(listOf(SheetRevisionResponse("sheet-1", 3)))))
        assertEquals("""{"sheetId":"sheet-1","revision":3}""", testJson.encodeToString(CellRevisionRequest("sheet-1", 3)))
        assertEquals("""{"sheetId":"sheet-1","rowId":"row-1","columnId":"column-1","raw":"value"}""", testJson.encodeToString(CellWriteRequest("sheet-1", "row-1", "column-1", "value")))
    }

    @Test
    fun `request payloads decode optional fields to their documented defaults`() {
        assertEquals(
            CreateSheetRequest(name = "Inputs"),
            testJson.decodeFromString<CreateSheetRequest>("""{"name":"Inputs"}"""),
        )
        assertEquals(
            UpdateSheetRequest(),
            testJson.decodeFromString<UpdateSheetRequest>("{}"),
        )
        assertEquals(
            PresentationWriteRequest(),
            testJson.decodeFromString<PresentationWriteRequest>("{}"),
        )
        assertEquals(
            PresentationWriteRequest(formatWrites = listOf(FormatWrite("row", "row-1", NumberFormat("percent", 2)))),
            testJson.decodeFromString(
                """{"formatWrites":[{"scope":"row","targetId":"row-1","numberFormat":{"kind":"percent","precision":2}}]}""",
            ),
        )
    }
}
