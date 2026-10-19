package com.sheetspace

import java.nio.ByteBuffer
import java.util.UUID

internal fun String.toUuidBytes(): ByteArray {
    val uuid = UUID.fromString(this)
    return ByteBuffer.allocate(16)
        .putLong(uuid.mostSignificantBits)
        .putLong(uuid.leastSignificantBits)
        .array()
}

internal fun String.toUuidBytesOrNull(): ByteArray? =
    runCatching { toUuidBytes() }.getOrNull()

/**
 * IDs are stored as UUID bytes, so differently cased spellings identify the same durable value.
 * Check uniqueness before collection operations such as associate can discard an entry.
 */
internal fun Iterable<String>.hasDistinctUuidIdentities(): Boolean {
    val identities = map { value -> runCatching { UUID.fromString(value) }.getOrNull() ?: return false }
    return identities.distinct().size == identities.size
}

internal fun ByteArray.toUuidString(): String {
    require(size == 16) { "Stored id must be exactly 16 bytes" }
    val bytes = ByteBuffer.wrap(this)
    return UUID(bytes.long, bytes.long).toString()
}
