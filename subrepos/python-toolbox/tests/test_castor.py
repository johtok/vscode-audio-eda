from __future__ import annotations

from pathlib import Path

from audio_eda_toolbox.castor import prepare_two_class_dataset, run_castor_prototype


def _write_series(path: Path, values: list[float]) -> None:
    path.write_text("\n".join(str(value) for value in values), encoding="utf-8")


def test_castor_prototype_runs_for_two_class_folders(tmp_path: Path) -> None:
    class_a = tmp_path / "class_a"
    class_b = tmp_path / "class_b"
    class_a.mkdir()
    class_b.mkdir()

    _write_series(class_a / "a_1.csv", [0.0, 0.1, 0.2, 0.2, 0.1, 0.0])
    _write_series(class_a / "a_2.csv", [0.0, 0.05, 0.2, 0.25, 0.1, 0.0])
    _write_series(class_b / "b_1.csv", [1.0, 1.1, 1.2, 1.2, 1.1, 1.0])
    _write_series(class_b / "b_2.csv", [1.0, 1.05, 1.2, 1.25, 1.1, 1.0])

    report = run_castor_prototype(class_a, class_b, pad_length=8)

    assert report["command"] == "castor-prototype"
    assert report["instance_count"] == 4
    assert report["pad_length"] == 8
    assert report["training_accuracy"] >= 0.5
    assert sorted(report["class_labels"]) == ["class_a", "class_b"]


def test_prepare_two_class_dataset_from_segments_csv(tmp_path: Path) -> None:
    class_a = tmp_path / "alpha"
    class_b = tmp_path / "beta"
    class_a.mkdir()
    class_b.mkdir()

    _write_series(class_a / "a_track.csv", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    _write_series(class_b / "b_track.csv", [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])

    segments_a = class_a / "segments.csv"
    segments_b = class_b / "segments.csv"
    segments_a.write_text("file,start,end\na_track.csv,1,4\na_track.csv,6,9\n", encoding="utf-8")
    segments_b.write_text("file,start,end\nb_track.csv,0,3\nb_track.csv,5,8\n", encoding="utf-8")

    dataset = prepare_two_class_dataset(
        class_a,
        class_b,
        segments_a=segments_a,
        segments_b=segments_b,
    )

    assert len(dataset.series) == 4
    assert len(dataset.labels) == 4
    assert set(dataset.labels) == {"alpha", "beta"}
    assert dataset.series[0] == [1.0, 2.0, 3.0]
    assert dataset.series[2] == [10.0, 11.0, 12.0]
