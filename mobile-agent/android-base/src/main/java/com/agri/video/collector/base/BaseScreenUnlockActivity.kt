package com.agri.video.collector.base

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.WindowManager
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BaseScreenUnlockActivity : Activity() {
    private var requestId: String? = null
    private var unlockSucceeded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestId = intent.getStringExtra(EXTRA_REQUEST_ID)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            )
        }
        wakeScreen()
        dismissKeyguard()
    }

    private fun wakeScreen() {
        val powerManager = getSystemService(POWER_SERVICE) as? PowerManager ?: return
        @Suppress("DEPRECATION")
        powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "$packageName:base-unlock",
        ).apply { acquire(WAKE_LOCK_TIMEOUT_MS) }
    }

    private fun dismissKeyguard() {
        val keyguardManager = getSystemService(KEYGUARD_SERVICE) as? KeyguardManager
        if (keyguardManager == null || !keyguardManager.isKeyguardLocked) {
            complete(true)
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            keyguardManager.newKeyguardLock("base-unlock").disableKeyguard()
            complete(true)
            return
        }
        keyguardManager.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() = complete(true)
            override fun onDismissCancelled() = complete(false)
            override fun onDismissError() = complete(false)
        })
    }

    private fun complete(success: Boolean) {
        unlockSucceeded = success
        finish()
    }

    override fun onDestroy() {
        requestId?.let { id -> pending[id]?.complete(unlockSucceeded) }
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_REQUEST_ID = "base_unlock_request_id"
        private const val UNLOCK_TIMEOUT_SECONDS = 8L
        private const val WAKE_LOCK_TIMEOUT_MS = 10_000L
        private val pending = ConcurrentHashMap<String, UnlockRequest>()

        fun unlock(context: Context): Boolean {
            if (ScreenStateDetector(context).detect() != ScreenState.LOCKED) return true
            val requestId = UUID.randomUUID().toString()
            val request = UnlockRequest()
            pending[requestId] = request
            return try {
                context.startActivity(
                    Intent(context, BaseScreenUnlockActivity::class.java)
                        .putExtra(EXTRA_REQUEST_ID, requestId)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
                )
                request.await()
            } catch (_: Throwable) {
                false
            } finally {
                pending.remove(requestId)
            }
        }
    }

    private class UnlockRequest {
        private val latch = CountDownLatch(1)
        @Volatile private var success = false

        fun complete(value: Boolean) {
            success = value
            latch.countDown()
        }

        fun await(): Boolean = latch.await(UNLOCK_TIMEOUT_SECONDS, TimeUnit.SECONDS) && success
    }
}
