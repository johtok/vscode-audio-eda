from __future__ import annotations

import math
import struct
import wave
from pathlib import Path


def main() -> None:
    sample_rate = 16_000
    duration_seconds = 3.0
    total_samples = int(sample_rate * duration_seconds)
    output_path = Path(__file__).with_name("test_tone.wav")

    with wave.open(str(output_path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)

        for index in range(total_samples):
            t = index / sample_rate
            # Linear chirp from 220 Hz to 880 Hz.
            frequency = 220 + 660 * (t / duration_seconds)
            sample = 0.45 * math.sin(2 * math.pi * frequency * t)
            quantized = int(max(-1.0, min(1.0, sample)) * 32767)
            handle.writeframesraw(struct.pack("<h", quantized))

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
