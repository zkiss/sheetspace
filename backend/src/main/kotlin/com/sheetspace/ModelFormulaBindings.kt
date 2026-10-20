package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class ModelFormulaSpan(val start: Int, val end: Int)

@Serializable
data class ModelFormulaAnchors(val row: Boolean, val column: Boolean)

@Serializable
data class ModelFormulaEndpoint(
    val sourceSpan: ModelFormulaSpan,
    val columnId: String,
    val rowIndex: Double,
    val anchors: ModelFormulaAnchors,
    val propertyId: String? = null,
)

@Serializable
data class ModelFormulaReference(
    val sourceSpan: ModelFormulaSpan,
    val sheetId: String? = null,
    val qualifierSpan: ModelFormulaSpan? = null,
    val endpoints: List<ModelFormulaEndpoint?>,
)

@Serializable
data class BoundModelFormula(val raw: String, val references: List<ModelFormulaReference>)
