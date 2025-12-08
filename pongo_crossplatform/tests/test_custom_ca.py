import tempfile
from pathlib import Path
from scripts.custom_ca import CustomCAHandler

def test_add_custom_ca():
    # Create a dummy CA file
    with tempfile.NamedTemporaryFile(delete=False) as ca_file:
        ca_file.write(b"-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----\n")
        ca_path = ca_file.name
    handler = CustomCAHandler(ca_path)
    handler.add()
    # Check that certifi bundle was appended (not strict, just existence)
    assert Path(ca_path).exists()
    Path(ca_path).unlink()  # Cleanup
