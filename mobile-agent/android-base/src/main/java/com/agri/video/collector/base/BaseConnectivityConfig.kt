package com.agri.video.collector.base

import android.content.Context
import org.json.JSONObject

data class BaseConnectivityConfig(
    val apiBaseUrl: String,
    val requestTimeoutMs: Long,
) {
    companion object {
        fun load(context: Context): BaseConnectivityConfig? = runCatching {
            val text = context.assets.open("project/base-connectivity.json")
                .bufferedReader(Charsets.UTF_8)
                .use { it.readText() }
            val json = JSONObject(text)
            BaseConnectivityConfig(
                apiBaseUrl = json.getString("apiBaseUrl").trim().trimEnd('/'),
                requestTimeoutMs = json.optLong("requestTimeoutMs", 5_000L).coerceIn(1_000L, 30_000L),
            )
        }.getOrNull()
    }
}
