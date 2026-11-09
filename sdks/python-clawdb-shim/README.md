# clawdb (renamed to axonio)

This package was renamed to **[axonio](https://pypi.org/project/axonio/)**.
Installing `clawdb` now installs `axonio` and keeps `import clawdb` working
(`from clawdb import ClawDB` and friends re-export the same classes).

Prefer the new name in new code:

```bash
pip install axonio
```

```python
from axonio import Axonio
```

Earlier 0.1.x releases of `clawdb` did not work (the gRPC stubs were never
generated and every call returned a placeholder). 0.2.0 is the real library,
over HTTPS, with the hosted Axonio cloud as the default for an API key.
