#!/usr/bin/env python3
"""Export shared source terrain plus explicit three-front game road/deck work.

Run at repo root with numpy and pyproj available. No network requests are made.
Source DSM samples are terrain evidence, not a passability/airport certification.
Road widths, grading, bridge decks and company pads are explicit game authoring.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, Point, box
from shapely.strtree import STRtree

from korea_runtime_surfaces import hydro, roadbeds
from bridge_joint_geometry import attach as attach_bridge_joints

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "data/frontline/korea.json"
TO_METRIC = Transformer.from_crs("EPSG:4326", "EPSG:32652", always_xy=True)
TEAM = {"blue": 0, "red": 1}


def read(name):
    return json.loads((HERE / name).read_text())


def source_record(path):
    data = path.read_bytes()
    return {"file": str(path.relative_to(ROOT)), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def grid(array, bounds, origin, places=1):
    """Raster row zero is north. World +z is south, so retain row order."""
    height, width = array.shape
    west, south, east, north = map(float, bounds)
    cell_x, cell_z = (east-west)/width, (north-south)/height
    assert np.isfinite(array).all()
    return {"width": width, "height": height, "cellX": cell_x, "cellZ": cell_z,
            "x0": west-origin[0]+cell_x/2,
            "z0": origin[1]-north+cell_z/2,
            "heights": np.round(array.astype(float), places).reshape(-1).tolist()}


def bilinear(g, x, z):
    u = min(max((x-g["x0"])/g["cellX"], 0), g["width"]-1)
    v = min(max((z-g["z0"])/g["cellZ"], 0), g["height"]-1)
    i, j = int(u), int(v)
    ix, jz = min(i+1, g["width"]-1), min(j+1, g["height"]-1)
    tx, tz = u-i, v-j
    h = g["heights"]; w = g["width"]
    return ((h[j*w+i]*(1-tx)+h[j*w+ix]*tx)*(1-tz) +
            (h[jz*w+i]*(1-tx)+h[jz*w+ix]*tx)*tz)


def sample(terrain, x, z):
    """Normative scalar sampler; native and client must implement this order."""
    h = bilinear(terrain, x, z)
    for patch in terrain["patches"]:
        right = patch["x0"]+(patch["width"]-1)*patch["cellX"]
        bottom = patch["z0"]+(patch["height"]-1)*patch["cellZ"]
        if patch["x0"] <= x <= right and patch["z0"] <= z <= bottom:
            d = min(x-patch["x0"], right-x, z-patch["z0"], bottom-z)
            weight = min(max(d/patch["blendMeters"], 0), 1)
            h = h*(1-weight)+bilinear(patch, x, z)*weight
    roadbeds = terrain.get("roadbeds")
    if roadbeds:
        indices = roadbeds["cells"].get(f'{math.floor(x/roadbeds["cellSize"])},{math.floor(z/roadbeds["cellSize"])}', [])
        total = weighted = maximum = 0.0
        for index in indices:
            ax, az, ah, bx, bz, bh, half_width, blend = roadbeds["segments"][index]
            dx, dz = bx-ax, bz-az
            t = min(max(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz), 0), 1)
            distance = math.hypot(x-ax-dx*t, z-az-dz*t)
            weight = min(max(1-max(0, distance-half_width)/blend, 0), 1)
            total += weight
            weighted += weight*(ah+(bh-ah)*t)
            maximum = max(maximum, weight)
        if total:
            h = h*(1-maximum)+weighted/total*maximum
    for pad in terrain["pads"]:
        dx = abs(x-pad["center"][0])-pad["halfSize"][0]
        dz = abs(z-pad["center"][1])-pad["halfSize"][1]
        d = max(0, dx, dz)
        weight = min(max(1-d/pad["blendMeters"], 0), 1)
        h = h*(1-weight)+pad["height"]*weight
    for runway in terrain.get("runways", []):
        dx, dz = x-runway["center"][0], z-runway["center"][1]
        fx, fz = runway["forward"]
        lateral, longitudinal = dx*fz-dz*fx, dx*fx+dz*fz
        d = max(0, abs(lateral)-runway["halfSize"][0], abs(longitudinal)-runway["halfSize"][1])
        weight = min(max(1-d/runway["blendMeters"], 0), 1)
        h = h*(1-weight)+runway["height"]*weight
    return h


def clip_from_start(points, length):
    """Keep original road vertices and interpolate only the terminal road point."""
    result = [points[0]]
    for a, b in zip(points, points[1:]):
        segment = math.dist(a, b)
        if segment == 0:
            continue
        if length <= segment:
            result.append([a[i]+(b[i]-a[i])*length/segment for i in range(2)])
            return result
        result.append(b)
        length -= segment
    raise ValueError("Source road shorter than requested local corridor")


def segment_distance(a, b, c, d):
    """2D segment distance, including intersections between distant endpoints."""
    def point_distance(p, q, r):
        dx, dz = r[0]-q[0], r[1]-q[1]
        length2 = dx*dx+dz*dz
        t = min(max(((p[0]-q[0])*dx+(p[1]-q[1])*dz)/length2, 0), 1) if length2 else 0
        return math.hypot(p[0]-q[0]-t*dx, p[1]-q[1]-t*dz)
    ab, cd = [b[i]-a[i] for i in range(2)], [d[i]-c[i] for i in range(2)]
    det = ab[0]*cd[1]-ab[1]*cd[0]
    if abs(det) > 1e-12:
        ac = [c[i]-a[i] for i in range(2)]
        t = (ac[0]*cd[1]-ac[1]*cd[0])/det
        u = (ac[0]*ab[1]-ac[1]*ab[0])/det
        if 0 <= t <= 1 and 0 <= u <= 1:
            return 0
    return min(point_distance(a, c, d), point_distance(b, c, d),
               point_distance(c, a, b), point_distance(d, a, b))


def main():
    manifest = read("korea-geography-manifest.json")
    layout = json.loads((HERE.parent / "korea-layout-proposal.json").read_text())
    topology = read("korea-road-connectivity-study.json")
    backbone = read("korea-runtime-backbone.json")
    staging_study = read("korea-ground-staging-study.json")
    field_study = read("korea-airfield-native-study.json")
    cache = np.load(HERE / "korea-planning-dem.npz")
    bounds = cache["bounds"].tolist()
    origin = [(bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2]
    assert np.allclose(bounds, manifest["boundsMeters"])
    terrain = grid(cache["elevation"], bounds, origin)
    terrain.update(patches=[], pads=[])

    def xz(en):
        return [float(en[0])-origin[0], origin[1]-float(en[1])]

    def pos(en):
        x, z = xz(en)
        return [round(x, 4), round(sample(terrain, x, z), 4), round(z, 4)]

    source_files = [HERE / name for name in [
        "korea-planning-dem.npz", "korea-geography-manifest.json",
        "korea-road-routes.projected.json", "korea-road-connectivity-study.json",
        "korea-ground-staging-study.json", "korea-airfield-native-study.json",
        "korea-road-source-manifest.json", "korea-roads-centre-source.json.gz",
        "korea-runtime-backbone.json", "korea-runtime-water-source-manifest.json"]]
    source_files.extend(HERE / item["file"] for item in read("korea-runtime-water-source-manifest.json")["extracts"])
    source_files.extend(HERE / f"korea-roads-{lane}-source.json.gz" for lane in ["west", "east", "links"])
    # Small native30m windows preserve actual airport-area source detail. They are
    # observations, never runway flattening. 120m edge blending avoids a seam jump.
    for field in field_study["fields"]:
        identifier = field["id"]
        path = HERE / f"airfield-{identifier}-native-dem.npz"
        native = np.load(path)
        data = native["elevation"]
        west, south, east, north = native["bounds"]
        cell_x = float(east-west)/data.shape[1]
        cell_z = float(north-south)/data.shape[0]
        e, n = TO_METRIC.transform(*field["runwayCentreLonLat"])
        col = min(max(round((e-west)/cell_x-.5)-50, 0), data.shape[1]-101)
        row = min(max(round((north-n)/cell_z-.5)-50, 0), data.shape[0]-101)
        crop = data[row:row+101, col:col+101]
        crop_bounds = [west+col*cell_x, north-(row+101)*cell_z,
                       west+(col+101)*cell_x, north-row*cell_z]
        patch = grid(crop, crop_bounds, origin)
        patch.update(id=f"native-{identifier}", blendMeters=120,
                     sourceStatus="observed_native30m_DSM_not_runway_surface",
                     sourceMetadata=f"airfield-{identifier}-native-dem.json")
        terrain["patches"].append(patch)
        source_files.extend([path, HERE / patch["sourceMetadata"]])

    central = next(l for l in topology["lanes"] if l["lane"] == "centre")
    blue_road = clip_from_start(central["segments"][1]["coordinatesMeters"][::-1], 900)
    red_road = clip_from_start(central["segments"][2]["coordinatesMeters"], 900)
    local_en = blue_road[::-1] + red_road[1:]
    initial_staging = []
    for team, points, identifier in [(0, blue_road, "B-C2-TEST"), (1, red_road, "R-C2-TEST")]:
        center = xz(points[-1])
        elevation = round(sample(terrain, *center), 4)
        pad = {"id": identifier+"-PAD", "center": center, "halfSize": [70, 90],
               "height": elevation, "blendMeters": 120, "authored": True,
               "kind": "fictional_cleared_and_graded_company_test_pad",
               "sourceRoadDistanceToC2Meters": 900,
               "certification": "authored_runtime_test_surface_not_observed_clear_ground"}
        terrain["pads"].append(pad)
        target = xz(points[0])
        yaw = math.atan2(target[0]-center[0], target[1]-center[1])
        slots = []
        for i in range(10):
            x, z = center[0]+(i % 3-1)*22, center[1]+(i//3)*24-36
            slots.append({"index": i, "pos": [round(x, 4), elevation, round(z, 4)],
                          "yawRad": round(yaw, 7), "platoon": None if i == 0 else (i-1)//3})
        initial_staging.append({"id": identifier, "team": team, "lane": "centre",
            "battleNode": "C2", "pos": [round(center[0], 4), elevation, round(center[1], 4)],
            "radius": 80, "padId": pad["id"], "enabled": True,
            "sourceRoadDistanceToBattleMeters": 900, "spawnSlots": slots,
            "slotFootprintMeters": [5, 11],
            "certification": "explicit_fictional_pad_on_real_road_anchor; generic_nonoverlap_not_vehicle_or_enemy_fire_certification"})

    water, water_geometry, coverage, hydro_proof = hydro(backbone, terrain, origin, sample)
    physical, bridges, route_profiles, grading_proof = roadbeds(backbone, terrain, origin, sample, water, water_geometry)
    attach_bridge_joints(physical,bridges)
    terrain.update(roadbeds=physical, bridges=bridges, waterAreas=water)
    roads = []
    for route in route_profiles:
        source = route["source"]
        roads.append({"id": route["id"], "lane": route["lane"], "from": route["from"], "to": route["to"],
            "connected": True, "navEnabled": True, "halfWidth": 8,
            "status": "source_connected_road_with_explicit_authored_grading_and_decks",
            "lengthMeters": source["lengthMeters"], "points": route["points"],
            "roadbedSegments": route["segments"], "sourceWayIds": source["osmWays"],
            "bridgeWayIds": source["bridgeWays"], "sourceTrackWayIds": source["trackWays"],
            "physicalBridgeIds": [b["id"] for b in bridges if route["id"] in b["roadIds"]],
            "authored": True, "certification": "game_surface_proof_required_below; not_real_pavement_width_load_or_bridge_condition"})
    local_points = [pos(p) for p in local_en]
    local_road = {"id": "centre:C2-local-test", "lane": "centre", "from": "B-C2-TEST",
        "to": "R-C2-TEST", "connected": True, "navEnabled": False, "halfWidth": 8,
        "status": "source_road_subpath_with_explicit_fictional_graded_end_pads",
        "lengthMeters": round(sum(math.dist(a, b) for a, b in zip(local_en, local_en[1:])), 4),
        "points": local_points, "bridgeWayIds": [],
        "certification": "planning_DSM_runtime_test_corridor; real_world_surface_clearance_not_certified"}
    roads.append(local_road)
    for record in initial_staging:
        record.update(enabled=False, objectiveId="C2", roadId=local_road["id"], fixtureOnly="c2")

    staging = initial_staging[:]
    for record in staging_study["records"]:
        for anchor in record["staging"]:
            staging.append({"id": f"candidate-{anchor['team']}-{record['battleNode']}",
                "team": TEAM[anchor["team"]], "lane": record["lane"],
                "battleNode": record["battleNode"], "pos": pos(anchor["enMeters"]) if anchor["enMeters"] else None,
                "radius": 80, "padId": None, "enabled": False,
                "sourceRoadDistanceToBattleMeters": anchor.get("roadMetersToBattleAnchor"),
                "status": anchor["status"], "certification": "candidate_only_no_authored_clear_formation_pad"})

    # Each company pad is explicitly cleared/graded on its registered road. Never
    # infer a formation pad from an OSM point or permit a short implicit connector.
    wet_tree = STRtree(water_geometry)
    production_staging = []
    for lane in ["west", "centre", "east"]:
        for team, source_index in [(0, 1), (1, 2)]:
            route = next(p for p in route_profiles if p["lane"] == lane and p["from"].endswith(str(source_index)))
            points = [[p[0], p[2]] for p in route["points"]]
            # Both paths start at the battle node when walking towards the rear.
            walking = points[::-1] if team == 0 else points
            chosen = None
            for distance in sorted(range(800, 3201, 50), key=lambda value: abs(value-1200)):
                try:center = clip_from_start(walking, distance)[-1]
                except ValueError:continue
                footprint = box(center[0]-108, center[1]-125, center[0]+108, center[1]+125)
                if len(wet_tree.query(footprint, predicate="intersects")):continue
                if any(footprint.intersects(box(p["pos"][0]-118, p["pos"][2]-135, p["pos"][0]+118, p["pos"][2]+135)) for p in production_staging):continue
                chosen = center, distance
                break
            if chosen is None:
                raise ValueError(f"No dry authored ten-tank pad on {lane} team{team} within3.2km")
            center, distance = chosen
            elevation = round(sample(terrain, *center), 4)
            identifier = ("B" if team == 0 else "R")+"-"+lane.upper()+"-FRONT"
            pad = {"id": identifier+"-PAD", "center": center, "halfSize": [48, 65], "height": elevation,
                "blendMeters": 60, "authored": True, "kind": "fictional_cleared_and_graded_company_pad_on_registered_real_road",
                "sourceStatus": "full_core_and60m_grading_blend_screened_against_registered_hydro; land_use_not_surveyed"}
            terrain["pads"].append(pad)
            battle = walking[0]
            yaw = math.atan2(battle[0]-center[0], battle[1]-center[1])
            slots = [{"index": i, "pos": [round(center[0]+(i % 3-1)*22, 4), elevation, round(center[1]+(i//3)*24-36, 4)],
                "yawRad": round(yaw, 7), "platoon": None if i == 0 else (i-1)//3} for i in range(10)]
            deployment = {"id": identifier, "team": team, "lane": lane,
                "objectiveId": route["from"] if team == 0 else route["to"], "battleNode": lane[0].upper()+"2",
                "roadId": route["id"], "entryPoints": [], "pos": [round(center[0], 4), elevation, round(center[1], 4)],
                "radius": 60, "padId": pad["id"], "enabled": True, "sourceRoadDistanceToBattleMeters": distance,
                "spawnSlots": slots, "slotFootprintMeters": [5, 11],
                "certification": "explicit_fictional_dry_cleared_pad_on_real_road; building_clearance_and_real_land_use_not_surveyed"}
            staging.append(deployment);production_staging.append(deployment)

    objectives = []
    for lane in layout["lanes"]:
        source_lane = next(l for l in backbone["lanes"] if l["lane"] == lane["id"])
        for node in lane["nodes"]:
            snap = next(n for n in source_lane["controlNodeRoadSnaps"] if n["id"] == node["id"])
            original = TO_METRIC.transform(*node["lonLat"])
            objectives.append({"id": node["id"], "lane": lane["id"], "name": node["name"],
                "pos": pos(snap["enMeters"]), "owner": TEAM.get(node["initialOwner"]),
                "radius": node["captureRadiusMeters"], "activeInInitialScene": True,
                "referenceCentroidPos": pos(original), "centroidRoadGapMeters": round(snap["gapMeters"], 2),
                "sourceWayId": snap["way"],
                "sourceStatus": "fictional_W0_W1_relocated_to_connected_component_and_W2_to_actual_through_route" if node["id"] in ["W0", "W1", "W2"] else "fictional_objective_on_retained_actual_road",
                "rejectedStudyRoadAnchor": next((pos(n["enMeters"]) for l in topology["lanes"] for n in l["controlNodeRoadSnaps"] if n["id"] == node["id"]), None),
                "certification": "fictional_capture_zone_on_registered_game_road; no_centroid_gap_connector"})

    fields = []
    terrain["runways"] = []
    for field in layout["airfields"]:
        native = next(f for f in field_study["fields"] if f["id"] == field["id"])
        center_en = TO_METRIC.transform(*native["runwayCentreLonLat"])
        bearing = native["profiles"][0]["gridBearingDegrees"]
        angle = math.radians(bearing)
        length = field["proposedRunwayMeters"]
        ends = [[center_en[0]+side*math.sin(angle)*length/2,
                 center_en[1]+side*math.cos(angle)*length/2] for side in [-1, 1]]
        fields.append({"id": field["id"], "name": field["name"], "team": TEAM[field["team"]],
            "pos": pos(center_en), "sourceAirport": field.get("sourceAirport"),
            "kind": field["kind"], "enabled": False,
            "candidateRunway": {"lengthMeters": length, "widthMeters": 45,
                "gridBearingDegrees": bearing, "endpoints": [pos(p) for p in ends],
                "sourcePublishedLengthMeters": native["sourcePublishedRunwayMeters"],
                "authoredWidth": True, "graded": False, "operational": False},
            "certification": native["status"]})
        # Real airport reference points with explicitly fictional campaign construction.
        # This is shared authored geometry, never a claim that today's source strip is2600m.
        if field["id"] in ["B-E", "R-W"]:
            record = fields[-1]
            cx, height, cz = record["pos"]
            forward = [math.sin(angle), -math.cos(angle)]
            pad = {"id": field["id"], "center": [cx, cz], "forward": forward,
                "halfSize": [40, length/2+50], "height": height, "blendMeters": 120,
                "authored": True, "purpose": "fictional_campaign_airfield_earthworks"}
            terrain["runways"].append(pad)
            record["enabled"] = True
            record["name"] = ("蓝方抱川战役扩建机场" if field["id"] == "B-E" else "红方Taebukpo战役改建机场")
            record["runway"] = {"center": [cx, cz], "forward": forward, "height": height,
                "lengthMeters": length, "widthMeters": 45, "heading": math.atan2(*forward),
                "authored": True, "sourcePublishedLengthMeters": native["sourcePublishedRunwayMeters"]}
            record["certification"] = "game_authored_graded_runway_on_real_airport_reference; not_observed_real_expansion_or_engineering_certification"

    grades = []
    dense_grades = []
    for a, b in zip(local_points, local_points[1:]):
        length = math.hypot(b[0]-a[0], b[2]-a[2])
        if length > 0:
            grades.append(abs(b[1]-a[1])/length)
            count = max(1, math.ceil(length/5))
            samples = [(a[0]+(b[0]-a[0])*i/count, a[2]+(b[2]-a[2])*i/count) for i in range(count+1)]
            values = [sample(terrain, *p) for p in samples]
            dense_grades.extend(abs(y2-y1)/math.dist(p1, p2)
                                for p1, p2, y1, y2 in zip(samples, samples[1:], values, values[1:]))
    # A topology bridge list for an entire8–10km segment does not imply a bridge
    # on this1.8km subpath. Check all cached bridge centre-lines spatially here.
    bridge_checks = []
    import gzip
    for element in json.load(gzip.open(HERE / "korea-roads-centre-source.json.gz", "rt"))["elements"]:
        if element.get("tags", {}).get("bridge") not in ["yes", "viaduct"]:
            continue
        geometry = [xz(TO_METRIC.transform(q["lon"], q["lat"])) for q in element.get("geometry", [])]
        for p, q in zip(geometry, geometry[1:]):
            for a, b in zip(local_points, local_points[1:]):
                distance = segment_distance(p, q, [a[0], a[2]], [b[0], b[2]])
                if distance < 25:
                    bridge_checks.append({"way": element["id"], "distanceMeters": round(distance, 3)})
    assert not bridge_checks, f"Initial corridor unexpectedly intersects source bridge geometry: {bridge_checks}"

    route_audits = []
    for road in roads:
        if not road["navEnabled"]:
            continue
        road["points"] = [[p[0], round(sample(terrain, p[0], p[2]), 4), p[2]] for p in road["points"]]
        along = []
        across = []
        worst = None
        for a, b in zip(road["points"], road["points"][1:]):
            dx, dz = b[0]-a[0], b[2]-a[2]
            length = math.hypot(dx, dz)
            if length < .001:
                continue
            count = max(1, math.ceil(length/5))
            points = [(a[0]+dx*i/count, a[2]+dz*i/count) for i in range(count+1)]
            heights = [sample(terrain, *p) for p in points]
            for p, q, hp, hq in zip(points, points[1:], heights, heights[1:]):
                grade = abs(hq-hp)/math.dist(p, q)*100
                along.append(grade)
                if worst is None or grade > worst["gradePercent"]:
                    worst = {"gradePercent": grade, "start": [p[0], hp, p[1]],
                        "end": [q[0], hq, q[1]], "yawRad": math.atan2(dx, dz)}
            nx, nz = -dz/length, dx/length
            for p in points:
                across.append(abs(sample(terrain, p[0]+nx*1.7, p[1]+nz*1.7)-sample(terrain, p[0]-nx*1.7, p[1]-nz*1.7))/3.4*100)
        audit = {"roadId": road["id"], "sampleSpacingMeters": 5, "trackHalfSpanMeters": 1.7,
            "maximumAlongGradePercent": round(max(along), 5), "maximumCrossGradePercent": round(max(across), 5),
            "worstNativeProbe": worst, "sampleCount": len(along)}
        if max(along) > 15 or max(across) > 15:
            raise ValueError(f"Authored route fails game15% surface grade envelope: {audit}")
        road["surfaceProof"] = audit
        route_audits.append(audit)

    result = {"schemaVersion": 1, "id": "korea", "name": "三八线 · 西中东三线推进战区",
        "status": "three_real_road_fronts_with_authored_game_surfaces_not_full_offroad_navigation",
        "coordinateFrame": {"sourceCrs": "EPSG:32652", "originE": origin[0], "originN": origin[1],
            "sourceBoundsEN": bounds, "x": "easting-originE", "z": "originN-northing",
            "y": "elevation_metres", "north": "negative_z", "gridSamples": "source_pixel_centres",
            "rowOrder": "north_first_then_increasing_world_z", "heightQuantizationMeters": 0.1},
        "bounds": {"minX": -50000, "maxX": 50000, "minZ": -60000, "maxZ": 60000},
        "terrain": terrain, "roads": roads, "objectives": objectives, "staging": staging,
        "campaign": {"captureSeconds": 30, "pressureTicketSeconds": 10,
            "supplyEntrypoints": [["W0", "C0", "E0"], ["W4", "C4", "E4"]],
            "terminalObjectives": [["W4", "C4", "E4"], ["W0", "C0", "E0"]],
            "scope": "All15 fictional objectives on three real cached road backbones with explicitly authored game grading/decks and six dry company sources; unregistered off-road ground remains closed.",
            "capture": "Only living accepted ground bodies; contested zones halt; at most3 bodies raise capture speed to1.5x; hostile ownership remains until neutralised.",
            "pressure": "Only supplied advances beyond initial ownership create lane pressure; each10 advantage-seconds costs one opponent readiness point."},
        "airfields": fields,
        "airspawns": [{"id": s["id"], "team": TEAM[s["team"]],
            "pos": (lambda p: [p[0], max(2000, p[1]+1500), p[2]])(pos(TO_METRIC.transform(*s["lonLat"]))),
            "enabled": s["id"] in ["BA-E", "RA-W"],
            "status": "fictional_rear_air_start" if s["id"] in ["BA-E", "RA-W"] else "disabled_candidate"} for s in layout["airspawns"]],
        "initialScene": {"id": "korea-three-front-campaign", "objectiveIds": [o["id"] for o in objectives],
            "stagingIds": [s["id"] for s in production_staging], "aiStagingIds": [s["id"] for s in production_staging],
            "roadIds": [r["id"] for r in roads if r["navEnabled"]], "roadId": "centre:C1-C2",
            "companySize": 10, "aiPlatoons": 3, "tanksPerAiPlatoon": 3,
            "authoredChanges": "Six96x130m cleared company pads,16m-wide graded game roads, explicitly rebuilt decks/culverts and two2600x45m fictional runways. WestW0/W1 moved to the actualW2-W4 component; WestW2 moved from a shareddeadend spur to the actualW1-W3 through-road; no oldgap shortcut.",
            "notCertified": "Original street widths/bridge loads/road condition/real land use/bare-earth clearance/engineering feasibility are not surveyed. Single-valued bridge top terrain does not model under-deck traffic.",
            "planningTerrainMaximumVertexGradePercent": round(max(grades)*100, 3),
            "planningTerrainMaximum5mSampleGradePercent": round(max(dense_grades)*100, 3),
            "mappedBridgeSegmentsWithin25mOfLocalSubpath": len(bridge_checks)},
        "fixtures": {"c2": {"purpose": "Explicit legacy boundedC2 domain/air/service test scene, never the production default",
            "initialScene": {"id": "centre-c2-company-test", "objectiveIds": ["C2"],
                "stagingIds": [s["id"] for s in initial_staging], "aiStagingIds": [s["id"] for s in initial_staging],
                "roadId": local_road["id"], "roadIds": [local_road["id"]]},
            "campaign": {"supplyEntrypoints": [["C2"], ["C2"]], "terminalObjectives": [[], []]},
            "roadOverrides": [{"id": local_road["id"], "navEnabled": True}],
            "stagingOverrides": [{"id": s["id"], "enabled": True} for s in initial_staging]}},
        "navigation": {"surfacePolicy": "registered_road_cores_and_enabled_pad_cores_only; shoulders_and_unregistered_offroad_are_not_navigation",
            "hydroCoverage": coverage, "outsideHydroCoverage": "unknown_fail_closed",
            "wetRule": "outer_ring_inclusive_and_not_hole_strict_interior; boundary_is_wet",
            "deckRule": "each_wet_footprint_probe_requires_listed_bridge_segment_core_and_canonical_height_at_least_water_level_plus2m",
            "rejectedStudyEdges": [{"id": "west:W1-W2", "status": "original_study_nearest_snaps_had_no_source_path",
                "resolution": "originalsnapgap_not_connected; fictionalW0_W1_relocated_to_different_actual_connected_backbone"}],
            "hydroProof": hydro_proof, "gradingProof": grading_proof, "routeSurfaceProofs": route_audits},
        "sampling": {"base": "bilinear clamp((x-x0)/cellX,(z-z0)/cellZ) on row-major heights",
            "patches": "In array order and inside each sample rectangle: d=min(x-x0,lastX-x,z-z0,lastZ-z); w=clamp(d/blendMeters,0,1); h=h*(1-w)+bilinear(patch)*w",
            "roadbeds": "After native patches: get candidates cells[floor(x/cellSize)+','+floor(z/cellSize)]; segment[ax,az,ah,bx,bz,bh,halfWidth,blend]. t=clamp(dot(point-a,b-a)/lengthSquared,0,1),d=distanceToProjection,w=clamp(1-max(0,d-halfWidth)/blend,0,1); sumW,sum(w*lerpHeight),maxW. If sumW>0 h=h*(1-maxW)+sumH/sumW*maxW. Cells contain unique ascending segment indices.",
            "pads": "After patches in array order: d=max(0,abs(x-cx)-halfX,abs(z-cz)-halfZ); w=clamp(1-d/blendMeters,0,1); h=h*(1-w)+pad.height*w",
            "runways": "After pads in array order: dx=x-cx,dz=z-cz; lateral=dx*fz-dz*fx;longitudinal=dx*fx+dz*fz;d=max(0,abs(lateral)-halfX,abs(longitudinal)-halfZ); same blend as pads",
            "rule": "Client draw mesh, vehicle Ground queries and projectile terrain contacts must use exactly this JSON and sequence; no extra client grading."},
        "provenance": {"sources": [source_record(p) for p in source_files],
            "terrain": manifest["attribution"], "terrainLicense": manifest["licenseSource"],
            "roads": topology["attribution"], "roadLicense": topology["license"],
            "limitations": ["Planning DSM is approximately200m and includes vegetation/buildings, not bare earth.",
                "Native airport patches are cropped30m DSM observations, not runway/obstacle certification.",
                "Hydro coverage is bounded to the three road-front neighborhoods; missing water evidence never grants off-road navigation. Source water polygons plus explicitly conservative game stream buffers are not a hydrographic survey.",
                "OriginalW1-W2 nearest-study-snap gap remains rejected. FictionalW0/W1 capture locations were explicitly moved ontoW2-W4's real connected source component; no straight-gap connector is added.",
                "Road grading,16m width, new/rebuilt bridge decks/culverts and water-plane levels are explicit fictional game construction. PlanningDSM is not bare earth and construction feasibility is not certified.",
                "All deployment ownership, objectives and cleared grading pads are fictional game authoring.",
                "Taiwan full-main-island theatre remains required separately; this asset contains Korea only."]}}
    probe_points = [(terrain["x0"], terrain["z0"]), (0, 0)]
    for patch in terrain["patches"]:
        probe_points.append((patch["x0"]+1500, patch["z0"]+1500))
        probe_points.append((patch["x0"]+60, patch["z0"]+1500))
    for pad in terrain["pads"]:
        cx, cz = pad["center"]
        probe_points.extend([(cx, cz), (cx+pad["halfSize"][0]+60, cz)])
    for pad in terrain["runways"]:
        cx, cz = pad["center"]; fx, fz = pad["forward"]
        for lateral, longitudinal in [(0,0),(0,1250),(40,0),(100,0),(160,0)]:
            probe_points.append((cx+fx*longitudinal+fz*lateral, cz+fz*longitudinal-fx*lateral))
    for road in roads:
        if not road["navEnabled"]:
            continue
        for a, b in list(zip(road["points"], road["points"][1:]))[::max(1, len(road["points"])//5)]:
            dx, dz = b[0]-a[0], b[2]-a[2]
            length = math.hypot(dx, dz)
            if length > .001:
                x, z = (a[0]+b[0])/2, (a[2]+b[2])/2
                probe_points.extend([(x, z), (x-dz/length*8, z+dx/length*8), (x-dz/length*20, z+dx/length*20)])
    result["sampling"]["validationProbes"] = [
        {"x": round(x, 6), "z": round(z, 6),
         "height": round(sample(terrain, round(x, 6), round(z, 6)), 6)} for x, z in probe_points]
    from prove_runtime_korea_navigation import prove
    admission = prove(result, sample)
    if not admission["passes"]:
        raise ValueError(f'Authored navigation fails wet/footprint proof: {admission["failures"]}')
    result["sampling"]["wetValidationProbes"] = admission["wetValidationProbes"]
    result["navigation"]["surfaceAdmissionProof"] = {k: v for k, v in admission.items() if k not in ["wetValidationProbes", "roads"]}
    assert terrain["width"] == 512 and terrain["height"] == 614
    assert len(terrain["heights"]) == 512*614
    assert len([r for r in roads if r["connected"] and r["navEnabled"]]) == 12
    assert len(production_staging) == 6
    assert len(objectives) == 15
    for deployment in initial_staging+production_staging:
        slots = deployment["spawnSlots"]
        assert len(slots) == 10
        for slot in slots:
            x, y, z = slot["pos"]
            assert abs(sample(terrain, x, z)-y) < 0.0001
        for i, a in enumerate(slots):
            for b in slots[i+1:]:
                assert math.dist([a["pos"][0], a["pos"][2]], [b["pos"][0], b["pos"][2]]) >= 22
    for i, deployment in enumerate(production_staging):
        for other in production_staging[i+1:]:
            assert math.dist(deployment["pos"], other["pos"]) >= 300
    OUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)+"\n"
    assert len(serialized.encode()) <= 5*1024*1024, "Keep full3-front source terrain and proof bounded below5MiB"
    temporary = OUT.with_suffix(".json.tmp")
    temporary.write_text(serialized)
    temporary.replace(OUT)
    pinned_admission={**admission,"sourceMapSha256":hashlib.sha256(OUT.read_bytes()).hexdigest()}
    (HERE/"korea-runtime-navigation-proof.json").write_text(json.dumps(pinned_admission, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({"file": str(OUT.relative_to(ROOT)), "bytes": OUT.stat().st_size,
        "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
        "baseGrid": [terrain["width"], terrain["height"]],
        "nativePatches": len(terrain["patches"]), "sourceRoadSegments": len(roads)-1,
        "enabledSceneRoadMeters": sum(r["lengthMeters"] for r in roads if r["navEnabled"]),
        "initialDeployments": [{k: s[k] for k in ["id", "team", "pos"]} for s in production_staging],
        "maximumLocal5mSampleGradePercent": result["initialScene"]["planningTerrainMaximum5mSampleGradePercent"]}, indent=2))


if __name__ == "__main__":
    main()
