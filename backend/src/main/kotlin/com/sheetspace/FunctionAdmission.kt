package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.Engine
import org.graalvm.polyglot.HostAccess
import org.graalvm.polyglot.Source
import org.graalvm.polyglot.io.IOAccess

interface FunctionAdmission {
    fun set(workbook: WorkbookState, declaration: CustomFunction, previousName: String?): List<CustomFunction>?
    fun bindSheet(workbook: WorkbookState, sheetId: SheetId): List<CustomFunction>
}

@Serializable
private data class FunctionAdmissionResult(val functions: List<CustomFunction>? = null, val error: String? = null)

internal object SharedFunctionAdmission : FunctionAdmission {
    private val engine = Engine.newBuilder().option("engine.WarnInterpreterOnly", "false").build()
    private val source = Source.newBuilder("js", requireNotNull(javaClass.getResource("/calculation/record-admission.js")).readText(), "record-admission.js").build()

    private fun execute(workbook: WorkbookState, method: String, vararg args: Any?): String =
        Context.newBuilder("js").engine(engine).allowHostAccess(HostAccess.NONE).allowHostClassLookup { false }.allowIO(IOAccess.NONE).build().use { context ->
            context.eval(source)
            context.getBindings("js").getMember("RecordAdmission").getMember(method).execute(
                Json.encodeToString(WorkbookReadTransportAdapter.bundle(workbook)), *args,
            ).asString()
        }

    override fun set(workbook: WorkbookState, declaration: CustomFunction, previousName: String?): List<CustomFunction>? =
        Json.decodeFromString<FunctionAdmissionResult>(execute(workbook, "admitFunction", Json.encodeToString(declaration), previousName)).functions

    override fun bindSheet(workbook: WorkbookState, sheetId: SheetId): List<CustomFunction> =
        Json.decodeFromString(execute(workbook, "bindFunctionSheet", sheetId.value))

    fun reconcileBinding(workbook: WorkbookState, sheetId: SheetId, previous: CustomFunction, binding: String?, next: CustomFunction, excludedQualifiedSheetId: SheetId? = null): String? =
        Json.decodeFromString(execute(workbook, "reconcileFunctionBinding", sheetId.value, Json.encodeToString(previous), binding, Json.encodeToString(next), excludedQualifiedSheetId?.value))

    fun reconcileAbsentBinding(workbook: WorkbookState, state: ReplayBindingProvenance, next: CustomFunction): String? {
        val bundle = WorkbookReadTransportAdapter.bundle(workbook)
        val captured = bundle.copy(
            manifest = bundle.manifest.copy(sheetIds = listOf(state.caller.id)),
            documents = listOf(state.caller),
            functions = emptyList(),
        ).toLifecycleWorkbook().documents.getValue(SheetId(state.caller.id))
        val context = if (captured.id in workbook.documents) workbook else workbook.addSheet(captured)
        return reconcileBinding(context, captured.id, state.declaration, state.binding, next, captured.id.takeIf { it !in workbook.documents })
    }
}
