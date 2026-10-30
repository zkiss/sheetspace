package com.sheetspace

import kotlinx.serialization.Serializable

/** One expression and its retained reference provenance. */
@Serializable
data class BoundModelFormula(val content: String)
