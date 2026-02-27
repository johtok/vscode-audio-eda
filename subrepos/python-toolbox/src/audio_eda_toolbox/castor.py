from __future__ import annotations

import csv
import json
import math
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

SUPPORTED_TIMESERIES_EXTENSIONS = {".wav", ".csv", ".txt"}
SUPPORTED_SEGMENT_UNITS = {"samples", "seconds"}


@dataclass(frozen=True)
class SegmentSpec:
    source_file: Path
    start: float
    end: float
    unit: str


@dataclass
class CastorDataset:
    series: list[list[float]]
    labels: list[str]
    sources: list[str]
    sample_rates: list[int]
    class_labels: tuple[str, str]


def _parse_float(value: str) -> float | None:
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _load_numeric_series(path: Path) -> list[float]:
    values: list[float] = []
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                parsed_value = None
                for cell in row:
                    parsed_value = _parse_float(cell)
                    if parsed_value is not None:
                        break
                if parsed_value is not None:
                    values.append(parsed_value)
    else:
        text = path.read_text(encoding="utf-8")
        for token in text.replace(",", " ").split():
            parsed_value = _parse_float(token)
            if parsed_value is not None:
                values.append(parsed_value)
    if not values:
        raise ValueError(f"No numeric values found in {path}.")
    return values


def _decode_pcm_values(frames: bytes, sample_width: int) -> list[float]:
    if sample_width == 1:
        return [((byte - 128) / 128.0) for byte in frames]

    if sample_width == 2:
        values: list[float] = []
        scale = float(1 << 15)
        for index in range(0, len(frames), 2):
            raw = int.from_bytes(frames[index : index + 2], byteorder="little", signed=True)
            values.append(raw / scale)
        return values

    if sample_width == 3:
        values = []
        scale = float(1 << 23)
        for index in range(0, len(frames), 3):
            chunk = frames[index : index + 3]
            raw = int.from_bytes(chunk + (b"\x00" if chunk[2] < 0x80 else b"\xff"), "little", signed=True)
            values.append(raw / scale)
        return values

    if sample_width == 4:
        values = []
        scale = float(1 << 31)
        for index in range(0, len(frames), 4):
            raw = int.from_bytes(frames[index : index + 4], byteorder="little", signed=True)
            values.append(raw / scale)
        return values

    raise ValueError(f"Unsupported WAV sample width: {sample_width} bytes.")


def _load_wav_mono(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wave_file:
        channel_count = wave_file.getnchannels()
        sample_width = wave_file.getsampwidth()
        sample_rate = wave_file.getframerate()
        frame_count = wave_file.getnframes()
        frames = wave_file.readframes(frame_count)

    if channel_count <= 0:
        raise ValueError(f"Invalid channel count in {path}.")

    decoded = _decode_pcm_values(frames, sample_width)
    if not decoded:
        raise ValueError(f"Decoded audio is empty in {path}.")

    if channel_count == 1:
        return decoded, sample_rate

    mono: list[float] = []
    for frame_index in range(0, len(decoded), channel_count):
        frame = decoded[frame_index : frame_index + channel_count]
        if not frame:
            continue
        mono.append(sum(frame) / len(frame))
    return mono, sample_rate


def load_timeseries(path: Path) -> tuple[list[float], int]:
    extension = path.suffix.lower()
    if extension == ".wav":
        return _load_wav_mono(path)
    if extension in {".csv", ".txt"}:
        return _load_numeric_series(path), 1
    raise ValueError(
        f"Unsupported timeseries format for {path}. "
        f"Supported: {sorted(SUPPORTED_TIMESERIES_EXTENSIONS)}"
    )


def _scan_timeseries_files(folder: Path) -> list[Path]:
    files = [
        path
        for path in folder.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_TIMESERIES_EXTENSIONS
    ]
    return sorted(files)


def parse_segments_csv(path: Path, default_unit: str = "samples") -> list[SegmentSpec]:
    if default_unit not in SUPPORTED_SEGMENT_UNITS:
        raise ValueError(f"Unsupported segment unit: {default_unit}")

    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"Segments CSV has no header: {path}")

        normalized_fields = {field.strip().lower(): field for field in reader.fieldnames}
        file_column = normalized_fields.get("file") or normalized_fields.get("path")
        start_column = normalized_fields.get("start")
        end_column = normalized_fields.get("end")
        t_start_column = normalized_fields.get("t_start")
        t_end_column = normalized_fields.get("t_end")

        if not file_column:
            raise ValueError(f"Segments CSV must contain 'file' or 'path' column: {path}")
        if (start_column is None or end_column is None) and (
            t_start_column is None or t_end_column is None
        ):
            raise ValueError(
                f"Segments CSV must contain either start/end or t_start/t_end columns: {path}"
            )

        specs: list[SegmentSpec] = []
        for row_index, row in enumerate(reader, start=2):
            file_cell = (row.get(file_column) or "").strip()
            if not file_cell:
                continue

            if t_start_column is not None and t_end_column is not None:
                unit = "seconds"
                raw_start = row.get(t_start_column, "")
                raw_end = row.get(t_end_column, "")
            else:
                unit = default_unit
                raw_start = row.get(start_column or "", "")
                raw_end = row.get(end_column or "", "")

            start = _parse_float(raw_start)
            end = _parse_float(raw_end)
            if start is None or end is None:
                raise ValueError(f"Invalid segment bounds at {path}:{row_index}")
            if not math.isfinite(start) or not math.isfinite(end):
                raise ValueError(f"Non-finite segment bounds at {path}:{row_index}")
            if end <= start:
                continue

            specs.append(
                SegmentSpec(
                    source_file=Path(file_cell),
                    start=start,
                    end=end,
                    unit=unit,
                )
            )

    if not specs:
        raise ValueError(f"No usable segment rows found in {path}")
    return specs


def _slice_segment(values: Sequence[float], sample_rate: int, spec: SegmentSpec) -> list[float]:
    if spec.unit == "seconds":
        start_index = int(round(spec.start * sample_rate))
        end_index = int(round(spec.end * sample_rate))
    else:
        start_index = int(round(spec.start))
        end_index = int(round(spec.end))

    bounded_start = max(0, min(start_index, len(values)))
    bounded_end = max(bounded_start, min(end_index, len(values)))
    segment = list(values[bounded_start:bounded_end])
    return segment


def _collect_instances_for_class(
    class_dir: Path, label: str, segments_csv: Path | None, default_unit: str
) -> tuple[list[list[float]], list[str], list[int]]:
    if not class_dir.exists() or not class_dir.is_dir():
        raise ValueError(f"Class folder does not exist or is not a directory: {class_dir}")

    series: list[list[float]] = []
    sources: list[str] = []
    sample_rates: list[int] = []

    if segments_csv:
        specs = parse_segments_csv(segments_csv, default_unit=default_unit)
        loaded_cache: dict[Path, tuple[list[float], int]] = {}
        for spec in specs:
            source_path = spec.source_file
            if not source_path.is_absolute():
                source_path = class_dir / source_path
            source_path = source_path.resolve()
            if source_path not in loaded_cache:
                loaded_cache[source_path] = load_timeseries(source_path)
            values, sample_rate = loaded_cache[source_path]
            segment = _slice_segment(values, sample_rate, spec)
            if not segment:
                continue
            series.append(segment)
            sources.append(str(source_path))
            sample_rates.append(sample_rate)
    else:
        files = _scan_timeseries_files(class_dir)
        if not files:
            raise ValueError(f"No supported timeseries files in {class_dir}")
        for file_path in files:
            values, sample_rate = load_timeseries(file_path)
            if not values:
                continue
            series.append(list(values))
            sources.append(str(file_path))
            sample_rates.append(sample_rate)

    if not series:
        raise ValueError(f"No usable instances found for class '{label}' in {class_dir}")

    return series, sources, sample_rates


def prepare_two_class_dataset(
    class_a_dir: Path,
    class_b_dir: Path,
    *,
    segments_a: Path | None = None,
    segments_b: Path | None = None,
    segments_unit: str = "samples",
) -> CastorDataset:
    class_a_label = class_a_dir.name or "class_a"
    class_b_label = class_b_dir.name or "class_b"

    class_a_series, class_a_sources, class_a_rates = _collect_instances_for_class(
        class_a_dir, class_a_label, segments_a, segments_unit
    )
    class_b_series, class_b_sources, class_b_rates = _collect_instances_for_class(
        class_b_dir, class_b_label, segments_b, segments_unit
    )

    series = class_a_series + class_b_series
    labels = [class_a_label] * len(class_a_series) + [class_b_label] * len(class_b_series)
    sources = class_a_sources + class_b_sources
    sample_rates = class_a_rates + class_b_rates
    return CastorDataset(
        series=series,
        labels=labels,
        sources=sources,
        sample_rates=sample_rates,
        class_labels=(class_a_label, class_b_label),
    )


def _z_normalize(values: list[float]) -> list[float]:
    if not values:
        return values
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    if variance <= 1e-12:
        return [0.0 for _ in values]
    std = math.sqrt(variance)
    return [(value - mean) / std for value in values]


def _pad_or_trim(values: Sequence[float], length: int, pad_value: float) -> list[float]:
    output = list(values[:length])
    if len(output) < length:
        output.extend([pad_value] * (length - len(output)))
    return output


def _mean_vector(vectors: Sequence[Sequence[float]]) -> list[float]:
    if not vectors:
        raise ValueError("Cannot build prototype from an empty class.")
    length = len(vectors[0])
    out = [0.0] * length
    for vector in vectors:
        if len(vector) != length:
            raise ValueError("Prototype vectors must have equal length.")
        for index, value in enumerate(vector):
            out[index] += value
    count = float(len(vectors))
    return [value / count for value in out]


def _euclidean_distance(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        raise ValueError("Distance vectors must have equal length.")
    return math.sqrt(sum((l - r) ** 2 for l, r in zip(left, right)))


class CastorPrototypeClassifier:
    """CASTOR-style prototype classifier baseline for fixed-length timeseries."""

    def __init__(
        self,
        *,
        pad_length: int | None = None,
        pad_value: float = 0.0,
        normalize: bool = True,
    ) -> None:
        self.pad_length = pad_length
        self.pad_value = pad_value
        self.normalize = normalize
        self.pad_length_: int | None = None
        self.prototypes_: dict[str, list[float]] = {}

    def _prepare_vector(self, values: Sequence[float]) -> list[float]:
        if self.pad_length_ is None:
            raise RuntimeError("Model is not fitted.")
        vector = _pad_or_trim(values, self.pad_length_, self.pad_value)
        if self.normalize:
            vector = _z_normalize(vector)
        return vector

    def fit(self, series: Sequence[Sequence[float]], labels: Sequence[str]) -> "CastorPrototypeClassifier":
        if len(series) != len(labels):
            raise ValueError("Series and labels must have equal length.")
        if not series:
            raise ValueError("Cannot fit on empty dataset.")

        inferred_pad_length = max(len(sample) for sample in series)
        if inferred_pad_length <= 0:
            raise ValueError("All samples are empty.")
        if self.pad_length is None:
            self.pad_length_ = inferred_pad_length
        else:
            if self.pad_length <= 0:
                raise ValueError("pad_length must be > 0.")
            self.pad_length_ = self.pad_length

        grouped: dict[str, list[list[float]]] = {}
        for sample, label in zip(series, labels):
            prepared = self._prepare_vector(sample)
            grouped.setdefault(str(label), []).append(prepared)

        if len(grouped) != 2:
            raise ValueError("CASTOR prototype currently expects exactly 2 classes.")

        self.prototypes_ = {
            class_label: _mean_vector(vectors)
            for class_label, vectors in grouped.items()
        }
        return self

    def predict_one(self, sample: Sequence[float]) -> str:
        if not self.prototypes_:
            raise RuntimeError("Model is not fitted.")
        prepared = self._prepare_vector(sample)
        best_label = ""
        best_distance = float("inf")
        for class_label, prototype in self.prototypes_.items():
            distance = _euclidean_distance(prepared, prototype)
            if distance < best_distance:
                best_distance = distance
                best_label = class_label
        return best_label

    def predict(self, series: Iterable[Sequence[float]]) -> list[str]:
        return [self.predict_one(sample) for sample in series]

    def score(self, series: Sequence[Sequence[float]], labels: Sequence[str]) -> float:
        if not series:
            return 0.0
        predictions = self.predict(series)
        correct = sum(1 for expected, predicted in zip(labels, predictions) if expected == predicted)
        return correct / len(series)


def _build_confusion_matrix(
    expected: Sequence[str], predicted: Sequence[str], class_labels: Sequence[str]
) -> dict[str, dict[str, int]]:
    matrix = {truth: {pred: 0 for pred in class_labels} for truth in class_labels}
    for truth, pred in zip(expected, predicted):
        if truth not in matrix:
            continue
        if pred not in matrix[truth]:
            matrix[truth][pred] = 0
        matrix[truth][pred] += 1
    return matrix


def run_castor_prototype(
    class_a_dir: Path,
    class_b_dir: Path,
    *,
    segments_a: Path | None = None,
    segments_b: Path | None = None,
    segments_unit: str = "samples",
    pad_length: int | None = None,
    pad_value: float = 0.0,
    normalize: bool = True,
) -> dict[str, object]:
    dataset = prepare_two_class_dataset(
        class_a_dir=class_a_dir,
        class_b_dir=class_b_dir,
        segments_a=segments_a,
        segments_b=segments_b,
        segments_unit=segments_unit,
    )
    model = CastorPrototypeClassifier(
        pad_length=pad_length,
        pad_value=pad_value,
        normalize=normalize,
    ).fit(dataset.series, dataset.labels)

    predictions = model.predict(dataset.series)
    confusion = _build_confusion_matrix(dataset.labels, predictions, dataset.class_labels)
    training_accuracy = model.score(dataset.series, dataset.labels)
    lengths = [len(sample) for sample in dataset.series]
    sample_rate_values = [rate for rate in dataset.sample_rates if rate > 0]
    avg_rate = sum(sample_rate_values) / len(sample_rate_values) if sample_rate_values else 0

    return {
        "command": "castor-prototype",
        "class_labels": list(dataset.class_labels),
        "instance_count": len(dataset.series),
        "class_counts": {
            dataset.class_labels[0]: dataset.labels.count(dataset.class_labels[0]),
            dataset.class_labels[1]: dataset.labels.count(dataset.class_labels[1]),
        },
        "pad_length": model.pad_length_,
        "pad_value": pad_value,
        "normalize": normalize,
        "segments": {
            "class_a": str(segments_a) if segments_a else None,
            "class_b": str(segments_b) if segments_b else None,
            "unit": segments_unit,
        },
        "length_stats": {
            "min": min(lengths),
            "max": max(lengths),
            "mean": sum(lengths) / len(lengths),
        },
        "average_sample_rate": avg_rate,
        "training_accuracy": training_accuracy,
        "confusion_matrix": confusion,
        "prototype_preview": {
            label: [round(value, 6) for value in vector[:8]]
            for label, vector in model.prototypes_.items()
        },
    }


def run_castor_prototype_json(
    class_a_dir: Path,
    class_b_dir: Path,
    *,
    segments_a: Path | None = None,
    segments_b: Path | None = None,
    segments_unit: str = "samples",
    pad_length: int | None = None,
    pad_value: float = 0.0,
    normalize: bool = True,
) -> str:
    payload = run_castor_prototype(
        class_a_dir=class_a_dir,
        class_b_dir=class_b_dir,
        segments_a=segments_a,
        segments_b=segments_b,
        segments_unit=segments_unit,
        pad_length=pad_length,
        pad_value=pad_value,
        normalize=normalize,
    )
    return json.dumps(payload)
