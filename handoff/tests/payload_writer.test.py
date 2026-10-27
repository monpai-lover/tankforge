"""Exercise the real splice writer with non-ASCII data, braces inside strings and trailing members."""
import importlib.util,json,pathlib,sys,tempfile,unittest
TOOLS=pathlib.Path(__file__).resolve().parents[1]/'tools'/'aircraft_glb'
sys.path.insert(0,str(TOOLS))
from convert import write_data_line
class PayloadWriter(unittest.TestCase):
 def test_replaces_only_aircraft_dictionary(self):
  prefix=b'<script id="tf-data" type="application/json">'+json.dumps({'text':'中 美 苏 俄 { [ ] } "','other':{'huge':'abc'}},ensure_ascii=False).encode()[:-1]+b',"aircraftModels": '
  suffix=b',"tail":{"quote":"}\\\"{"}}</script>\n'
  with tempfile.TemporaryDirectory() as d:
   p=str(pathlib.Path(d)/'data.line');pathlib.Path(p).write_bytes(prefix+b'{"old":{"value":"} [ \\\""}}'+suffix)
   write_data_line(p,'new',{'eye':[0,1,2],'name':'米格'})
   out=pathlib.Path(p).read_bytes();self.assertTrue(out.startswith(prefix));self.assertTrue(out.endswith(suffix))
   payload=json.loads(out[out.index(b'>')+1:out.rindex(b'</script>')]);self.assertIn('old',payload['aircraftModels']);self.assertEqual(payload['aircraftModels']['new']['name'],'米格')
   write_data_line(p,None,{'new':{'updated':True},'third':{}})
   out=pathlib.Path(p).read_bytes();self.assertTrue(out.startswith(prefix));self.assertTrue(out.endswith(suffix));self.assertEqual(len(json.loads(out[out.index(b'>')+1:out.rindex(b'</script>')])['aircraftModels']),3)
if __name__=='__main__':unittest.main()
