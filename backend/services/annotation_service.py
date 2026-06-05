import os
import uuid

from models.annotation import Annotation

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
ANNOTATIONS_FILE = os.path.join(DATA_DIR, "annotations.jsonl")


def _ensure_file() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(ANNOTATIONS_FILE):
        with open(ANNOTATIONS_FILE, "w") as f:
            f.write("")


def _load_all() -> list[Annotation]:
    _ensure_file()
    annotations: list[Annotation] = []
    try:
        with open(ANNOTATIONS_FILE) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        annotations.append(Annotation.model_validate_json(line))
                    except Exception:
                        continue
    except Exception:
        pass
    return annotations


def _save_all(annotations: list[Annotation]) -> None:
    _ensure_file()
    with open(ANNOTATIONS_FILE, "w") as f:
        for a in annotations:
            f.write(a.model_dump_json() + "\n")


def get_annotations(trace_id: str) -> list[Annotation]:
    return [a for a in _load_all() if a.trace_id == trace_id]


def create_annotation(trace_id: str, content: str, tags: list[str] | None = None,
                      rating: int | None = None, author: str = "human") -> Annotation:
    annotation = Annotation(
        id=uuid.uuid4().hex[:12],
        trace_id=trace_id,
        content=content,
        tags=tags or [],
        rating=rating,
        author=author,
    )
    all_annotations = _load_all()
    all_annotations.append(annotation)
    _save_all(all_annotations)
    return annotation


def delete_annotation(annotation_id: str) -> bool:
    all_annotations = _load_all()
    filtered = [a for a in all_annotations if a.id != annotation_id]
    if len(filtered) == len(all_annotations):
        return False
    _save_all(filtered)
    return True
