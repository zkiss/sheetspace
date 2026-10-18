package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FormulaReferenceContractTest {
    @Test fun `accepts and canonicalizes a relative A1 formula`() {
        val content = TabularContent(cells = mapOf("A1" to "value"))
        assertTrue(FormulaReferenceContract.isFormula("=@A[1]*2"))
        val (workbook, sheet) = workbook(content)
        assertEquals("=@${content.columns.first().value}[${content.rows.first().value}]*2", FormulaReferenceContract.canonicalize("=@A[1]*2", workbook, sheet))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@Z[999]", workbook, sheet))
        assertTrue(FormulaReferenceContract.isFormula("=@A[2147483648]"))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@A[2147483648]", workbook, sheet))
        assertTrue(FormulaReferenceContract.isFormula("=@FXSHRXY[1]"))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@FXSHRXY[1]", workbook, sheet))
        assertTrue(FormulaReferenceContract.isFormula("=@BKTXHSOGHKKE[1]"))
        assertFalse(FormulaReferenceContract.isFormula("=@BKTXHSOGHKKF[1]"))
        assertFalse(FormulaReferenceContract.isFormula("=@A[9007199254740992]"))
    }

    @Test fun `rejects incomplete syntax while preserving literal reference text`() {
        val content = TabularContent(cells = mapOf("A1" to "value"))
        assertTrue(!FormulaReferenceContract.isFormula("=1+"))
        val (workbook, sheet) = workbook(content)
        assertEquals("=\"@A[1]\"", FormulaReferenceContract.canonicalize("=\"@A[1]\"", workbook, sheet))
        assertFalse(FormulaReferenceContract.isFormula("=#REF!"))
    }

    @Test fun `recognizes supported expression forms without treating malformed text as formulas`() {
        assertTrue(FormulaReferenceContract.isFormula("=SUM(1, -2.5e+1, TRUE, (FALSE)) >= 0"))
        assertTrue(FormulaReferenceContract.isFormula("=\"a \"\"quoted\"\" @A[1]\""))
        assertTrue(FormulaReferenceContract.isFormula("=@A[1]:\$B[\$2]"))
        assertFalse(FormulaReferenceContract.isFormula("=#DIV/0!"))
        assertFalse(FormulaReferenceContract.isFormula("=#NOT-A-FRONTEND-ERROR!"))
        assertFalse(FormulaReferenceContract.isFormula("not a formula"))
        assertFalse(FormulaReferenceContract.isFormula("="))
        assertFalse(FormulaReferenceContract.isFormula("=SUM(1,)"))
        assertFalse(FormulaReferenceContract.isFormula("=TRUEish"))
    }

    @Test fun `canonicalizes ranges anchors canonical identities and qualified references`() {
        val content = TabularContent(columnCount = 2, rowCount = 2)
        val firstColumn = content.columns[0].value
        val secondColumn = content.columns[1].value
        val firstRow = content.rows[0].value
        val secondRow = content.rows[1].value
        val canonical = "=@$firstColumn[$firstRow]"
        val other = TabularContent(columnCount = 2, rowCount = 2)
        val (workbook, sheet, otherSheet) = workbook(content, other)

        assertEquals(
            "=@$firstColumn[$firstRow]:\$$secondColumn[\$$secondRow]",
            FormulaReferenceContract.canonicalize("=@A[1]:\$B[\$2]", workbook, sheet),
        )
        assertEquals(canonical, FormulaReferenceContract.canonicalize(canonical, workbook, sheet))
        assertEquals(
            "=@${otherSheet.value}!${other.columns[0].value}[${other.rows[0].value}] + @${otherSheet.value}!${other.columns[1].value}[${other.rows[1].value}]",
            FormulaReferenceContract.canonicalize("=@'Other sheet'!A[1] + @'Other sheet'!B[2]", workbook, sheet),
        )
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@A[3]", workbook, sheet))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@C[1]", workbook, sheet))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@#REF!A[1]", workbook, sheet))
        val escapedName = workbook.replaceSheet(workbook.findSheet(otherSheet)!!.rename("O'Brien"))
        assertEquals(
            "=@${otherSheet.value}!${other.columns[0].value}[${other.rows[0].value}]",
            FormulaReferenceContract.canonicalize("=@'O''Brien'!A[1]", escapedName, sheet),
        )
        assertEquals(
            "=@${otherSheet.value} ! ${other.columns[0].value}[${other.rows[0].value}]",
            FormulaReferenceContract.canonicalize("=@'Other sheet' ! A[1]", workbook, sheet),
        )
        assertNull(FormulaReferenceContract.canonicalize("plain text", workbook, sheet))
    }

    @Test fun `copies canonical formulas by row and column while respecting anchors`() {
        val content = TabularContent(columnCount = 3, rowCount = 3)
        val source = CellCoordinate(content.rows[0], content.columns[0])
        val destination = CellCoordinate(content.rows[1], content.columns[1])
        val firstColumn = content.columns[0].value
        val secondColumn = content.columns[1].value
        val thirdColumn = content.columns[2].value
        val firstRow = content.rows[0].value
        val secondRow = content.rows[1].value
        val thirdRow = content.rows[2].value

        val (workbook, sheet) = workbook(content)
        assertEquals(
            "=@$secondColumn[$secondRow] + @\$$firstColumn[$secondRow] + @$secondColumn[\$$firstRow] + @\$$firstColumn[\$$firstRow]",
            FormulaReferenceContract.copyCanonical(
                "=@$firstColumn[$firstRow] + @\$$firstColumn[$firstRow] + @$firstColumn[\$$firstRow] + @\$$firstColumn[\$$firstRow]",
                source,
                destination,
                workbook, sheet,
            ),
        )
        assertEquals(
            "=@$thirdColumn[$thirdRow]",
            FormulaReferenceContract.copyCanonical("=@$secondColumn[$secondRow]", source, destination, workbook, sheet),
        )
        assertEquals(
            "=@$secondColumn[$secondRow]",
            FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, destination, workbook, sheet),
        )
        assertEquals(
            "=@$thirdColumn[$thirdRow]",
            FormulaReferenceContract.copyCanonical("=@$secondColumn[$secondRow]", source, destination, workbook, sheet),
        )
        assertNull(FormulaReferenceContract.copyCanonical("=@$secondColumn[$thirdRow]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$thirdColumn[$thirdRow]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@missing-1[$firstRow]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[missing-1]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("plain text", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", CellCoordinate(RowId("gone"), content.columns[0]), destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", CellCoordinate(content.rows[0], ColumnId("gone")), destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, CellCoordinate(content.rows[1], ColumnId("gone")), workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, CellCoordinate(RowId("gone"), content.columns[1]), workbook, sheet))
    }

    @Test fun `copies canonical references after generated error text while leaving the error intact`() {
        val content = TabularContent(columnCount = 2, rowCount = 2)
        val source = CellCoordinate(content.rows[0], content.columns[0])
        val destination = CellCoordinate(content.rows[1], content.columns[1])
        val (workbook, sheet) = workbook(content)
        val firstColumn = content.columns[0].value
        val firstRow = content.rows[0].value
        val secondColumn = content.columns[1].value
        val secondRow = content.rows[1].value

        assertEquals(
            "=#REF! + @$secondColumn[$secondRow]:\$$firstColumn[\$$firstRow]",
            FormulaReferenceContract.copyCanonical(
                "=#REF! + @$firstColumn[$firstRow]:\$$firstColumn[\$$firstRow]",
                source,
                destination,
                workbook,
                sheet,
            ),
        )
    }

    @Test fun `recovers every canonical reference after generated error text`() {
        val content = TabularContent(columnCount = 3, rowCount = 2)
        val source = CellCoordinate(content.rows[0], content.columns[0])
        val destination = CellCoordinate(content.rows[1], content.columns[1])
        val (workbook, sheet) = workbook(content)
        val firstRow = content.rows[0].value
        val secondRow = content.rows[1].value

        assertEquals(
            "=#REF! + @${content.columns[1].value}[$secondRow] + @${content.columns[2].value}[$secondRow]",
            FormulaReferenceContract.copyCanonical(
                "=#REF! + @${content.columns[0].value}[$firstRow] + @${content.columns[1].value}[$firstRow]",
                source, destination, workbook, sheet,
            ),
        )
    }

    @Test fun `rejects mixed endpoint ranges and preserves explicit sheet during copy`() {
        val local = TabularContent(columnCount = 2, rowCount = 2)
        val target = TabularContent(columnCount = 2, rowCount = 2)
        val (workbook, sheet, targetSheet) = workbook(local, target)
        assertFalse(FormulaReferenceContract.isFormula("=@A[1]:${target.columns[0].value}[${target.rows[0].value}]"))
        val raw = "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]"
        val copied = FormulaReferenceContract.copyCanonical(raw, CellCoordinate(local.rows[0], local.columns[0]), CellCoordinate(local.rows[1], local.columns[1]), workbook, sheet)
        assertEquals("=@${targetSheet.value}!${target.columns[1].value}[${target.rows[1].value}]", copied)
    }

    @Test fun `resolves qualified targets by identifier and rejects unavailable copy sheets`() {
        val local = TabularContent(columnCount = 2, rowCount = 2)
        val target = TabularContent(columnCount = 2, rowCount = 2)
        val (workbook, sheet, targetSheet) = workbook(local, target)
        val source = CellCoordinate(local.rows[0], local.columns[0])
        val destination = CellCoordinate(local.rows[1], local.columns[1])

        assertEquals(
            "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]",
            FormulaReferenceContract.canonicalize("=@${targetSheet.value}!A[1]", workbook, sheet),
        )
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@missing-sheet!A[1]", workbook, sheet))
        assertNull(
            FormulaReferenceContract.copyCanonical(
                "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]",
                source, destination, workbook, sheet, sourceSheetId = SheetId("missing-source"),
            ),
        )
        assertNull(
            FormulaReferenceContract.copyCanonical(
                "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]",
                source, destination, workbook, sheet, destinationSheetId = SheetId("missing-destination"),
            ),
        )
        assertNull(
            FormulaReferenceContract.copyCanonical(
                "=@missing-sheet!${target.columns[0].value}[${target.rows[0].value}]",
                source, destination, workbook, sheet,
            ),
        )
    }

    @Test fun `rejects calculated ownership when its sheet is unavailable`() {
        val (workbook) = workbook(TabularContent(cells = mapOf("A1" to "value")))
        val model = DataModel(
            "model-1",
            "Metrics",
            listOf(CalculatedDataModelProperty("property-1", "Derived", "=@A[1]")),
        )

        assertFalse(hasOnlyModelOwnedCalculatedContents(workbook, SheetId("missing-sheet"), model))
    }

    @Test fun `later model rows copy their stored canonical first row instead of the declaration`() {
        val content = TabularContent(columnCount = 3, rowCount = 2)
        val stored = "=@${content.columns[0].value}[${content.rows[0].value}]*2"
        val sheet = SheetDocument(SheetId("00000000-0000-0000-0000-000000000001"), name = "Local", content = content.updateCell("B1", stored))
        val workbook = WorkbookState(WorkbookManifest(sheetIds = listOf(sheet.id)), mapOf(sheet.id to sheet))

        assertEquals(
            "=@${content.columns[0].value}[${content.rows[1].value}]*2",
            materializeModelFormula("=@C[1]*2", workbook, sheet.id, CellCoordinate(content.rows[1], content.columns[1])),
        )
    }

    @Test fun `matches the frontend-derived shared formula contract fixture`() {
        val fixture = Json.parseToJsonElement(
            requireNotNull(javaClass.classLoader.getResource("formula-contract-cases.json"))
                .readText(),
        ).jsonObject
        fixture.getValue("syntax").jsonArray.forEach { entry ->
            val case = entry.jsonObject
            assertEquals(
                case.getValue("accepted").jsonPrimitive.boolean,
                FormulaReferenceContract.isFormula(case.getValue("raw").jsonPrimitive.content),
                case.getValue("raw").jsonPrimitive.content,
            )
            assertEquals(
                case.getValue("accepted").jsonPrimitive.boolean,
                isSupportedFormula(case.getValue("raw").jsonPrimitive.content),
                "calculated template admission: ${case.getValue("raw").jsonPrimitive.content}",
            )
        }
        val canonical = fixture.getValue("canonical").jsonObject
        val local = fixedContent("00000000-0000-0000-0000-000000000001")
        val other = fixedContent("00000000-0000-0000-0000-000000000002")
        val (workbook, sheet) = workbook(local, other)
        val raw = canonical.getValue("raw").jsonPrimitive.content
        assertEquals(canonical.getValue("output").jsonPrimitive.content, FormulaReferenceContract.canonicalize(raw, workbook, sheet))
        assertEquals(
            canonical.getValue("copied").jsonPrimitive.content,
            FormulaReferenceContract.copyCanonical(raw = canonical.getValue("output").jsonPrimitive.content, source = CellCoordinate(local.rows[0], local.columns[0]), destination = CellCoordinate(local.rows[1], local.columns[1]), workbook = workbook, currentSheetId = sheet),
        )
        val storedCopy = fixture.getValue("storedCopy").jsonObject
        assertEquals(
            storedCopy.getValue("copied").jsonPrimitive.content,
            FormulaReferenceContract.copyCanonical(
                raw = storedCopy.getValue("raw").jsonPrimitive.content,
                source = CellCoordinate(local.rows[0], local.columns[0]),
                destination = CellCoordinate(local.rows[1], local.columns[1]),
                workbook = workbook,
                currentSheetId = sheet,
            ),
        )
        val storedCopyMultiple = fixture.getValue("storedCopyMultiple").jsonObject
        val threeColumnLocal = fixedContent("00000000-0000-0000-0000-000000000001", columnCount = 3)
        val (threeColumnWorkbook, threeColumnSheet) = workbook(threeColumnLocal, other)
        assertEquals(
            storedCopyMultiple.getValue("copied").jsonPrimitive.content,
            FormulaReferenceContract.copyCanonical(
                raw = storedCopyMultiple.getValue("raw").jsonPrimitive.content,
                source = CellCoordinate(threeColumnLocal.rows[0], threeColumnLocal.columns[0]),
                destination = CellCoordinate(threeColumnLocal.rows[1], threeColumnLocal.columns[1]),
                workbook = threeColumnWorkbook,
                currentSheetId = threeColumnSheet,
            ),
        )

        val transformLocal = fixedContent("00000000-0000-0000-0000-000000000001", columnCount = 3, rowCount = 3)
        val transformOther = fixedContent("00000000-0000-0000-0000-000000000002", columnCount = 3, rowCount = 3)
        val (transformWorkbook, transformSheet, transformOtherSheet) = workbook(transformLocal, transformOther)
        val namedWorkbook = transformWorkbook.replaceSheet(transformWorkbook.findSheet(transformOtherSheet)!!.rename("O'Brien"))
        val source = CellCoordinate(transformLocal.rows[0], transformLocal.columns[0])
        val destination = CellCoordinate(transformLocal.rows[1], transformLocal.columns[1])
        fixture.getValue("transforms").jsonArray.forEach { entry ->
            val case = entry.jsonObject
            val raw = case.getValue("raw").jsonPrimitive.content
            val canonicalRaw = case["canonical"]?.jsonPrimitive?.contentOrNull
            if (canonicalRaw != null) {
                assertEquals(canonicalRaw, FormulaReferenceContract.canonicalize(raw, namedWorkbook, transformSheet), case.getValue("id").jsonPrimitive.content)
            }
            assertEquals(
                case.getValue("copied").jsonPrimitive.content,
                FormulaReferenceContract.copyCanonical(canonicalRaw ?: raw, source, destination, namedWorkbook, transformSheet),
                case.getValue("id").jsonPrimitive.content,
            )
        }
        fixture.getValue("copyFailures").jsonArray.forEach { entry ->
            val case = entry.jsonObject
            assertNull(
                FormulaReferenceContract.copyCanonical(case.getValue("raw").jsonPrimitive.content, source, destination, namedWorkbook, transformSheet),
                case.getValue("id").jsonPrimitive.content,
            )
        }
        val crossSheetCopy = fixture.getValue("crossSheetCopy").jsonObject
        assertEquals(
            crossSheetCopy.getValue("copied").jsonPrimitive.content,
            FormulaReferenceContract.copyCanonical(
                crossSheetCopy.getValue("raw").jsonPrimitive.content,
                source,
                CellCoordinate(transformOther.rows[1], transformOther.columns[1]),
                namedWorkbook,
                transformSheet,
                sourceSheetId = transformSheet,
                destinationSheetId = transformOtherSheet,
            ),
            crossSheetCopy.getValue("id").jsonPrimitive.content,
        )
    }

    @Test fun `accepts the exact bundle captured by the frontend mutation and transport path`() {
        val fixture = Json.parseToJsonElement(
            requireNotNull(javaClass.classLoader.getResource("formula-contract-cases.json")).readText(),
        ).jsonObject
        val bundle = Json.decodeFromJsonElement<WorkbookBundleResponse>(fixture.getValue("bundle"))

        val state = dataModelState(bundle)

        val sheet = state.findSheet(SheetId("00000000-0000-0000-0000-000000000001"))!!
        assertEquals(
            "=@00000000-0000-0000-0000-000000000201[00000000-0000-0000-0000-000000000103]+1",
            sheet.tabularContent.cellContents[CellCoordinate(
                RowId("00000000-0000-0000-0000-000000000103"),
                ColumnId("00000000-0000-0000-0000-000000000202"),
            )],
        )
    }

    @Test fun `rejects an ownership-forged variation of the frontend transport bundle`() {
        val fixture = Json.parseToJsonElement(
            requireNotNull(javaClass.classLoader.getResource("formula-contract-cases.json")).readText(),
        ).jsonObject
        val original = fixture.getValue("bundle").jsonObject
        val document = original.getValue("documents").jsonArray.single().jsonObject
        val content = document.getValue("content").jsonObject
        val forgedCells = content.getValue("cells").jsonArray.mapIndexed { index, entry ->
            if (index != 2) entry else buildJsonObject {
                entry.jsonObject.forEach { (key, value) -> put(key, value) }
                put("content", "=@00000000-0000-0000-0000-000000000202[00000000-0000-0000-0000-000000000103]+1")
            }
        }
        val forgedBundle = buildJsonObject {
            original.forEach { (key, value) ->
                put(key, if (key == "documents") buildJsonArray {
                    add(buildJsonObject {
                        document.forEach { (documentKey, documentValue) ->
                            put(documentKey, if (documentKey == "content") buildJsonObject {
                                content.forEach { (contentKey, contentValue) -> put(contentKey, if (contentKey == "cells") buildJsonArray { forgedCells.forEach(::add) } else contentValue) }
                            } else documentValue)
                        }
                    })
                } else value)
            }
        }

        kotlin.test.assertFailsWith<WorkbookApplicationException> {
            dataModelState(Json.decodeFromJsonElement<WorkbookBundleResponse>(forgedBundle))
        }
    }

    private fun fixedContent(sheetId: String, columnCount: Int = 2, rowCount: Int = 2): TabularContent = TabularContent(
        rows = (1..rowCount).map { RowId("$sheetId:row:$it") },
        columns = (1..columnCount).map { ColumnId("$sheetId:column:$it") },
        cellContents = emptyMap(),
    )

    private fun workbook(vararg contents: TabularContent): Triple<WorkbookState, SheetId, SheetId> {
        val ids = contents.indices.map { index ->
            SheetId(if (index == 0) "00000000-0000-0000-0000-000000000001" else "00000000-0000-0000-0000-00000000000${index + 1}")
        }
        val documents = contents.mapIndexed { index, content -> ids[index] to SheetDocument(ids[index], name = if (index == 1) "Other sheet" else "Local", content = content) }.toMap()
        return Triple(WorkbookState(WorkbookManifest(sheetIds = ids), documents), ids[0], ids.getOrElse(1) { ids[0] })
    }
}
