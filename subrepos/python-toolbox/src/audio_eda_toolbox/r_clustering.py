from __future__ import annotations

import csv
import math
import random
import statistics
from pathlib import Path
from typing import Sequence


def _parse_float(text: str) -> float | None:
    candidate = text.strip()
    if not candidate:
        return None
    try:
        return float(candidate)
    except ValueError:
        return None


def _is_header_row(row: Sequence[str]) -> bool:
    if not row:
        return False
    numeric_count = 0
    for cell in row:
        if _parse_float(cell) is not None:
            numeric_count += 1
    return numeric_count < len(row)


def load_feature_matrix_csv(path: Path) -> tuple[list[list[float]], list[str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        raw_rows = [row for row in reader if row and not row[0].strip().startswith("#")]

    if not raw_rows:
        raise ValueError(f"Feature CSV is empty: {path}")

    first = [cell.strip() for cell in raw_rows[0]]
    has_header = _is_header_row(first)
    if has_header:
        column_names = [cell.strip() or f"f{index}" for index, cell in enumerate(first)]
        data_rows = raw_rows[1:]
    else:
        column_names = [f"f{index}" for index in range(len(first))]
        data_rows = raw_rows

    if not data_rows:
        raise ValueError(f"Feature CSV has no numeric rows: {path}")

    matrix: list[list[float]] = []
    expected_columns = len(column_names)
    for row_index, row in enumerate(data_rows, start=2 if has_header else 1):
        if len(row) != expected_columns:
            raise ValueError(
                f"Inconsistent column count at {path}:{row_index}. "
                f"Expected {expected_columns}, got {len(row)}."
            )
        values: list[float] = []
        for cell in row:
            parsed = _parse_float(cell)
            if parsed is None or not math.isfinite(parsed):
                raise ValueError(f"Non-numeric value at {path}:{row_index}: {cell!r}")
            values.append(parsed)
        matrix.append(values)

    if len(matrix) < 2:
        raise ValueError("Need at least 2 rows for clustering.")
    if expected_columns < 1:
        raise ValueError("Need at least one feature column.")
    return matrix, column_names


def load_label_vector_csv(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        rows = [row for row in reader if row and not row[0].strip().startswith("#")]

    if not rows:
        raise ValueError(f"Labels CSV is empty: {path}")

    header_tokens = {"label", "class", "target", "y"}
    first_label = rows[0][0].strip().lower()
    start_index = 1 if first_label in header_tokens and len(rows) > 1 else 0
    labels = [row[0].strip() for row in rows[start_index:] if row and row[0].strip()]
    if not labels:
        raise ValueError(f"No labels found in CSV: {path}")
    return labels


def _zscore_columns(matrix: Sequence[Sequence[float]]) -> tuple[list[list[float]], list[float], list[float]]:
    row_count = len(matrix)
    col_count = len(matrix[0]) if row_count else 0
    means = [0.0] * col_count
    for row in matrix:
        for col_index, value in enumerate(row):
            means[col_index] += value
    means = [value / row_count for value in means]

    variances = [0.0] * col_count
    for row in matrix:
        for col_index, value in enumerate(row):
            delta = value - means[col_index]
            variances[col_index] += delta * delta
    stds = [math.sqrt(value / row_count) if value > 1e-12 else 1.0 for value in variances]

    normalized = []
    for row in matrix:
        normalized.append([(value - means[col_index]) / stds[col_index] for col_index, value in enumerate(row)])
    return normalized, means, stds


def _squared_distance(a: Sequence[float], b: Sequence[float], feature_indices: Sequence[int] | None = None) -> float:
    if feature_indices is None:
        return sum((a[index] - b[index]) ** 2 for index in range(len(a)))
    return sum((a[index] - b[index]) ** 2 for index in feature_indices)


def _assign_rows(
    rows: Sequence[Sequence[float]],
    centroids: Sequence[Sequence[float]],
    feature_indices: Sequence[int] | None = None,
) -> tuple[list[int], float]:
    labels: list[int] = []
    inertia = 0.0
    for row in rows:
        best_cluster = 0
        best_distance = float("inf")
        for cluster_index, centroid in enumerate(centroids):
            distance = _squared_distance(row, centroid, feature_indices)
            if distance < best_distance:
                best_distance = distance
                best_cluster = cluster_index
        labels.append(best_cluster)
        inertia += best_distance
    return labels, inertia


def _kmeans_plus_plus_init(
    rows: Sequence[Sequence[float]],
    k: int,
    rng: random.Random,
    feature_indices: Sequence[int] | None = None,
) -> list[list[float]]:
    centroids: list[list[float]] = [list(rows[rng.randrange(len(rows))])]
    while len(centroids) < k:
        distances = []
        for row in rows:
            nearest = min(_squared_distance(row, centroid, feature_indices) for centroid in centroids)
            distances.append(max(nearest, 0.0))
        total = sum(distances)
        if total <= 1e-12:
            centroids.append(list(rows[rng.randrange(len(rows))]))
            continue
        threshold = rng.random() * total
        cursor = 0.0
        picked_index = len(rows) - 1
        for index, value in enumerate(distances):
            cursor += value
            if cursor >= threshold:
                picked_index = index
                break
        centroids.append(list(rows[picked_index]))
    return centroids


def _run_kmeans(
    rows: Sequence[Sequence[float]],
    k: int,
    *,
    seed: int,
    max_iter: int,
    feature_indices: Sequence[int] | None = None,
) -> tuple[list[int], list[list[float]], float]:
    if k < 2:
        raise ValueError("k must be >= 2")
    if k > len(rows):
        raise ValueError(f"k={k} cannot exceed row count={len(rows)}")

    rng = random.Random(seed)
    col_count = len(rows[0])
    centroids = _kmeans_plus_plus_init(rows, k, rng, feature_indices)

    labels: list[int] = [0] * len(rows)
    for _ in range(max_iter):
        labels, _ = _assign_rows(rows, centroids, feature_indices)

        next_centroids = [[0.0] * col_count for _ in range(k)]
        counts = [0] * k
        for row, label in zip(rows, labels):
            counts[label] += 1
            for col_index, value in enumerate(row):
                next_centroids[label][col_index] += value

        for cluster_index in range(k):
            if counts[cluster_index] == 0:
                next_centroids[cluster_index] = list(rows[rng.randrange(len(rows))])
                continue
            scale = 1.0 / counts[cluster_index]
            for col_index in range(col_count):
                next_centroids[cluster_index][col_index] *= scale

        max_shift = 0.0
        for cluster_index in range(k):
            shift = math.sqrt(_squared_distance(centroids[cluster_index], next_centroids[cluster_index]))
            max_shift = max(max_shift, shift)
        centroids = next_centroids
        if max_shift <= 1e-6:
            break

    labels, inertia = _assign_rows(rows, centroids, feature_indices)
    return labels, centroids, inertia


def _silhouette_score(rows: Sequence[Sequence[float]], labels: Sequence[int], k: int, seed: int) -> float:
    if len(rows) < 3:
        return 0.0

    indices = list(range(len(rows)))
    max_points = 400
    if len(indices) > max_points:
        rng = random.Random(seed)
        rng.shuffle(indices)
        indices = indices[:max_points]
        indices.sort()

    by_cluster: dict[int, list[int]] = {}
    for index in indices:
        by_cluster.setdefault(labels[index], []).append(index)

    if len(by_cluster) < 2:
        return 0.0

    def mean_distance(source: int, targets: Sequence[int]) -> float:
        if not targets:
            return 0.0
        distances = [math.sqrt(_squared_distance(rows[source], rows[target])) for target in targets]
        return sum(distances) / len(distances)

    scores: list[float] = []
    for index in indices:
        own_cluster = labels[index]
        own_members = [other for other in by_cluster.get(own_cluster, []) if other != index]
        if not own_members:
            scores.append(0.0)
            continue

        a = mean_distance(index, own_members)
        b = float("inf")
        for cluster_id, members in by_cluster.items():
            if cluster_id == own_cluster or not members:
                continue
            b = min(b, mean_distance(index, members))
        if not math.isfinite(b):
            scores.append(0.0)
            continue
        denom = max(a, b, 1e-12)
        scores.append((b - a) / denom)

    return sum(scores) / len(scores) if scores else 0.0


def _cluster_sizes(labels: Sequence[int], k: int) -> list[int]:
    counts = [0] * k
    for label in labels:
        counts[label] += 1
    return counts


def _centroid_distance_summary(centroids: Sequence[Sequence[float]]) -> dict[str, float]:
    if len(centroids) < 2:
        return {"min": 0.0, "mean": 0.0}
    distances = []
    for i in range(len(centroids)):
        for j in range(i + 1, len(centroids)):
            distances.append(math.sqrt(_squared_distance(centroids[i], centroids[j])))
    return {
        "min": min(distances) if distances else 0.0,
        "mean": sum(distances) / len(distances) if distances else 0.0,
    }


def _best_label_agreement(reference_labels: Sequence[int], candidate_labels: Sequence[int], k: int) -> float:
    counts = [[0 for _ in range(k)] for _ in range(k)]
    for ref_label, cand_label in zip(reference_labels, candidate_labels):
        counts[ref_label][cand_label] += 1

    candidate_to_ref: dict[int, int] = {}
    used_ref: set[int] = set()
    ranked = []
    for ref in range(k):
        for cand in range(k):
            ranked.append((counts[ref][cand], ref, cand))
    ranked.sort(reverse=True)

    for value, ref, cand in ranked:
        if value <= 0:
            break
        if cand in candidate_to_ref or ref in used_ref:
            continue
        candidate_to_ref[cand] = ref
        used_ref.add(ref)

    remaining_refs = [ref for ref in range(k) if ref not in used_ref]
    for cand in range(k):
        if cand not in candidate_to_ref:
            candidate_to_ref[cand] = remaining_refs.pop(0) if remaining_refs else cand

    matches = 0
    for ref_label, cand_label in zip(reference_labels, candidate_labels):
        mapped = candidate_to_ref.get(cand_label, cand_label)
        if mapped == ref_label:
            matches += 1
    return matches / max(1, len(reference_labels))


def _compute_stability(
    rows: Sequence[Sequence[float]],
    baseline_labels: Sequence[int],
    k: int,
    *,
    seed: int,
    max_iter: int,
    runs: int,
    row_ratio: float,
    feature_ratio: float,
) -> dict[str, float]:
    if runs <= 0:
        return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0}

    rng = random.Random(seed)
    row_count = len(rows)
    col_count = len(rows[0]) if row_count else 0
    if row_count < k or col_count <= 0:
        return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0}

    run_scores: list[float] = []
    row_sample_size = max(k, min(row_count, int(round(row_count * row_ratio))))
    feature_sample_size = max(1, min(col_count, int(round(col_count * feature_ratio))))

    for run_index in range(runs):
        sampled_row_indices = sorted(rng.sample(range(row_count), row_sample_size))
        sampled_feature_indices = sorted(rng.sample(range(col_count), feature_sample_size))
        sampled_rows = [rows[index] for index in sampled_row_indices]

        run_labels_sampled, run_centroids, _ = _run_kmeans(
            sampled_rows,
            k,
            seed=seed + 7919 * (run_index + 1),
            max_iter=max_iter,
            feature_indices=sampled_feature_indices,
        )

        run_labels_full, _ = _assign_rows(rows, run_centroids, sampled_feature_indices)
        score = _best_label_agreement(baseline_labels, run_labels_full, k)
        run_scores.append(score)

        # Touch sampled labels to keep diagnostics stable across refactors.
        if not run_labels_sampled:
            run_scores[-1] = 0.0

    if not run_scores:
        return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0}
    return {
        "mean": sum(run_scores) / len(run_scores),
        "std": statistics.pstdev(run_scores) if len(run_scores) > 1 else 0.0,
        "min": min(run_scores),
        "max": max(run_scores),
    }


def _cluster_purity(labels: Sequence[int], class_labels: Sequence[str], k: int) -> dict[str, object]:
    if len(labels) != len(class_labels):
        raise ValueError(
            f"Label vector length mismatch: expected {len(labels)}, got {len(class_labels)}"
        )

    per_cluster: list[dict[str, object]] = []
    weighted_purity_numerator = 0.0
    for cluster_id in range(k):
        members = [index for index, label in enumerate(labels) if label == cluster_id]
        if not members:
            per_cluster.append(
                {
                    "cluster": cluster_id,
                    "size": 0,
                    "top_label": None,
                    "purity": 0.0,
                    "class_counts": {},
                }
            )
            continue
        counts: dict[str, int] = {}
        for member in members:
            key = class_labels[member]
            counts[key] = counts.get(key, 0) + 1
        top_label, top_count = max(counts.items(), key=lambda item: item[1])
        purity = top_count / len(members)
        weighted_purity_numerator += top_count
        per_cluster.append(
            {
                "cluster": cluster_id,
                "size": len(members),
                "top_label": top_label,
                "purity": purity,
                "class_counts": counts,
            }
        )
    return {
        "overall_purity": weighted_purity_numerator / max(1, len(labels)),
        "per_cluster": per_cluster,
    }


def run_r_clustering(
    feature_csv: Path,
    *,
    k: int = 2,
    seed: int = 0,
    max_iter: int = 64,
    stability_runs: int = 16,
    row_ratio: float = 0.8,
    feature_ratio: float = 0.8,
    labels_csv: Path | None = None,
) -> dict[str, object]:
    if not feature_csv.exists():
        raise ValueError(f"Feature CSV does not exist: {feature_csv}")

    matrix, column_names = load_feature_matrix_csv(feature_csv)
    normalized_rows, _, _ = _zscore_columns(matrix)
    row_count = len(normalized_rows)
    col_count = len(column_names)
    if k < 2:
        raise ValueError("k must be >= 2")
    if k > row_count:
        raise ValueError(f"k={k} cannot exceed sample count={row_count}")

    baseline_labels, centroids, inertia = _run_kmeans(
        normalized_rows,
        k,
        seed=seed,
        max_iter=max_iter,
    )
    silhouette = _silhouette_score(normalized_rows, baseline_labels, k, seed=seed + 17)
    stability = _compute_stability(
        normalized_rows,
        baseline_labels,
        k,
        seed=seed + 101,
        max_iter=max_iter,
        runs=stability_runs,
        row_ratio=row_ratio,
        feature_ratio=feature_ratio,
    )
    centroid_distance = _centroid_distance_summary(centroids)
    sizes = _cluster_sizes(baseline_labels, k)

    clusters = []
    for cluster_id, size in enumerate(sizes):
        centroid_norm = math.sqrt(sum(value * value for value in centroids[cluster_id]))
        clusters.append(
            {
                "cluster": cluster_id,
                "size": size,
                "ratio": size / max(1, row_count),
                "centroid_norm": centroid_norm,
            }
        )

    payload: dict[str, object] = {
        "command": "r-cluster",
        "schema_version": "0.2.0",
        "status": "ok",
        "input": {
            "feature_csv": str(feature_csv),
            "sample_count": row_count,
            "feature_count": col_count,
            "feature_columns": column_names,
        },
        "params": {
            "k": k,
            "seed": seed,
            "max_iter": max_iter,
            "stability_runs": stability_runs,
            "row_ratio": row_ratio,
            "feature_ratio": feature_ratio,
            "representation": "zscore(feature columns) + euclidean distance",
        },
        "diagnostics": {
            "inertia": inertia,
            "silhouette": silhouette,
            "stability": stability,
            "centroid_distance": centroid_distance,
        },
        "clusters": clusters,
    }

    if labels_csv is not None:
        label_values = load_label_vector_csv(labels_csv)
        purity = _cluster_purity(baseline_labels, label_values, k)
        payload["classwise"] = {
            "labels_csv": str(labels_csv),
            "purity": purity,
        }

    return payload
