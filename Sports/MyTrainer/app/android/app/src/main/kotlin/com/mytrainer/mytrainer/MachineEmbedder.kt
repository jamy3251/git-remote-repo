package com.mytrainer.mytrainer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.imageembedder.ImageEmbedder
import io.flutter.FlutterInjector
import java.util.concurrent.Executors

/**
 * 기구 사진 → 1024차원 임베딩(MediaPipe Image Embedder, mobilenet_v3_small float32).
 *
 * 모델 파일은 Flutter 에셋(assets/models)에 있다. PC 정확도 하네스(tool/accuracy)도
 * 같은 파일·같은 옵션(l2_normalize, quantize 끔)을 써서 결과가 같다.
 * 사진은 긴 변 640px 로 줄이고 EXIF 회전을 적용한 뒤 넣는다(하네스도 동일).
 */
object MachineEmbedder {
    private const val MODEL = "assets/models/mobilenet_v3_small.tflite"
    private const val MAX_SIDE = 640

    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var embedder: ImageEmbedder? = null

    private fun get(ctx: Context): ImageEmbedder =
        embedder ?: synchronized(this) {
            embedder ?: run {
                val key = FlutterInjector.instance().flutterLoader().getLookupKeyForAsset(MODEL)
                val options = ImageEmbedder.ImageEmbedderOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath(key).build())
                    .setL2Normalize(true)
                    .setQuantize(false)
                    .build()
                ImageEmbedder.createFromOptions(ctx, options).also { embedder = it }
            }
        }

    fun embed(ctx: Context, path: String, done: (List<Double>?, String?) -> Unit) {
        worker.execute {
            try {
                val bitmap = load(path) ?: return@execute done(null, "사진을 열 수 없어요: $path")
                val image = BitmapImageBuilder(bitmap).build()
                val result = get(ctx).embed(image)
                val floats = result.embeddingResult().embeddings()[0].floatEmbedding()
                done(floats.map { it.toDouble() }, null)
            } catch (e: Exception) {
                done(null, e.message ?: e.toString())
            }
        }
    }

    private fun load(path: String): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        val longSide = maxOf(bounds.outWidth, bounds.outHeight)
        if (longSide <= 0) return null
        var sample = 1
        while (longSide / (sample * 2) >= MAX_SIDE) sample *= 2
        val decoded = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: return null

        val scale = MAX_SIDE.toFloat() / maxOf(decoded.width, decoded.height)
        val m = Matrix()
        if (scale < 1f) m.postScale(scale, scale)
        val degrees = when (ExifInterface(path).getAttributeInt(
            ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        if (degrees != 0f) m.postRotate(degrees)
        if (m.isIdentity) return decoded
        return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
    }
}
