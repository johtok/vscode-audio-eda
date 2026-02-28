export function generateSineWave(
  sampleRate: number,
  frequencyHz: number,
  durationSeconds: number,
  amplitude = 1,
  phaseRadians = 0
): Float64Array {
  const count = Math.max(0, Math.floor(sampleRate * durationSeconds));
  const output = new Float64Array(count);
  const angularStep = (2 * Math.PI * frequencyHz) / sampleRate;
  for (let index = 0; index < count; index += 1) {
    output[index] = amplitude * Math.sin(phaseRadians + index * angularStep);
  }
  return output;
}

export function generateSquareWave(
  sampleRate: number,
  frequencyHz: number,
  durationSeconds: number,
  amplitude = 1
): Float64Array {
  const sine = generateSineWave(sampleRate, frequencyHz, durationSeconds, 1);
  const output = new Float64Array(sine.length);
  for (let index = 0; index < sine.length; index += 1) {
    output[index] = sine[index] >= 0 ? amplitude : -amplitude;
  }
  return output;
}

export function generateImpulse(length: number, index: number, amplitude = 1): Float64Array {
  const output = new Float64Array(Math.max(0, Math.floor(length)));
  if (output.length > 0) {
    const clamped = Math.min(output.length - 1, Math.max(0, Math.floor(index)));
    output[clamped] = amplitude;
  }
  return output;
}

export function generateSilence(length: number): Float64Array {
  return new Float64Array(Math.max(0, Math.floor(length)));
}

export function clampSignal(signal: readonly number[], threshold: number): Float64Array {
  const output = new Float64Array(signal.length);
  const t = Math.max(0, threshold);
  for (let index = 0; index < signal.length; index += 1) {
    const value = Number(signal[index]);
    if (!Number.isFinite(value)) {
      output[index] = 0;
    } else if (value > t) {
      output[index] = t;
    } else if (value < -t) {
      output[index] = -t;
    } else {
      output[index] = value;
    }
  }
  return output;
}
