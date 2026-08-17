package com.agri.video.collector.base

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BaseConnectivityBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in START_ACTIONS) BaseConnectivityService.start(context)
    }

    companion object {
        private val START_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_USER_UNLOCKED,
        )
    }
}
