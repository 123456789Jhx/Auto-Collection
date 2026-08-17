package com.agri.video.collector.base

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager

enum class ScreenState(val wireValue: String) {
    LOCKED("locked"),
    UNLOCKED("unlocked"),
    UNKNOWN("unknown"),
}

class ScreenStateDetector(private val context: Context) {
    fun detect(): ScreenState = try {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return ScreenState.UNKNOWN
        if (!powerManager.isInteractive) return ScreenState.LOCKED
        val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            ?: return ScreenState.UNKNOWN
        if (keyguardManager.isKeyguardLocked) ScreenState.LOCKED else ScreenState.UNLOCKED
    } catch (_: Throwable) {
        ScreenState.UNKNOWN
    }
}
