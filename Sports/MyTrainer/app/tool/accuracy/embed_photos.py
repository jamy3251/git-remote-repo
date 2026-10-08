"""기구 사진 → 임베딩 JSON (정확도 하네스 1단계).

앱(Kotlin MachineEmbedder)과 같은 모델 파일·같은 옵션으로 벡터를 만든다.
  - EXIF 회전 적용 → 긴 변 640px 로 축소 → MediaPipe ImageEmbedder(l2_normalize, quantize 끔)

사진 폴더 구조(설계 D15: 성공 판단은 holdout 만):
  photos/register/<기구>/*.jpg   등록 사진(기구당 2~3장, 앱에서 등록하듯이)
  photos/tune/<기구>/*.jpg       임계값을 정할 때 쓰는 찾기 사진
  photos/holdout/<기구>/*.jpg    다른 날·다른 폰·다른 친구가 찍은 찾기 사진

실행:
  python -m pip install --user mediapipe==0.10.14 pillow
  python tool/accuracy/embed_photos.py tool/accuracy/photos tool/accuracy/embeddings.json
"""

import json
import sys
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image, ImageOps

# lib/machines/embedder.dart 의 MediaPipeEmbedder.id 와 같아야 한다.
MODEL_ID = "mp-mobilenet_v3_small-f32-v1-bbbb4c51"
MODEL = Path(__file__).resolve().parents[2] / "assets" / "models" / "mobilenet_v3_small.tflite"
MAX_SIDE = 640
SPLITS = ("register", "tune", "holdout")
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def load(path: Path) -> np.ndarray:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    scale = MAX_SIDE / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.BILINEAR)
    return np.asarray(img)


def main(root: Path, out: Path) -> None:
    options = vision.ImageEmbedderOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL)),
        l2_normalize=True,
        quantize=False,
    )
    items = []
    with vision.ImageEmbedder.create_from_options(options) as embedder:
        for split in SPLITS:
            for machine_dir in sorted((root / split).glob("*")):
                if not machine_dir.is_dir():
                    continue
                for f in sorted(machine_dir.iterdir()):
                    if f.suffix.lower() not in EXTS:
                        continue
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=load(f))
                    vector = embedder.embed(image).embeddings[0].embedding
                    items.append({
                        "split": split,
                        "machine": machine_dir.name,
                        "file": str(f.relative_to(root)).replace("\\", "/"),
                        "vector": [round(float(x), 6) for x in vector],
                    })
    out.write_text(json.dumps({"modelId": MODEL_ID, "items": items}, ensure_ascii=False), encoding="utf-8")
    counts = {s: sum(1 for i in items if i["split"] == s) for s in SPLITS}
    print(f"{out}: {counts}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
