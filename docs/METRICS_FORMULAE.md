# Metrics Formulae and Sources

This document lists the metric formulas used in `media/workbench.js` and primary references.

## Implemented Formula Families

- Time-domain level and dynamics
  - Mean/DC offset: `mu = (1/N) * sum(x[n])`
  - Variance: `sigma^2 = (1/N) * sum((x[n]-mu)^2)`
  - RMS: `sqrt((1/N) * sum(x[n]^2))`
  - Peak: `max |x[n]|`
  - True-peak proxy (implemented): max of linear-interpolated `4x` oversampling points.
  - Crest factor: `true_peak / RMS`
  - Clipping ratio: fraction of samples with `|x[n]| >= 0.999`.

- Time-series/temporal
  - Zero-crossing rate: sign-change count over `N-1` sample transitions.
  - Autocorrelation (normalized): `r[k] = sum(x[n]x[n+k]) / sum(x[n]^2)`.
  - Correlation time (implemented): first lag where normalized autocorrelation falls below `exp(-1)`.
  - Onset/flux proxy: positive first-difference of short-time log-energy; local peaks above robust threshold.
  - Attack/decay slope: first-difference of frame energy in dB divided by hop seconds.

- Speech micro-structure (heuristic)
  - Voicing/F0 per frame: autocorrelation lag search in `[50, 400] Hz` range.
  - Jitter (local): `mean(|T_i - T_{i-1}|) / mean(T_i)`.
  - Shimmer (local): `mean(|A_i - A_{i-1}|) / mean(A_i)` where `A_i` is frame RMS.

- Spectral and time-frequency
  - STFT power spectrum and average PSD over frames.
  - Spectral centroid: `sum(f_k P_k) / sum(P_k)`.
  - Spectral spread (bandwidth): `sqrt(sum((f_k-c)^2 P_k)/sum(P_k))`.
  - Spectral skewness/kurtosis: standardized 3rd/4th moments over frequency bins.
  - Spectral flatness: geometric mean / arithmetic mean of spectral power.
  - Spectral entropy (normalized): `-sum(p_k log2 p_k)/log2(K)` where `p_k=P_k/sum(P_k)`.
  - Spectral rolloff (85%): smallest `f_r` where cumulative spectral power reaches 85% total.
  - Bandpower: integrated PSD over fixed frequency ranges.

- Spectrogram-feature statistics
  - Log-mel features from mel filterbank energies.
  - MFCC as DCT-II of log-mel vectors.
  - Delta / delta-delta as first and second finite differences over framewise mel means.

- Distributional
  - Histogram entropy in bits from empirical bin probabilities.
  - Moments `m1..m4`; skewness and excess kurtosis from centered moments.
  - Quantiles and percentile spreads.

- Multichannel/spatial (when >=2 channels are present)
  - Inter-channel correlation coefficient.
  - Coherence proxy: squared correlation.
  - ILD proxy: `20*log10(RMS_L / RMS_R)`.
  - ITD proxy: lag with maximum cross-correlation in +/-10 ms search window.

- Standards-style level summaries (proxy)
  - Leq(dBFS): `10*log10(mean(x^2))`.
  - L10/L50/L90 from frame-energy percentiles in dBFS.
  - Note: these are dBFS-relative and not calibrated SPL/LUFS.

## Not Implemented Without Extra Inputs

- SI-SDR, STOI, PESQ/POLQA: require clean reference signals.
- STI/SII, RT/EDT/C50/D50: require room/transfer measurements.
- Classwise metrics: require class labels.

## Source List

1. P. D. Welch, "The use of fast Fourier transform for the estimation of power spectra," IEEE Trans. Audio Electroacoustics, 1967. DOI: `10.1109/TAU.1967.1161901`.
2. S. M. Kay, *Fundamentals of Statistical Signal Processing, Volume I: Estimation Theory* (moment/statistical estimators, autocorrelation conventions).
3. S. Davis and P. Mermelstein, "Comparison of Parametric Representations for Monosyllabic Word Recognition in Continuously Spoken Sentences," IEEE TASSP, 1980. https://courses.physics.illinois.edu/ece417/fa2017/davis80.pdf
4. K. J. Piczak, "Environmental Sound Classification with CNNs," 2015 (log-mel representation in practical audio ML). https://www.karolpiczak.com/papers/Piczak2015-ESC-ConvNet.pdf
5. M. R. Schroeder, "Modulation transfer functions: Definition and measurement," Acustica, 1981 (modulation-domain analysis motivation).
6. J. Le Roux et al., "SDR -- half-baked or well done?," ICASSP 2019 (SI-SDR definition/critique). https://www.jonathanleroux.org/pdf/LeRoux2019ICASSP05sdr.pdf
7. C. Taal et al., "A Short-Time Objective Intelligibility Measure for Time-Frequency Weighted Noisy Speech," ICASSP 2010 / IEEE TASLP 2011. https://ceestaal.nl/Taal%282010%29.pdf
8. ITU-R BS.1770 (programme loudness / true-peak standards context). https://www.itu.int/rec/R-REC-BS.1770
9. ITU-T P.862 (PESQ) / ITU-T P.863 (POLQA) standards context. https://www.itu.int/rec/t-rec-p.862
10. J. F. Santos et al., "SRMR: A speech quality and reverberation metric," (modulation-domain reverberation metric context). https://arxiv.org/pdf/1510.04707
11. ANSI S3.5 (Speech Intelligibility Index) standard context. https://pubs.aip.org/asa/jasa/article/143/3_Supplement/1906/616973/SII-Speech-intelligibility-index-standard-ANSI-S3
12. IEC 60268-16 (Speech Transmission Index) standard context. https://webstore.iec.ch/en/publication/26771
