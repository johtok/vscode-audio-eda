from __future__ import annotations

import argparse
import json
from pathlib import Path

from audio_eda_toolbox.castor import run_castor_prototype
from audio_eda_toolbox.r_clustering import run_r_clustering


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="audio-eda")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect", help="Inspect one audio file")
    inspect_parser.add_argument("path", type=Path)
    inspect_parser.add_argument("--json", action="store_true", dest="as_json")

    summarize_parser = subparsers.add_parser("summarize", help="Summarize a folder")
    summarize_parser.add_argument("path", type=Path)
    summarize_parser.add_argument("--json", action="store_true", dest="as_json")

    castor_parser = subparsers.add_parser(
        "castor-prototype",
        help="Build a 2-class CASTOR prototype from folder timeseries data",
    )
    castor_parser.add_argument("class_a_dir", type=Path)
    castor_parser.add_argument("class_b_dir", type=Path)
    castor_parser.add_argument("--segments-a", type=Path, default=None)
    castor_parser.add_argument("--segments-b", type=Path, default=None)
    castor_parser.add_argument(
        "--segments-unit",
        choices=["samples", "seconds"],
        default="samples",
        help="Unit for start/end in segment CSVs when t_start/t_end are not used",
    )
    castor_parser.add_argument(
        "--pad-length",
        type=int,
        default=None,
        help="Final sequence length after trim/pad (default: inferred from data)",
    )
    castor_parser.add_argument(
        "--pad-value",
        type=float,
        default=0.0,
        help="Padding value for short sequences",
    )
    castor_parser.add_argument(
        "--no-normalize",
        action="store_true",
        help="Disable per-sequence z-normalization before prototype fitting",
    )
    castor_parser.add_argument("--json", action="store_true", dest="as_json")

    r_cluster_parser = subparsers.add_parser(
        "r-cluster",
        help="Run representation-aware clustering diagnostics on a feature CSV",
    )
    r_cluster_parser.add_argument("feature_csv", type=Path)
    r_cluster_parser.add_argument("--k", type=int, default=2)
    r_cluster_parser.add_argument("--seed", type=int, default=0)
    r_cluster_parser.add_argument("--max-iter", type=int, default=64)
    r_cluster_parser.add_argument("--stability-runs", type=int, default=16)
    r_cluster_parser.add_argument("--row-ratio", type=float, default=0.8)
    r_cluster_parser.add_argument("--feature-ratio", type=float, default=0.8)
    r_cluster_parser.add_argument("--labels-csv", type=Path, default=None)
    r_cluster_parser.add_argument("--json", action="store_true", dest="as_json")

    subparsers.add_parser("schema", help="Show toolbox schema version")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "schema":
        print(json.dumps({"schema_version": "0.1.0"}))
        return

    if args.command == "inspect":
        payload = {
            "command": "inspect",
            "path": str(args.path),
            "exists": args.path.exists(),
            "status": "stub",
        }
    elif args.command == "summarize":
        payload = {
            "command": "summarize",
            "path": str(args.path),
            "exists": args.path.exists(),
            "status": "stub",
        }
    elif args.command == "castor-prototype":
        payload = run_castor_prototype(
            class_a_dir=args.class_a_dir,
            class_b_dir=args.class_b_dir,
            segments_a=args.segments_a,
            segments_b=args.segments_b,
            segments_unit=args.segments_unit,
            pad_length=args.pad_length,
            pad_value=args.pad_value,
            normalize=not args.no_normalize,
        )
    elif args.command == "r-cluster":
        payload = run_r_clustering(
            feature_csv=args.feature_csv,
            k=args.k,
            seed=args.seed,
            max_iter=args.max_iter,
            stability_runs=args.stability_runs,
            row_ratio=args.row_ratio,
            feature_ratio=args.feature_ratio,
            labels_csv=args.labels_csv,
        )
    else:
        parser.error(f"Unsupported command: {args.command}")

    if getattr(args, "as_json", False):
        print(json.dumps(payload))
    else:
        print(payload)


if __name__ == "__main__":
    main()
