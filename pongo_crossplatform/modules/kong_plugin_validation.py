"""
Kong plugin validation module for Pongo Cross-Platform Tool
Validates custom Lua plugins for Kong 3.11+
"""
from pathlib import Path
from typing import Dict, Any
import re
import json
from pongo_crossplatform.core.logging import LoggingManager

class KongPluginValidator:
    """
    Validates Kong custom Lua plugins for Kong 3.11+
    """
    def __init__(self, plugin_dir: str = None, log_level: str = "INFO"):
        self.logger = LoggingManager(log_level)
        self.logger.setup()
        if plugin_dir is None:
            with open("../config/config.json") as f:
                config = json.load(f)
            plugin_dir = config.get("plugins_directory", "pongo_crossplatform/tests/lua_plugins")
        self.plugin_dir = Path(plugin_dir)
        self.logger.info(f"Initialized KongPluginValidator with plugin_dir: {self.plugin_dir}")

    def validate(self) -> Dict[str, Any]:
        """
        Run all validation checks and return results.
        Returns:
            dict: Validation results for each check.
        """
        self.logger.info("Running plugin validation checks...")
        results = {
            'structure': self.check_structure(),
            'lifecycle_hooks': self.check_lifecycle_hooks(),
            'kong_variables': self.check_kong_variables(),
            'version_compatibility': self.check_version_compatibility(),
            'functionality_coverage': self.check_functionality_coverage()
        }
        self.logger.info(f"Validation results: {results}")
        return results

    def check_structure(self) -> Dict[str, Any]:
        required_files = [
            'handler.lua', 'schema.lua', 'daos.lua', 'access.lua', 'init.lua', 'LICENSE', 'README.md'
        ]
        found = {fname: (self.plugin_dir / fname).exists() for fname in required_files}
        missing = [f for f, ok in found.items() if not ok]
        return {'found': found, 'missing': missing, 'valid': len(missing) == 0}

    def check_lifecycle_hooks(self) -> Dict[str, Any]:
        required_hooks = [
            'init_worker', 'access', 'header_filter', 'body_filter', 'log', 'certificate', 'rewrite'
        ]
        found = {}
        handler_path = self.plugin_dir / 'handler.lua'
        if handler_path.exists():
            content = handler_path.read_text()
            for hook in required_hooks:
                found[hook] = bool(re.search(rf'function\s+\w*\.?{hook}\s*\(', content))
        else:
            found = {hook: False for hook in required_hooks}
        missing = [h for h, ok in found.items() if not ok]
        return {'found': found, 'missing': missing, 'valid': len(missing) == 0}

    def check_kong_variables(self) -> Dict[str, Any]:
        kong_vars = [
            'kong.ctx', 'kong.request', 'kong.response', 'kong.service', 'kong.log', 'kong.db',
            'kong.configuration', 'kong.router', 'kong.cache', 'kong.cluster', 'kong.worker_events'
        ]
        found = {}
        handler_path = self.plugin_dir / 'handler.lua'
        if handler_path.exists():
            content = handler_path.read_text()
            for var in kong_vars:
                found[var] = var in content
        else:
            found = {var: False for var in kong_vars}
        missing = [v for v, ok in found.items() if not ok]
        return {'found': found, 'missing': missing, 'valid': len(missing) < len(kong_vars)}

    def check_version_compatibility(self) -> Dict[str, Any]:
        deprecated = ['ngx.req.get_headers', 'ngx.req.get_uri_args']
        required = ['kong.ctx', 'kong.request']
        found_deprecated = []
        found_required = []
        handler_path = self.plugin_dir / 'handler.lua'
        if handler_path.exists():
            content = handler_path.read_text()
            for d in deprecated:
                if d in content:
                    found_deprecated.append(d)
            for r in required:
                if r in content:
                    found_required.append(r)
        return {
            'deprecated_found': found_deprecated,
            'required_found': found_required,
            'valid': len(found_deprecated) == 0 and len(found_required) > 0
        }

    def check_functionality_coverage(self) -> Dict[str, Any]:
        essential_functions = [
            'access', 'init_worker', 'header_filter', 'body_filter', 'log', 'certificate', 'rewrite'
        ]
        found = {}
        handler_path = self.plugin_dir / 'handler.lua'
        if handler_path.exists():
            content = handler_path.read_text()
            for func in essential_functions:
                found[func] = func in content
        else:
            found = {func: False for func in essential_functions}
        missing = [f for f, ok in found.items() if not ok]
        return {'found': found, 'missing': missing, 'valid': len(missing) == 0}
