from scripts.lua_integration import LuaManager
import tempfile

def test_run_lua_script():
    lua_code = "return 2 + 2"
    with tempfile.NamedTemporaryFile('w', delete=False, suffix='.lua') as f:
        f.write(lua_code)
        script_path = f.name
    manager = LuaManager()
    result = manager.run_script(script_path)
    assert result == 4
