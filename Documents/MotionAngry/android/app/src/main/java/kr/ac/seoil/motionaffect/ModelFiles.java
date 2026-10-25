package kr.ac.seoil.motionaffect;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

/**
 * 모델 파일을 files/models/<name>에서 먼저 읽고, 없거나 손상되면 assets/<name>으로 돌아간다(설계 R4(c), Section 1 A2).
 * 재빌드 없이 `adb push`로 모델을 바꿀 수 있고, 손상 파일이 서비스를 죽이지 않는다. 결과는 events.csv type=model_load로 기록한다.
 */
final class ModelFiles {
    static final String DIR = "models";

    interface Loader<T> { T load(java.io.InputStream in) throws IOException; }

    static final class Result<T> {
        final T model;
        final String source;   // files | assets | none
        final String error;    // 파일 로드 실패 사유(없으면 "")
        Result(T model, String source, String error) { this.model = model; this.source = source; this.error = error; }
        String describe(String name) { return "name=" + name + ";source=" + source + (error.isEmpty() ? "" : ";error=" + error.replace(',', ' ').replace(';', ' ')); }
    }

    static <T> Result<T> load(Context ctx, String name, Loader<T> loader) {
        File f = new File(new File(ctx.getExternalFilesDir(null), DIR), name);
        String err = "";
        if (f.exists()) {
            try (FileInputStream in = new FileInputStream(f)) {
                return new Result<>(loader.load(in), "files", "");
            } catch (Exception e) {
                err = e.getClass().getSimpleName() + ":" + String.valueOf(e.getMessage());
            }
        }
        try (java.io.InputStream in = ctx.getAssets().open(name)) {
            return new Result<>(loader.load(in), "assets", err);
        } catch (Exception e) {
            return new Result<>(null, "none", err.isEmpty() ? e.getClass().getSimpleName() : err);
        }
    }
}
