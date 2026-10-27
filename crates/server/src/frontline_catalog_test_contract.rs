//! Exact source roster contract: preserve all original aircraft and admit only
//! the two explicitly inherited export variants introduced by R7.
pub(crate) fn assert_ids<'a>(ids: impl IntoIterator<Item = &'a str>) {
    use std::collections::BTreeSet;
    let original = [
        "nf01", "nf02", "p51d", "bf109g", "spitfire9", "mig15", "f86f",
        "f104g", "mig21", "fw190a8", "yak9u", "a6m2", "f4u1d", "me262",
        "hunter6", "mig17f", "mirage3e", "f4e", "f15c", "mig29", "f16v",
        "su27", "a10a", "su25", "me262a2a", "me262u4",
    ];
    let expected: BTreeSet<_> = original.into_iter()
        .chain(["su27skm", "mig29smt"])
        .collect();
    assert_eq!(ids.into_iter().collect::<BTreeSet<_>>(), expected);
}
