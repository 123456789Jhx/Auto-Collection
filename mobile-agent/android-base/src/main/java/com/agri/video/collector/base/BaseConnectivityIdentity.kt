package com.agri.video.collector.base

import android.content.Context

data class BaseConnectivityIdentity(val deviceId: String, val deviceToken: String) {
    companion object {
        fun load(context: Context): BaseConnectivityIdentity? {
            val preferences = context.getSharedPreferences(
                BaseConnectivityProtocol.DEVICE_STORAGE_NAME,
                Context.MODE_PRIVATE,
            )
            val deviceId = BaseConnectivityProtocol.decodeStoredString(
                preferences.getString(BaseConnectivityProtocol.DEVICE_ID_KEY, ""),
            )
            val deviceToken = BaseConnectivityProtocol.decodeStoredString(
                preferences.getString(BaseConnectivityProtocol.DEVICE_TOKEN_KEY, ""),
            )
            if (deviceId.isBlank() || deviceToken.isBlank()) return null
            return BaseConnectivityIdentity(deviceId, deviceToken)
        }
    }
}
