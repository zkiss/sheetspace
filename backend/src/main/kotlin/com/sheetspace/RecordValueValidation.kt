package com.sheetspace

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.Engine
import org.graalvm.polyglot.HostAccess
import org.graalvm.polyglot.Source
import org.graalvm.polyglot.io.IOAccess

fun interface RecordValueValidation {
    fun valid(workbook: WorkbookState, sheetId: SheetId, values: Map<String, String>): Boolean
}

/** Runs the shared formula engine with JSON-only inputs and no host or IO capabilities. */
internal object SharedRecordValueValidation : RecordValueValidation {
    private val engine = Engine.newBuilder().option("engine.WarnInterpreterOnly", "false").build()
    private val source = Source.newBuilder("js", requireNotNull(javaClass.getResource("/calculation/record-admission.js")).readText(), "record-admission.js").build()

    override fun valid(workbook: WorkbookState, sheetId: SheetId, values: Map<String, String>): Boolean =
        Context.newBuilder("js").engine(engine).allowHostAccess(HostAccess.NONE).allowHostClassLookup { false }.allowIO(IOAccess.NONE).build().use { context ->
            context.eval(source)
            context.getBindings("js").getMember("RecordAdmission").getMember("validate").execute(
                Json.encodeToString(WorkbookReadTransportAdapter.bundle(workbook)), sheetId.value, Json.encodeToString(values),
            ).asBoolean()
        }
}
