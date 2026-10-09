#!/usr/bin/env python3
"""Rebuild only the two original procedural Hetzers; preserve archived GLB variants."""
import pathlib
import gen_vehicles as gen


def main():
    for variant in ("jagd", "flak"):
        spec = gen.hetzer(variant)
        problems = gen.write_vehicle(spec)
        if problems:
            raise RuntimeError(f"{spec['id']}: {problems}")
        root = pathlib.Path(gen.DATA) / "vehicles" / spec["id"]
        for name in ("vehicle", "armor", "weapons", "engine", "crew", "modules", "visual"):
            target = root / f"{name}.json"
            # Keep the repository's LF convention even when authoring on Windows.
            target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n"))
        print(f"Built {spec['id']}")


if __name__ == "__main__":
    main()
