from audio_eda_toolbox.cli import build_parser


def test_parser_builds() -> None:
    parser = build_parser()
    assert parser.prog == "audio-eda"
