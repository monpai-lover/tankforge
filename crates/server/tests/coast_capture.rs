use std::path::Path;

#[test]
fn server_loads_all_three_authored_coast_capture_points() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let maps = tg_server::server::load_points(&data);
    let coast = maps.get("coast").expect("coast enables conquest");
    let expected = [("A", -260.0, 100.0), ("B", -90.0, -360.0), ("C", 250.0, -100.0)];
    assert_eq!(coast.len(), expected.len());
    for (point, (id, x, z)) in coast.iter().zip(expected) {
        assert_eq!(point.id, id);
        assert_eq!((point.x, point.z, point.r), (x, z, 45.0));
    }
}
