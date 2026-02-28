export interface BasicWaveformMetrics {
  mean: number;
  rms: number;
  variance: number;
  peak: number;
  truePeak: number;
  crestFactor: number;
  dynamicRangeP95P5: number;
  clippingRate: number;
  silenceRatio: number;
  zeroCrossingRate: number;
}

export interface BasicMetricOptions {
  clippingThreshold?: number;
  silenceThreshold?: number;
  truePeakOversample?: number;
}

type NumericArrayLike = ArrayLike<number>;

export function computeBasicWaveformMetrics(
  samples: NumericArrayLike,
  options: BasicMetricOptions = {}
): BasicWaveformMetrics {
  const safe = toFiniteSamples(samples);
  if (safe.length === 0) {
    return {
      mean: 0,
      rms: 0,
      variance: 0,
      peak: 0,
      truePeak: 0,
      crestFactor: 0,
      dynamicRangeP95P5: 0,
      clippingRate: 0,
      silenceRatio: 1,
      zeroCrossingRate: 0
    };
  }

  const clippingThreshold = clampFinite(options.clippingThreshold, 0.99, 0, 1);
  const silenceThreshold = Math.max(0, Number.isFinite(options.silenceThreshold ?? Number.NaN)
    ? Number(options.silenceThreshold)
    : 1e-4);
  const oversample = clampInteger(options.truePeakOversample, 4, 1, 16);
  const length = safe.length;

  let sum = 0;
  let sumSq = 0;
  let peak = 0;
  let clippingCount = 0;
  let silenceCount = 0;
  let zeroCrossingCount = 0;

  let previous = safe[0];
  for (let index = 0; index < length; index += 1) {
    const value = safe[index];
    const absValue = Math.abs(value);
    sum += value;
    sumSq += value * value;
    if (absValue > peak) {
      peak = absValue;
    }
    if (absValue >= clippingThreshold) {
      clippingCount += 1;
    }
    if (absValue <= silenceThreshold) {
      silenceCount += 1;
    }
    if (index > 0) {
      if ((previous < 0 && value >= 0) || (previous > 0 && value <= 0)) {
        zeroCrossingCount += 1;
      }
      previous = value;
    }
  }

  const mean = sum / length;
  const variance = sumSq / length - mean * mean;
  const rms = Math.sqrt(Math.max(0, sumSq / length));
  const truePeak = estimateTruePeakLinear(safe, oversample);
  const crestFactor = rms > 1e-12 ? peak / rms : 0;

  const sortedAbs = safe.map((sample) => Math.abs(sample)).sort((left, right) => left - right);
  const p95 = quantileSorted(sortedAbs, 0.95);
  const p5 = quantileSorted(sortedAbs, 0.05);

  return {
    mean,
    rms,
    variance: Math.max(0, variance),
    peak,
    truePeak,
    crestFactor,
    dynamicRangeP95P5: p95 - p5,
    clippingRate: clippingCount / length,
    silenceRatio: silenceCount / length,
    zeroCrossingRate: zeroCrossingCount / Math.max(1, length - 1)
  };
}

export function computeAutocorrelation(
  samples: NumericArrayLike,
  maxLag: number
): Float64Array {
  const safe = toFiniteSamples(samples);
  if (safe.length === 0) {
    return new Float64Array(0);
  }

  const lagLimit = clampInteger(maxLag, safe.length - 1, 0, safe.length - 1);
  const result = new Float64Array(lagLimit + 1);

  for (let lag = 0; lag <= lagLimit; lag += 1) {
    let sum = 0;
    const count = safe.length - lag;
    for (let index = 0; index < count; index += 1) {
      sum += safe[index] * safe[index + lag];
    }
    result[lag] = count > 0 ? sum / count : 0;
  }

  const norm = Math.abs(result[0]) > 1e-12 ? result[0] : 1;
  for (let lag = 0; lag < result.length; lag += 1) {
    result[lag] /= norm;
  }

  return result;
}

export function computeShortTimePower(
  samples: NumericArrayLike,
  frameSize: number,
  hopSize: number
): Float64Array {
  const safe = toFiniteSamples(samples);
  if (safe.length === 0) {
    return new Float64Array(0);
  }

  const frame = clampInteger(frameSize, 256, 1, 1_000_000);
  const hop = clampInteger(hopSize, Math.max(1, Math.floor(frame / 2)), 1, 1_000_000);
  if (safe.length < frame) {
    return new Float64Array(0);
  }

  const count = Math.floor((safe.length - frame) / hop) + 1;
  const output = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const start = index * hop;
    let sumSq = 0;
    for (let cursor = 0; cursor < frame; cursor += 1) {
      const value = safe[start + cursor];
      sumSq += value * value;
    }
    output[index] = sumSq / frame;
  }

  return output;
}

export function computeSpectralCentroidFromPower(
  powerBins: NumericArrayLike,
  sampleRate: number,
  fftSize: number
): number {
  const safe = toFiniteSamples(powerBins);
  if (safe.length === 0) {
    return 0;
  }

  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 1;
  const nfft = Number.isFinite(fftSize) && fftSize > 1 ? fftSize : Math.max(2, safe.length * 2);
  let weightedSum = 0;
  let total = 0;

  for (let bin = 0; bin < safe.length; bin += 1) {
    const power = Math.max(0, safe[bin]);
    const freq = (bin * sr) / nfft;
    weightedSum += power * freq;
    total += power;
  }

  return total > 1e-12 ? weightedSum / total : 0;
}

export function computePowerSpectrumNaive(samples: NumericArrayLike): Float64Array {
  const safe = toFiniteSamples(samples);
  const n = safe.length;
  if (n === 0) {
    return new Float64Array(0);
  }

  const bins = Math.floor(n / 2) + 1;
  const output = new Float64Array(bins);

  for (let k = 0; k < bins; k += 1) {
    let real = 0;
    let imag = 0;
    for (let index = 0; index < n; index += 1) {
      const phase = (-2 * Math.PI * k * index) / n;
      const value = safe[index];
      real += value * Math.cos(phase);
      imag += value * Math.sin(phase);
    }
    output[k] = real * real + imag * imag;
  }

  return output;
}

function toFiniteSamples(input: NumericArrayLike): Float64Array {
  const output = new Float64Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = Number(input[index]);
    output[index] = Number.isFinite(value) ? value : 0;
  }
  return output;
}

function clampFinite(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Math.round(clampFinite(value, fallback, min, max));
}

function quantileSorted(sorted: NumericArrayLike, q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, q));
  const index = (sorted.length - 1) * clamped;
  const left = Math.floor(index);
  const right = Math.min(sorted.length - 1, left + 1);
  const frac = index - left;
  return sorted[left] * (1 - frac) + sorted[right] * frac;
}

function estimateTruePeakLinear(samples: NumericArrayLike, oversample: number): number {
  if (samples.length === 0) {
    return 0;
  }

  let truePeak = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const left = samples[index];
    const right = samples[index + 1];
    truePeak = Math.max(truePeak, Math.abs(left), Math.abs(right));
    for (let step = 1; step < oversample; step += 1) {
      const ratio = step / oversample;
      const interpolated = left * (1 - ratio) + right * ratio;
      truePeak = Math.max(truePeak, Math.abs(interpolated));
    }
  }
  return truePeak;
}
