package com.agri.video.collector.base

import android.content.Context
import org.autojs.autojs.core.automator.GlobalActionAutomator
import org.autojs.autojs.inrt.autojs.AutoJs

class ScreenLockController(private val context: Context) {
    enum class Result { LOCKED, ALREADY_LOCKED, LOCK_FAILED }

    fun lock(): Result {
        if (ScreenStateDetector(context).detect() == ScreenState.LOCKED) return Result.ALREADY_LOCKED
        return try {
            val accessibilityBridge = AutoJs.instance.createAccessibilityBridge()
            accessibilityBridge.ensureServiceStarted()
            val service = accessibilityBridge.service ?: return Result.LOCK_FAILED
            val requested = GlobalActionAutomator(context.applicationContext, null) { service }.lockScreen()
            if (!requested) return Result.LOCK_FAILED
            if (waitUntilLocked()) Result.LOCKED else Result.LOCK_FAILED
        } catch (_: Throwable) {
            Result.LOCK_FAILED
        }
    }

    private fun waitUntilLocked(): Boolean {
        val deadline = System.currentTimeMillis() + LOCK_CONFIRM_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (ScreenStateDetector(context).detect() == ScreenState.LOCKED) return true
            Thread.sleep(LOCK_CONFIRM_POLL_MS)
        }
        return false
    }

    companion object {
        private const val LOCK_CONFIRM_TIMEOUT_MS = 5_000L
        private const val LOCK_CONFIRM_POLL_MS = 100L
    }
}
