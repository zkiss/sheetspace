package com.sheetspace

import org.flywaydb.core.Flyway
import java.sql.Connection
import java.sql.DriverManager

/** Owns SQLite migration, connection configuration, transaction mechanics, and keep-alive lifecycle. */
internal class SqliteDatabase(
    private val jdbcUrl: String,
    private val keepAliveConnection: Connection?,
) : AutoCloseable {
    init {
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .load()
            .migrate()
    }

    override fun close() {
        keepAliveConnection?.close()
    }

    fun <T> transaction(block: (Connection) -> T): T = connection { conn ->
        conn.autoCommit = false
        try {
            val result = block(conn)
            conn.commit()
            result
        } catch (exception: Exception) {
            conn.rollback()
            throw exception
        } finally {
            conn.autoCommit = true
        }
    }

    fun <T> immediateTransaction(block: (Connection) -> T): T = connection { conn ->
        conn.createStatement().use { it.execute("BEGIN IMMEDIATE") }
        try {
            val result = block(conn)
            conn.createStatement().use { it.execute("COMMIT") }
            result
        } catch (exception: Exception) {
            conn.createStatement().use { it.execute("ROLLBACK") }
            throw exception
        }
    }

    fun <T> connection(block: (Connection) -> T): T =
        DriverManager.getConnection(jdbcUrl).use { conn ->
            conn.createStatement().use {
                it.execute("PRAGMA foreign_keys = ON")
                it.execute("PRAGMA busy_timeout = 5000")
            }
            block(conn)
        }
}
