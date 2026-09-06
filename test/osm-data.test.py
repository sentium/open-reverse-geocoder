import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from shapely.geometry import shape

spec = importlib.util.spec_from_file_location('osm_builder', Path(__file__).parents[1] / 'bin/build-osm-data.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def polygon(w, s, e, n):
    return {'type':'Polygon', 'coordinates':[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}


class OsmDataTest(unittest.TestCase):
    def test_categories_and_road_width(self):
        self.assertEqual(builder.category({'highway':'services'}), 'sa')
        self.assertEqual(builder.category({'highway':'rest_area'}), 'pa')
        self.assertEqual(builder.category({'tourism':'viewpoint'}), 'viewpoint')
        self.assertIsNone(builder.category({'railway':'station','disused':'yes'}))
        self.assertIsNone(builder.category({'railway':'station','station':'freight'}))
        self.assertAlmostEqual(builder.road_width({'width':'30 ft'}),9.14)
        self.assertEqual(builder.road_width({'lanes':'3'}),10.5)

    def test_dateline_and_hole(self):
        g = builder.normalize_geojson(polygon(179,10,-179,12))
        self.assertTrue(g.covers(builder.Point(179.5,11)))
        self.assertTrue(g.covers(builder.Point(-179.5,11)))
        self.assertFalse(g.covers(builder.Point(0,11)))
        p=polygon(-78,38,-76,40)
        p['coordinates'].extend(polygon(-77.2,38.5,-77,39)['coordinates'])
        g=builder.normalize_geojson(p)
        self.assertFalse(g.covers(builder.Point(-77.1,38.7)))

    def test_stream_build_ids_shards_clipping_and_immutable_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            coverage=polygon(-78,38,-76,40)
            region={'type':'Feature','properties':{'id':'test-us','iso3166-1:alpha2':['US']},'geometry':coverage}
            regionfile=root/'region.json';regionfile.write_text(json.dumps(region))
            country={'type':'Feature','geometry':coverage,'properties':{'@id':1,'@type':'relation','boundary':'administrative','admin_level':'2','name':'United States','ISO3166-1:alpha2':'US'}}
            station={'type':'Feature','geometry':{'type':'Point','coordinates':[-77.006,38.897]},'properties':{'@id':2,'@type':'node','railway':'station','name':'Union Station'}}
            road={'type':'Feature','geometry':{'type':'LineString','coordinates':[[-77.1,38.9],[-76.9,38.9]]},'properties':{'@id':3,'@type':'way','highway':'motorway'}}
            sequence=root/'input.jsonseq';sequence.write_text('\n'.join(json.dumps(v) for v in [country,station,station,road]))
            m=builder.build(sequence,regionfile,root/'output','v1','fixture')
            self.assertEqual(m['stats']['points'],1)
            self.assertGreater(m['stats']['roads'],1)
            self.assertEqual(m['stats']['country:US'],1)
            for f in (root/'output/test-us/v1/road/14').glob('*/*.json'):
                cell=builder.tile_box(int(f.parent.name),int(f.stem),14)
                for width,coordinates in json.loads(f.read_text())['roads']:
                    self.assertTrue(cell.buffer(1e-10).covers(builder.LineString(coordinates)))
            self.assertTrue((root/'output/test-us/v1/LICENSE.txt').exists())
            with self.assertRaisesRegex(ValueError,'already exists'):
                builder.build(sequence,regionfile,root/'output','v1','fixture')


if __name__=='__main__': unittest.main()
