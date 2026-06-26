---
name: sim
description: "Circuit simulation dispatcher: SPICE subcircuits (-> spice skill, ngspice), RF chains (scikit-rf), power/clock transient + AC. Triggers: simulate, run simulation, check stability, ripple analysis, S-parameters, RF chain."

---

# sim — simulation dispatcher

Route by simulation type. Do NOT run every tool at once — pick the path matching the question.

## 1. SPICE subcircuit (filters, dividers, opamp gain, LC/crystal, ripple)
Use the **`spice`** skill — canonical (ngspice/LTspice/Xyce, auto-extracts subcircuits from
KiCad). It owns filter cutoff, divider voltage, opamp bandwidth, LC resonance, regulator ripple,
transient + AC sweeps. Invoke `spice` rather than hand-rolling ngspice here.

## 2. RF chain / S-parameters (scikit-rf)
Cascaded RF blocks (gain, NF, return loss, match):
- Confirm lib: `python -c "import skrf"` (`pip install scikit-rf` if missing).
- Each stage = `skrf.Network` from Touchstone (`.s2p`) or from R/L/C + `skrf.media`.
- Cascade with `**`: `total = amp ** filt ** mixer`; read `total.s_db`, S21 = `total.s[:,1,0]`, `total.z0`.
- Friis for chain gain/NF; target input/output match `s11`,`s22` < -10 dB.

## 3. Power / clock transient + AC
- Power rail: model LDO/buck output stage in `spice`; step the load, measure droop / ripple / recovery.
- Clock: transient on oscillator/buffer net — rise/fall, overshoot, duty; AC on the distribution net for flatness.

## Discipline
- One simulator path per question; results are meaningless without the right model/netlist in place first.
- State assumptions (models, corners, temperature) with every result.
- For KiCad-sourced circuits, let `spice` extract the subcircuit rather than transcribing by hand.
