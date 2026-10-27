use super::*;
use serde_json::json;

fn reference(id: u64, life: u64) -> Value {
    json!({"battle":7,"unit":id,"life":life})
}
fn frame(tick: u64) -> Value {
    // Codec fixtures deliberately own no simulation. Exact source numeric types
    // matter here: native f32 buffers versus true f64 ground coordinates.
    json!({"op":"frame","battle":7,"tick":tick,
        "units":[{"unit":reference(1,1),"vehicle":"su_t72a","team":"blue","company":1,
            "controller":1,"epoch":3,"alive":true,"pos":[1000.123456789f64,3.0,-2000.123456789f64],
            "yaw":-0.0f64,"turret_yaw":0.3f64,"gun_pitch":-0.02f64,"ammo":22,"ammo_revision":2,
            "caps":{"can_move":true,"can_fire":true,"drive_power":0.81f64},
            "damage":{"modules":{"engine":{"health":0.81f64}},"crew":4},
            "net":{"pos":[0.1f32,3.0f32,-2000.5f32],"ex":[1.0f32,0.0,0.0],
                "ez":[0.0f32,0.0,1.0],"rg":{"version":1,"q":[0.123456789f64,0.234567891],"qv":[0.00123456789f64,0.0]}},
            "navigation":{"route":"centre:C2","status":"moving"}}],
        "aircrafts":[{"unit":reference(2,1),"aircraft":"me262","loadout":1,
            "controller":null,"owner":1,"epoch":2,"alive":true,"pos":[100.0f64,1800.0,-300.0],
            "state":vec![0.1f32;80],"aero":vec![0.0f32;48],"resource_revision":3,
            "guns":[{"id":"mk108:0","ammo":99}],"fuel":{"kg":1700.123456789f64},
            "stores":[{"id":"r4m","count":1,"gone":false}],"damage":{"fire":0.0f64},
            "service":{"status":"idle","elapsed_s":0.0f64,"revision":0}}],
        "companies":[{"id":1,"owner":1,"orders":[],"units":[reference(1,1)]}],
        "readiness":[1000,990],"objectives":[{"id":"C2","owner":"blue","progress":1.0f64}],
        "staging":[],"events":[]})
}
fn next_frame(old: &Value) -> Value {
    let mut f = old.clone();
    f["tick"] = json!(old["tick"].as_u64().unwrap() + 1);
    f["units"][0]["pos"][0] = json!(1000.128456789f64);
    f["units"][0]["yaw"] = json!(0.0f64);
    f["units"][0]["ammo"] = json!(21);
    f["units"][0]["ammo_revision"] = json!(3);
    f["units"][0]["damage"]["modules"]["engine"]["health"] = json!(0.73f64);
    f["units"][0]["navigation"] = json!({"status":"blocked","reason":"bridge_closed"});
    f["aircrafts"][0]["state"][23] = json!(120.008331298828125f64);
    f["aircrafts"][0]["aero"][38] = json!(0.0027777778f32);
    f["aircrafts"][0]["guns"][0]["ammo"] = json!(98);
    f["aircrafts"][0]["resource_revision"] = json!(4);
    f["events"] = json!([{"kind":"shot","shooter":reference(2,1),"target":null,
        "detail":{"shot_id":"air:7:2:1:4","ammo_revision":4},"pos":[100.0f64,1800.0,-295.0]}]);
    f
}
fn roundtrip(encoder: &mut FrameEncoder, decoder: &mut FrameDecoder, f: &Value) -> Vec<u8> {
    let bytes = encoder.encode_value(f).unwrap();
    let decoded = decoder.decode(&bytes).unwrap();
    assert!(identical(&decoded, f), "Exact frame changed in wire codec");
    bytes
}

#[test]
fn full_delta_roundtrip_retains_exact_native_floats_resources_damage_and_events() {
    let mut encoder = FrameEncoder::new(501);
    let mut decoder = FrameDecoder::default();
    let first = frame(10);
    let second = next_frame(&first);
    let full = roundtrip(&mut encoder, &mut decoder, &first);
    let delta = roundtrip(&mut encoder, &mut decoder, &second);
    assert!(FrameHeader::read(&full).unwrap().full);
    let h = FrameHeader::read(&delta).unwrap();
    assert!(!h.full);
    assert_eq!((h.battle, h.tick, h.base_tick), (7, 11, 10));
    assert!(
        delta.len() < full.len() / 2,
        "Sparse fixture must actually use its baseline"
    );
    let mut third = second.clone();
    third["tick"] = json!(12);
    // Identical consecutive events are still delivered in each reconstructed
    // frame, followed by the explicit empty next event batch.
    let repeat = roundtrip(&mut encoder, &mut decoder, &third);
    let repeated = third.clone();
    third["tick"] = json!(13);
    third["events"] = json!([]);
    let empty = roundtrip(&mut encoder, &mut decoder, &third);
    assert_eq!(decoder.baseline.as_ref().unwrap()["events"], json!([]));
    if let Ok(directory) = std::env::var("TANKFORGE_WIRE_FIXTURE_DIR") {
        let directory = std::path::Path::new(&directory);
        std::fs::create_dir_all(directory).unwrap();
        let mut fourth = third.clone();
        fourth["tick"] = json!(14);
        let delta2 = encoder.encode_value(&fourth).unwrap();
        encoder.force_reset();
        let reset = encoder.encode_value(&fourth).unwrap();
        for (name, bytes) in [
            ("full.bin", full),
            ("delta.bin", delta),
            ("repeat.bin", repeat),
            ("empty.bin", empty),
            ("delta2.bin", delta2),
            ("reset.bin", reset),
        ] {
            std::fs::write(directory.join(name), bytes).unwrap();
        }
        std::fs::write(
            directory.join("expected.json"),
            serde_json::to_vec(&json!({"full":first,"delta":second,"repeat":repeated,"empty":third,"delta2":fourth,"reset":fourth})).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn packed_float_arrays_and_scalar_xor_remain_lossless_without_integer_coercion() {
    for (value, wanted_tag) in [
        (json!(0.1f32), 10),
        (json!(0.1f64), 5),
        (json!([-0.0f32, f32::from_bits(1), f32::MAX]), 11),
        (json!([0.1f64, f64::from_bits(1), f64::MAX]), 12),
        (json!([1, 2, 3]), 8),
    ] {
        let mut symbols = Symbols::default();
        let mut bytes = Vec::new();
        super::value(&value, &mut symbols, &mut bytes, &mut Budget::default(), 0).unwrap();
        assert_eq!(bytes[0], wanted_tag);
        let mut reader = Reader {
            bytes: &bytes,
            offset: 0,
            budget: Budget::default(),
        };
        assert!(identical(
            &reader.value(&mut Symbols::default(), 0).unwrap(),
            &value
        ));
    }
    let a = json!(0.123456789012345f64);
    let b = json!(f64::from_bits(a.as_f64().unwrap().to_bits() + 1));
    let mut symbols = Symbols::default();
    let mut bytes = Vec::new();
    patch(&a, &b, &mut symbols, &mut bytes, &mut Budget::default(), 0).unwrap();
    assert_eq!(
        bytes[0], 5,
        "Adjacent native f64 must use exact XOR rather than quantization"
    );
    let mut reader = Reader {
        bytes: &bytes,
        offset: 0,
        budget: Budget::default(),
    };
    let mut result = a;
    reader
        .patch(&mut result, &mut Symbols::default(), 0)
        .unwrap();
    assert!(identical(&result, &b));
}

#[test]
fn dictionary_threshold_resets_atomically_and_stale_forced_ticks_are_rejected() {
    let mut e = FrameEncoder::new(8);
    let mut d = FrameDecoder::default();
    let f = frame(10);
    roundtrip(&mut e, &mut d, &f);
    while e.symbols.values.len() < MAX_SYMBOLS {
        e.symbols
            .intern(&format!("threshold-test-{}", e.symbols.values.len()))
            .unwrap();
    }
    let mut next = next_frame(&f);
    next["brand_new_symbol"] = json!("exhausts_previous_dictionary");
    let reset = roundtrip(&mut e, &mut d, &next);
    let h = FrameHeader::read(&reset).unwrap();
    assert!(h.full);
    assert_eq!(h.epoch, 2);
    assert!(e.symbols.values.len() < MAX_SYMBOLS);
    e.force_reset();
    assert!(
        e.encode_value(&f).is_err(),
        "A forced reset cannot move the same battle backward"
    );
    roundtrip(&mut e, &mut d, &next);
}

#[test]
fn float_bit_identity_signed_zero_subnormal_and_integer_boundaries_survive() {
    let mut f = frame(10);
    let mut numbers = Vec::new();
    for n in [
        0.0f64,
        -0.0,
        f64::MIN_POSITIVE,
        f64::from_bits(1),
        f64::MAX,
        -f64::MAX,
        f32::from_bits(1) as f64,
        f32::MAX as f64,
        0.1f32 as f64,
        0.1f64,
    ] {
        numbers.push(json!(n));
    }
    numbers.extend([
        json!(MAX_JS_INTEGER),
        json!(-(MAX_JS_INTEGER as i64)),
        json!(0),
    ]);
    f["numeric_contract"] = json!(numbers);
    let mut e = FrameEncoder::new(1);
    let mut d = FrameDecoder::default();
    roundtrip(&mut e, &mut d, &f);
    f["tick"] = json!(11);
    f["numeric_contract"][0] = json!(-0.0f64);
    f["numeric_contract"][1] = json!(0.0f64);
    roundtrip(&mut e, &mut d, &f);
    assert_eq!(
        d.baseline.as_ref().unwrap()["numeric_contract"][0]
            .as_f64()
            .unwrap()
            .to_bits(),
        (-0.0f64).to_bits()
    );
    f["tick"] = json!(12);
    f["unsafe_integer"] = json!(MAX_JS_INTEGER + 1);
    assert!(matches!(
        e.encode_value(&f),
        Err(WireError::Limit("unsafe JavaScript integer"))
    ));
    f.as_object_mut().unwrap().remove("unsafe_integer");
    roundtrip(&mut e, &mut d, &f);
}

#[test]
fn dropped_delta_requires_reset_without_corrupting_dictionary_or_accepted_frame() {
    let mut e = FrameEncoder::new(2);
    let mut d = FrameDecoder::default();
    let first = frame(1);
    let second = next_frame(&first);
    let mut third = next_frame(&second);
    third["new_dictionary_field"] = json!("not_seen_by_receiver");
    let full = roundtrip(&mut e, &mut d, &first);
    let missing = e.encode_value(&second).unwrap();
    let received = e.encode_value(&third).unwrap();
    assert!(matches!(
        d.decode(&received),
        Err(WireError::ResyncRequired(_))
    ));
    assert!(identical(d.baseline.as_ref().unwrap(), &first));
    assert!(identical(&d.decode(&missing).unwrap(), &second));
    assert!(identical(&d.decode(&received).unwrap(), &third));
    assert!(matches!(d.decode(&full), Err(WireError::ResyncRequired(_))));
    e.force_reset();
    let reset = roundtrip(&mut e, &mut d, &third);
    assert_eq!(FrameHeader::read(&reset).unwrap().epoch, 2);
    assert!(matches!(
        d.decode(&received),
        Err(WireError::ResyncRequired(_))
    ));
    assert!(matches!(
        d.decode(&reset),
        Err(WireError::ResyncRequired(_))
    ));
}

#[test]
fn cross_room_socket_and_life_transitions_never_reuse_other_unit_state() {
    let mut e = FrameEncoder::new(3);
    let mut d = FrameDecoder::default();
    let mut f = frame(1);
    roundtrip(&mut e, &mut d, &f);
    f["tick"] = json!(2);
    f["units"][0] = json!({"unit":reference(1,2),"ammo":4,"damage":{"engine":"newlife"},"controller":null,"epoch":0});
    roundtrip(&mut e, &mut d, &f);
    assert!(
        d.baseline.as_ref().unwrap()["units"][0]
            .get("caps")
            .is_none(),
        "A new life cannot inherit old caps"
    );
    f["tick"] = json!(3);
    f["aircrafts"] = json!([]);
    roundtrip(&mut e, &mut d, &f);
    f["battle"] = json!(8);
    f["tick"] = json!(0);
    f["units"][0]["unit"]["battle"] = json!(8);
    let reset = roundtrip(&mut e, &mut d, &f);
    assert!(FrameHeader::read(&reset).unwrap().full);
    let mut other = FrameEncoder::new(4);
    let replacement = other.encode_value(&f).unwrap();
    assert!(matches!(
        d.decode(&replacement),
        Err(WireError::ResyncRequired("socket stream changed"))
    ));
    d.clear();
    assert!(identical(&d.decode(&replacement).unwrap(), &f));
    f["units"][0]["unit"]["battle"] = json!(7);
    assert!(matches!(
        other.encode_value(&f),
        Err(WireError::Invalid("cross-battle/duplicate unit identity"))
    ));
}

#[test]
fn truncated_malformed_or_duplicate_packets_commit_no_partial_changes() {
    let mut e = FrameEncoder::new(5);
    let mut d = FrameDecoder::default();
    let f = frame(1);
    let full = roundtrip(&mut e, &mut d, &f);
    let next = next_frame(&f);
    let delta = e.encode_value(&next).unwrap();
    for end in 0..delta.len() {
        assert!(
            d.decode(&delta[..end]).is_err(),
            "Truncation {end} accepted"
        );
        assert!(identical(d.baseline.as_ref().unwrap(), &f));
    }
    let mut trailing = delta.clone();
    trailing.push(0);
    assert!(d.decode(&trailing).is_err());
    let mut poison = delta[..HEADER_BYTES].to_vec();
    let mut symbols = e.symbols.clone();
    poison.push(2);
    varint(1, &mut poison);
    string("fresh_poison_key", &mut symbols, &mut poison).unwrap();
    poison.push(99);
    assert!(d.decode(&poison).is_err());
    assert!(!d.symbols.ids.contains_key("fresh_poison_key"));
    assert!(identical(&d.decode(&delta).unwrap(), &next));
    assert!(matches!(d.decode(&full), Err(WireError::ResyncRequired(_))));
    let mut duplicate = next.clone();
    duplicate["tick"] = json!(3);
    duplicate["aircrafts"][0]["unit"] = duplicate["units"][0]["unit"].clone();
    assert!(e.encode_value(&duplicate).is_err());
    let mut not_frame = next.clone();
    not_frame["op"] = json!("snapshot");
    assert!(e.encode_value(&not_frame).is_err());
}

#[test]
fn consumer_mutation_and_resync_do_not_mutate_authority_or_grant_resources() {
    let mut e = FrameEncoder::new(6);
    let mut d = FrameDecoder::default();
    let f = frame(1);
    let packet = e.encode_value(&f).unwrap();
    let mut consumer = d.decode(&packet).unwrap();
    consumer["units"][0]["ammo"] = json!(999);
    consumer["aircrafts"][0]["damage"] = json!({"repaired":true});
    let mut next = f.clone();
    next["tick"] = json!(2);
    assert!(identical(
        &d.decode(&e.encode_value(&next).unwrap()).unwrap(),
        &next
    ));
    e.force_reset();
    let reset = e.encode_value(&next).unwrap();
    assert!(identical(&d.decode(&reset).unwrap(), &next));
    assert_eq!(next["units"][0]["ammo"], 22);
    assert_eq!(next["aircrafts"][0]["guns"][0]["ammo"], 99);
}

#[test]
fn depth_noncanonical_varints_and_oversized_payloads_fail_closed() {
    let mut e = FrameEncoder::new(7);
    let mut f = frame(1);
    let mut nested = json!(0);
    for _ in 0..MAX_DEPTH + 2 {
        nested = json!([nested]);
    }
    f["nested"] = nested;
    assert!(matches!(e.encode_value(&f), Err(WireError::Limit(_))));
    let mut reader = Reader {
        bytes: &[128, 0],
        offset: 0,
        budget: Budget::default(),
    };
    assert!(reader.varint().is_err());
    let mut reader = Reader {
        bytes: &[255; 10],
        offset: 0,
        budget: Budget::default(),
    };
    assert!(reader.varint().is_err());
    let bytes = vec![0; MAX_FRAME_BYTES + 1];
    assert!(FrameHeader::read(&bytes).is_err());
    let mut e = FrameEncoder::new(0);
    assert!(e.encode_value(&frame(1)).is_err());
}
