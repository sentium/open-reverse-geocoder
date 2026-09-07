# PyShp compatibility fixture

These four synthetic records use the N03 2024+ field names. Their rectangular
geometries are test data, not actual administrative boundaries. The fixture was
written once with PyShp 2.3.1 on Python 3.12.8; tests read the committed bytes and
never regenerate them with the installed PyShp version.

`baseline.json` records each input file's SHA-256, the records read by PyShp 2.3.1,
and the GeoJSON features produced by the pre-update generator at main
`eb570d8908d4474008461bfc9bc7be6f43f58c3c`.

The records cover UTF-8 Japanese names, a leading-zero municipal code, a county,
a designated-city ward, an unassigned area, a Polygon, and a MultiPolygon with a
hole and a separate exterior ring. The last record includes enclosing tabs and
ideographic spaces around the prefecture, unassigned-area name, and code.

PyShp 3 preserves enclosing DBF whitespace that 2.3.1 removed. The record test
compares normalized text; the conversion test compares all IDs, names, geometry
types, ring structure, and coordinates directly with the old GeoJSON baseline.
The invalid-UTF-8 test corrupts a copy and checks that decoding fails instead of
silently replacing bytes. PyShp 3 reports this as a ShapefileException subclass,
where 2.3.1 raised UnicodeDecodeError.
