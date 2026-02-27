from __future__ import annotations

import argparse
import json
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="audio-eda")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect", help="Inspect one audio file")
    inspect_parser.add_argument("path", type=Path)
    inspect_parser.add_argument("--json", action="store_true", dest="as_json")

    summarize_parser = subparsers.add_parser("summarize", help="Summarize a folder")
    summarize_parser.add_argument("path", type=Path)
    summarize_parser.add_argument("--json", action="store_true", dest="as_json")

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
    else:
        parser.error(f"Unsupported command: {args.command}")

    if getattr(args, "as_json", False):
        print(json.dumps(payload))
    else:
        print(payload)


if __name__ == "__main__":
    main()
