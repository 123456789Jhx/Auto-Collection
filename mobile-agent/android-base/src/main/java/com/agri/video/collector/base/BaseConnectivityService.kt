package com.agri.video.collector.base

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.util.Log
import okhttp3.OkHttpClient
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class BaseConnectivityService : Service() {
    @Volatile
    private var heartbeatExecutor: ScheduledExecutorService? = null
    private var controlExecutor: ScheduledExecutorService? = null
    private var sharedHttpClient: OkHttpClient? = null
    private var connectivityManager: ConnectivityManager? = null
    private val serviceStopping = AtomicBoolean(false)
    private val networkCallbackRegistered = AtomicBoolean(false)
    private val immediateHeartbeatQueued = AtomicBoolean(false)
    private val validatedNetworks = ConcurrentHashMap.newKeySet<Network>()
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                if (validatedNetworks.add(network)) queueImmediateHeartbeat()
            } else {
                validatedNetworks.remove(network)
            }
        }

        override fun onLost(network: Network) {
            validatedNetworks.remove(network)
        }
    }

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, notification())
        BaseConnectivityStateStore.markStarted(this)
        startHeartbeatLoop()
        startControlLoop()
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (heartbeatExecutor?.isShutdown != false) startHeartbeatLoop()
        if (controlExecutor?.isShutdown != false) startControlLoop()
        return START_STICKY
    }

    override fun onDestroy() {
        serviceStopping.set(true)
        unregisterNetworkCallback()
        heartbeatExecutor?.shutdownNow()
        heartbeatExecutor = null
        controlExecutor?.shutdownNow()
        controlExecutor = null
        closeHttpResources()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startHeartbeatLoop() {
        if (heartbeatExecutor?.isShutdown == false) return
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor().also { scheduler ->
            scheduler.scheduleWithFixedDelay(
                { runCatching { reportSafely() }.onFailure { Log.w(TAG, "Heartbeat attempt failed", it) } },
                0L,
                HEARTBEAT_INTERVAL_MS,
                TimeUnit.MILLISECONDS,
            )
        }
    }

    private fun startControlLoop() {
        if (controlExecutor?.isShutdown == false) return
        val config = BaseConnectivityConfig.load(this) ?: return
        val httpClient = getOrCreateHttpClient(config) ?: return
        val runtime = BaseControlRuntime(this, httpClient)
        controlExecutor = Executors.newSingleThreadScheduledExecutor().also { scheduler ->
            scheduler.scheduleWithFixedDelay(
                { runCatching { runtime.runOnce() } },
                0L,
                CONTROL_POLL_INTERVAL_MS,
                TimeUnit.MILLISECONDS,
            )
        }
    }

    private fun reportSafely() {
        val config = BaseConnectivityConfig.load(this)
        val identity = BaseConnectivityIdentity.load(this)
        if (config == null || identity == null) {
            BaseConnectivityStateStore.markFailure(
                this,
                BaseConnectivityClient.Result(false, failureKind = "identity"),
            )
            return
        }
        BaseConnectivityStateStore.markAttempt(this)
        val screenState = ScreenStateDetector(this).detect()
        val appUiState = AppUiStateDetector(this).detect()
        val httpClient = getOrCreateHttpClient(config) ?: return
        val result = BaseConnectivityClient(httpClient, identity).report(config, screenState, appUiState)
        if (result.success) BaseConnectivityStateStore.markSuccess(this, result)
        else BaseConnectivityStateStore.markFailure(this, result)
    }

    @Synchronized
    private fun getOrCreateHttpClient(config: BaseConnectivityConfig): OkHttpClient? {
        if (serviceStopping.get()) return null
        sharedHttpClient?.let { return it }
        return OkHttpClient.Builder()
            .callTimeout(config.requestTimeoutMs, TimeUnit.MILLISECONDS)
            .connectTimeout(config.requestTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(config.requestTimeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(config.requestTimeoutMs, TimeUnit.MILLISECONDS)
            .build()
            .also { sharedHttpClient = it }
    }

    private fun registerNetworkCallback() {
        if (networkCallbackRegistered.get()) return
        val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                manager.registerDefaultNetworkCallback(networkCallback)
            } else {
                val request = NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build()
                manager.registerNetworkCallback(request, networkCallback)
            }
            connectivityManager = manager
            networkCallbackRegistered.set(true)
        } catch (error: Throwable) {
            Log.w(TAG, "Unable to observe validated network changes", error)
        }
    }

    private fun unregisterNetworkCallback() {
        if (!networkCallbackRegistered.compareAndSet(true, false)) return
        try {
            connectivityManager?.unregisterNetworkCallback(networkCallback)
        } catch (error: Throwable) {
            Log.w(TAG, "Unable to stop observing network changes", error)
        } finally {
            connectivityManager = null
            validatedNetworks.clear()
        }
    }

    private fun queueImmediateHeartbeat() {
        if (serviceStopping.get()) return
        val scheduler = heartbeatExecutor ?: return
        if (scheduler.isShutdown || !immediateHeartbeatQueued.compareAndSet(false, true)) return
        try {
            scheduler.execute {
                try {
                    reportSafely()
                } finally {
                    immediateHeartbeatQueued.set(false)
                }
            }
        } catch (_: RejectedExecutionException) {
            immediateHeartbeatQueued.set(false)
        }
    }

    private fun closeHttpResources() {
        val client = synchronized(this) {
            sharedHttpClient.also { sharedHttpClient = null }
        } ?: return
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
        runCatching { client.cache?.close() }
        client.dispatcher.executorService.shutdown()
    }

    private fun notification(): Notification {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "底座连接", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        return builder
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("燎原星火底座连接正在运行")
            .setContentText("正在保持设备与管理后台连接")
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "BaseConnectivityService"
        private const val CHANNEL_ID = "agri_base_connectivity"
        private const val NOTIFICATION_ID = 0xBACE
        private const val HEARTBEAT_INTERVAL_MS = 2_000L
        private const val CONTROL_POLL_INTERVAL_MS = 2_000L

        fun start(context: Context) {
            val intent = Intent(context, BaseConnectivityService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (error: Throwable) {
                Log.e(TAG, "Unable to start base connectivity service", error)
            }
        }
    }
}
