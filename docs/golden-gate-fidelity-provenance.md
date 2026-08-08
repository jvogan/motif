# Empirical Golden Gate fidelity provenance

The vendored ligation counts come from Pryor JM, Potapov V, Kucera RB, Bilotti
K, Cantor EJ, Lohman GJS (2020), “Enabling one-pot Golden Gate assemblies of
unprecedented complexity using data-optimized assembly design,” *PLOS ONE*
15(9):e0238592, DOI [10.1371/journal.pone.0238592](https://doi.org/10.1371/journal.pone.0238592).
The article and supporting files are distributed under [CC BY
4.0](https://creativecommons.org/licenses/by/4.0/).

## Assays represented

The five matrices are the paper's S1–S5 supporting tables. Every assay used a
20 µL reaction, 100 nM DNA substrate, 30 cycles of 5 minutes at each cycling
temperature, a final 60 °C 5-minute heat soak, and at least two experiments on
different days. The source paper reports the following enzyme, ligase, buffer,
and cycling conditions:

| Dataset | Enzyme amount | Ligase/buffer | Cycling |
| --- | --- | --- | --- |
| S1 — BsaI-HFv2 | 2 µL NEB Golden Gate Enzyme Mix | T4 DNA ligase in 1× T4 DNA ligase buffer | 37/16 °C |
| S2 — BsmBI-v2 | 2 µL NEB Golden Gate Enzyme Mix | T4 DNA ligase in 1× T4 DNA ligase buffer | 42/16 °C |
| S3 — Esp3I | 15 U Esp3I + 500 U T4 DNA ligase | 1× T4 DNA ligase buffer | 37/16 °C |
| S4 — BbsI-HF | 15 U BbsI-HF + 500 U T4 DNA ligase | 1× CutSmart buffer + 10 mM DTT + 1 mM ATP | 37/16 °C |
| S5 — SapI | 15 U SapI + 500 U T4 DNA ligase | 1× T4 DNA ligase buffer | 37/16 °C |

The original machine-readable downloads and independent checksums are:

| Dataset | Supporting file | SHA-256 |
| --- | --- | --- |
| S1 | [S1 Table](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0238592.s001) | `320dd058f3ca6372768c7ddfe9cda2a2ea2a076c4f86dd08587d8f295aae1d15` |
| S2 | [S2 Table](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0238592.s002) | `7c444e99e5e4d245461a892e8543a35c84987f93abcee7098de9d9d817237e94` |
| S3 | [S3 Table](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0238592.s003) | `1557e62cfa4f89cd021420b75e145dae2f453ecf26dcca340a8c29008736ea66` |
| S4 | [S4 Table](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0238592.s004) | `56143bb445e6d84bba646429402e0948793395269cc5d8ba0e80962c0cac6492` |
| S5 | [S5 Table](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0238592.s005) | `dfa2df906bd306e3971652c4b95d004818fdb8dd9e49f4522691959d28f537cb` |

The lossless sparse transcription is
[`golden-gate-fidelity-data.ts`](../src/bio/golden-gate-fidelity-data.ts). Its
SHA-256 is
`79f07cd539b7843e4e6828e538551361f78ca0d8d21a7077a20f5e6c6cb8a1dc`.
Each sparse triple is a source row index, column index, and integer count;
omitted cells remain explicit zero observations. The source row axis is the
reverse-complement strand and the column axis is the top-strand 5′→3′ label
list. The adapter maps physical pair orientation and does not mirror, average,
or fill observations.

## Scoring contract and caveats

`golden-gate-fidelity.ts` only selects a matrix when the complete condition
(enzyme, ligase, enzyme amount, buffer, reaction volume, substrate
concentration, cycling steps, and final heat soak) matches. The artifact
geometry names the enzyme families as BsaI, BbsI, and BsmBI; it permits only the
explicit published variant aliases BsaI-HFv2, BbsI-HF, and BsmBI-v2. It never
uses one enzyme family’s matrix for another family, and an unmatched condition
is reported as unsupported/unknown.

For a selected set, the per-junction estimate follows the paper’s definition:
correct events include both Watson–Crick orientations, while the denominator
includes both orientations against every selected end and its complement. The
whole-assembly estimate is the product of per-junction conditional ratios under
the paper’s independence assumption. These are qualitative comparison
estimates, not guaranteed yields or probabilities for a new protocol; enzyme
activity, stoichiometry, DNA purity, cycling, and assembly context can change
the result. The returned assessment retains per-junction counts, coverage,
unknown reasons, source citation, data URL, license, and source checksum.

Hamming distance remains available only through an explicit
`hamming-heuristic` method/fallback. It is a sequence-separation ranking aid,
not empirical ligation fidelity, and never populates the empirical estimate.
