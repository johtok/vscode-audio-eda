from __future__ import annotations

import csv
from pathlib import Path

from audio_eda_toolbox.r_clustering import run_r_clustering


def _write_feature_csv(path: Path) -> None:
    rows = [["x", "y"]]
    for index in range(20):
        rows.append([f"{0.05 * index:.6f}", f"{0.03 * index:.6f}"])
    for index in range(20):
        rows.append([f"{5.0 + 0.04 * index:.6f}", f"{4.9 + 0.02 * index:.6f}"])
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)


def _write_labels_csv(path: Path) -> None:
    rows = [["label"]]
    rows.extend([["A"] for _ in range(20)])
    rows.extend([["B"] for _ in range(20)])
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)


def test_r_clustering_smoke(tmp_path: Path) -> None:
    feature_csv = tmp_path / "features.csv"
    _write_feature_csv(feature_csv)

    payload = run_r_clustering(
        feature_csv,
        k=2,
        seed=7,
        max_iter=64,
        stability_runs=8,
    )

    assert payload["status"] == "ok"
    assert payload["command"] == "r-cluster"
    assert payload["input"]["sample_count"] == 40
    assert payload["input"]["feature_count"] == 2
    assert len(payload["clusters"]) == 2
    assert payload["diagnostics"]["silhouette"] > 0.5
    assert payload["diagnostics"]["stability"]["mean"] > 0.75


def test_r_clustering_with_labels(tmp_path: Path) -> None:
    feature_csv = tmp_path / "features.csv"
    labels_csv = tmp_path / "labels.csv"
    _write_feature_csv(feature_csv)
    _write_labels_csv(labels_csv)

    payload = run_r_clustering(
        feature_csv,
        k=2,
        seed=11,
        max_iter=64,
        stability_runs=6,
        labels_csv=labels_csv,
    )

    assert "classwise" in payload
    purity = payload["classwise"]["purity"]["overall_purity"]
    assert purity > 0.9
