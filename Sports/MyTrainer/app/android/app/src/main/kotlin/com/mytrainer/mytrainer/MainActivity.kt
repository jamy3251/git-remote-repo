package com.mytrainer.mytrainer

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "mytrainer/geofence")
            .setMethodCallHandler { call, result ->
                val ctx = applicationContext
                when (call.method) {
                    "register" -> {
                        val lat = call.argument<Double>("lat")
                        val lng = call.argument<Double>("lng")
                        val radius = call.argument<Double>("radius")
                        if (lat == null || lng == null || radius == null) {
                            result.error("bad_args", "lat/lng/radius 가 필요해요", null)
                        } else {
                            GeofenceRegistrar.register(ctx, lat, lng, radius.toFloat()) { ok, msg ->
                                if (ok) result.success(true) else result.error("register_failed", msg, null)
                            }
                        }
                    }
                    "unregister" -> {
                        GeofenceRegistrar.unregister(ctx)
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "mytrainer/embedder")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "embed" -> {
                        val path = call.argument<String>("path")
                        if (path == null) {
                            result.error("bad_args", "path 가 필요해요", null)
                        } else {
                            MachineEmbedder.embed(applicationContext, path) { vector, error ->
                                runOnUiThread {
                                    if (vector != null) result.success(vector) else result.error("embed_failed", error, null)
                                }
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
