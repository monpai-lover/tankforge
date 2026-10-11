# Native source-spin default-stack diagnosis

The existing source-spin test overflows the default native test-thread stack,
including an isolated single-thread run. A diagnostic 8 MiB stack run passed;
that is not a fix or permission to raise the production/test stack requirement.
The normal/traction helper tests continue to pass on the default stack.

Root read the existing x64 debug executable's PE/SEH unwind records without
Cargo or source changes. Static frame sizes are:

| Function | Bytes |
|---|---:|
| source-spin test | 772,584 |
| `tests::rig` | 177,736 |
| `Tank::new` | 438,568 |
| `array::from_fn<TrackState, 2>` | 86,136 |
| `array::try_from_fn` | 258,328 |
| `array::try_from_fn_erased` | 344,552 |
| array callback wrapper | 43,112 |
| `TrackState::new` | 47,544 |

The potential direct-call path also includes the small constructor callback
and `LowerGraph::new`, totaling 2,178,048 bytes before return-address/caller
overheads, exceeding 2 MiB. The relative-call byte scanner is not an x64
instruction decoder, so it is supporting call-path evidence rather than a
proven executed peak. The unwind allocation sizes themselves come from the
binary's static records. No release/WASM frame-size claim follows from this.

This gives a concrete constructor hypothesis: the `array::from_fn` wrappers
copy the two large states through several debug temporaries. An explicit
two-element array with the same two `TrackState::new` calls can remove those
generic wrappers without adding heap allocation or changing physical state.
The sole writer has this hypothesis queued for a separate narrow checkpoint
after the Q/phase helper freeze. It still requires the exact default-stack RED
to become GREEN and an appropriate constructor/clone regression check.

External reproducible probe and binary SHA-256 receipt:
`C:/Users/24908/.codex/scratch/tankforge-root-native-unwind-frames.mjs/.json`.
The JSON contains the binary hash, individual frame records and the potential
call path. No native compiler job or runtime patch was performed by Root.
