from config_parsing import ConfigParser
import tempfile

def test_parse_yaml_config():
    yaml_content = "key: value\nlist:\n  - item1\n  - item2"
    with tempfile.NamedTemporaryFile('w', delete=False, suffix='.yaml') as f:
        f.write(yaml_content)
        config_path = f.name
    parser = ConfigParser(config_path)
    config = parser.parse()
    assert config['key'] == 'value'
    assert config['list'] == ['item1', 'item2']

def test_parse_ini_config():
    ini_content = "[section]\nkey=value"
    with tempfile.NamedTemporaryFile('w', delete=False, suffix='.ini') as f:
        f.write(ini_content)
        config_path = f.name
    parser = ConfigParser(config_path)
    config = parser.parse()
    assert 'section' in config
    assert config['section']['key'] == 'value'
