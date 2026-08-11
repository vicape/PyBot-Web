# Minimal boot: only load OTA apply logic when an update state file exists.
try:
    import os
    try:
        os.stat("pybot_update.json")
    except OSError:
        pass
    else:
        import pybot_boot_update
        pybot_boot_update.apply()
except Exception:
    pass
