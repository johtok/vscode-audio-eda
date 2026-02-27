from audio_eda_toolbox.cli import build_parser


def test_parser_builds() -> None:
    parser = build_parser()
    assert parser.prog == "audio-eda"


def test_parser_accepts_r_cluster_command() -> None:
    parser = build_parser()
    args = parser.parse_args(["r-cluster", "features.csv", "--k", "3", "--json"])
    assert args.command == "r-cluster"
    assert args.k == 3
