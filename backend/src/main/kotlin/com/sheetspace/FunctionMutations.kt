package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

internal class FunctionMutations(private val store: WorkbookStore, private val functionAdmission: FunctionAdmission) {
    fun admitFunctionWrite(request: FunctionWriteRequest): FunctionMutationResponse {
        val payload = JsonObject(mapOf("declaration" to Json.encodeToJsonElement(request.declaration), "previousName" to Json.encodeToJsonElement(request.previousName)))
        val (prepared, before) = prepareFunctionMutation(request.operationId, request.before, "write", payload)
        val result = store.admitFunction(prepared) { current ->
            val updated = applyFunctionWrite(current, before, request.declaration, request.previousName)
            writeResult(current, updated, request.declaration.name, request.previousName)
        }
        return FunctionMutationResponse(prepared.operationId, result.committedIdentity, result.alreadyCommitted, WorkbookReadTransportAdapter.bundle(result.workbook))
    }

    fun admitFunctionDelete(request: FunctionDeleteRequest): FunctionMutationResponse {
        val (prepared, before) = prepareFunctionMutation(request.operationId, request.before, "delete", JsonPrimitive(request.name))
        val result = store.admitFunction(prepared) { current ->
            val updated = applyFunctionDelete(current, before, request.name)
            deleteResult(current, updated, request.name)
        }
        return FunctionMutationResponse(prepared.operationId, result.committedIdentity, result.alreadyCommitted, WorkbookReadTransportAdapter.bundle(result.workbook))
    }
    fun setFunction(before: WorkbookState, declaration: CustomFunction, previousName: String?): WorkbookState =
        store.updateFunction { current -> writeResult(current, applyFunctionWrite(current, before, declaration, previousName), declaration.name, previousName) }

    private fun writeResult(current: WorkbookState, updated: WorkbookState, name: String, previousName: String?): FunctionMutationResult {
        val previous = current.functions.find { it.name.equals(previousName, ignoreCase = true) }
        val next = updated.functions.single { it.name.equals(name, ignoreCase = true) }
        return FunctionMutationResult(updated, next.identity, previous, next)
    }

    private fun deleteResult(current: WorkbookState, updated: WorkbookState, name: String): FunctionMutationResult {
        val previous = current.functions.single { it.name.equals(name, ignoreCase = true) }
        return FunctionMutationResult(updated, previous.identity, previous, null)
    }

    private fun applyFunctionWrite(current: WorkbookState, before: WorkbookState, declaration: CustomFunction, previousName: String?): WorkbookState {
            if (!sameWorkbookContent(current, before)) throw WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
            if (declaration.bodyBindings.isNotEmpty() || declaration.identity.isNotEmpty() || previousName != null && current.functions.none { it.name.equals(previousName, ignoreCase = true) }) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_FUNCTION)
            }
            val functions = functionAdmission.set(current, declaration, previousName)
                ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_FUNCTION)
            val previous = current.functions.find { it.name.equals(previousName, ignoreCase = true) }
            val identity = previous?.takeIf {
                it.identity.isNotEmpty() && it.hasSameBindingSource(declaration)
            }?.identity ?: java.util.UUID.randomUUID().toString()
            return current.copy(functions = functions.map { if (it.name.equals(declaration.name, ignoreCase = true)) it.copy(identity = identity) else it })
    }

    fun deleteFunction(before: WorkbookState, name: String): WorkbookState = store.updateFunction { current -> deleteResult(current, applyFunctionDelete(current, before, name), name) }

    private fun applyFunctionDelete(current: WorkbookState, before: WorkbookState, name: String): WorkbookState {
        if (!sameWorkbookContent(current, before)) throw WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
        if (current.functions.none { it.name.equals(name, ignoreCase = true) }) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_FUNCTION)
        return current.copy(functions = current.functions.filterNot { it.name.equals(name, ignoreCase = true) })
    }
}
