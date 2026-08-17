package com.agri.video.collector.base

import android.content.Context
import android.content.SharedPreferences
import kotlin.math.floor

object BaseConnectivityStateStore {
    const val DEFAULT_THRESHOLD_SECONDS = 15
    private const val RECONNECT_AFTER_SECONDS = 6
    private const val STORAGE_NAME = "autojs.localstorage.AgriVideoCollectorBaseConnection"

    data class State(
        val status: String,
        val elapsedSeconds: Int,
        val offlineThresholdSeconds: Int,
    )

    private fun preferences(context: Context) =
        context.getSharedPreferences(STORAGE_NAME, Context.MODE_PRIVATE)

    fun markStarted(context: Context) {
        val now = System.currentTimeMillis()
        preferences(context).edit()
            .putString("startedAt", now.toString())
            .putString("lastResult", jsonString("connecting"))
            .apply()
    }

    fun markAttempt(context: Context) {
        preferences(context).edit()
            .putString("lastAttemptAt", System.currentTimeMillis().toString())
            .apply()
    }

    fun markSuccess(context: Context, result: BaseConnectivityClient.Result) {
        val now = System.currentTimeMillis()
        val threshold = result.offlineThresholdSeconds.coerceIn(15, 150)
        preferences(context).edit()
            .putString("lastSuccessAt", now.toString())
            .putString("lastReceivedAt", jsonString(result.receivedAt.orEmpty()))
            .putString("lastResult", jsonString("success"))
            .putString("httpStatus", result.httpStatus.toString())
            .putString("failureKind", jsonString(""))
            .putString("offlineThresholdSeconds", threshold.toString())
            .apply()
    }

    fun markFailure(context: Context, result: BaseConnectivityClient.Result) {
        preferences(context).edit()
            .putString("lastFailureAt", System.currentTimeMillis().toString())
            .putString("lastResult", jsonString("failure"))
            .putString("httpStatus", result.httpStatus.toString())
            .putString("failureKind", jsonString(result.failureKind))
            .apply()
    }

    fun current(context: Context, now: Long = System.currentTimeMillis()): State {
        val preferences = preferences(context)
        val lastSuccessAt = storedLong(preferences, "lastSuccessAt", 0L)
        val startedAt = storedLong(preferences, "startedAt", now)
        val threshold = storedLong(
            preferences,
            "offlineThresholdSeconds",
            DEFAULT_THRESHOLD_SECONDS.toLong(),
        ).toInt().coerceIn(15, 150)
        val referenceAt = maxOf(lastSuccessAt, startedAt)
        val elapsedSeconds = floor((now - referenceAt).coerceAtLeast(0L) / 1000.0).toInt()
        val status = when {
            lastSuccessAt >= startedAt && elapsedSeconds <= RECONNECT_AFTER_SECONDS -> "ONLINE"
            elapsedSeconds < threshold -> "RECONNECTING"
            else -> "OFFLINE"
        }
        return State(status, elapsedSeconds, threshold)
    }

    private fun storedLong(preferences: SharedPreferences, key: String, defaultValue: Long): Long {
        val value = preferences.all[key] ?: return defaultValue
        return when (value) {
            is Number -> value.toLong()
            is String -> value.trim().removeSurrounding("\"").toLongOrNull() ?: defaultValue
            else -> defaultValue
        }
    }

    private fun jsonString(value: String): String = buildString {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(character)
            }
        }
        append('"')
    }
}
