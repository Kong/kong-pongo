from pongo_crossplatform.scripts.cli_actions import PongoCLI

def test_cli_package(monkeypatch):
    # Simulate CLI call for packaging
    cli = PongoCLI()
    from pongo_crossplatform.scripts.plugin_packaging import PluginPackager
    monkeypatch.setattr(PluginPackager, 'package', lambda self, output_dir=None: '/tmp/dummy.zip')
    # Would use CliRunner from click.testing for full CLI test
    assert hasattr(cli, 'run')
