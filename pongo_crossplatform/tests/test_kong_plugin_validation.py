from scripts.kong_plugin_validation import KongPluginValidator
import tempfile
import os
from pathlib import Path

def test_kong_plugin_validator_structure():
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create required files
        for fname in ['handler.lua', 'schema.lua', 'daos.lua', 'access.lua', 'init.lua', 'LICENSE', 'README.md']:
            Path(tmpdir, fname).write_text('-- dummy')
        validator = KongPluginValidator(tmpdir)
        results = validator.validate()
        assert results['structure']['valid']
        assert len(results['structure']['missing']) == 0

def test_kong_plugin_validator_lifecycle():
    with tempfile.TemporaryDirectory() as tmpdir:
        handler = Path(tmpdir, 'handler.lua')
        handler.write_text('function access() end\nfunction init_worker() end')
        validator = KongPluginValidator(tmpdir)
        results = validator.validate()
        assert results['lifecycle_hooks']['found']['access']
        assert results['lifecycle_hooks']['found']['init_worker']

def test_kong_plugin_validator_kong_variables():
    with tempfile.TemporaryDirectory() as tmpdir:
        handler = Path(tmpdir, 'handler.lua')
        handler.write_text('kong.ctx\nkong.request')
        validator = KongPluginValidator(tmpdir)
        results = validator.validate()
        assert results['kong_variables']['valid']

def test_kong_plugin_validator_version_compatibility():
    with tempfile.TemporaryDirectory() as tmpdir:
        handler = Path(tmpdir, 'handler.lua')
        handler.write_text('kong.ctx\nkong.request')
        validator = KongPluginValidator(tmpdir)
        results = validator.validate()
        assert results['version_compatibility']['valid']

def test_kong_plugin_validator_functionality_coverage():
    with tempfile.TemporaryDirectory() as tmpdir:
        handler = Path(tmpdir, 'handler.lua')
        handler.write_text('access\ninit_worker\nheader_filter\nbody_filter\nlog\ncertificate\nrewrite')
        validator = KongPluginValidator(tmpdir)
        results = validator.validate()
        assert results['functionality_coverage']['valid']
