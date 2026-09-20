# Phase 0 FairyGUI fixture

This fixture describes the minimum object/resource matrix expected from a real FairyGUI Editor test project. The repository does not ship proprietary FairyGUI project files; create or copy the isolated `.fairy` project locally and keep it outside Git.

Required objects: Image, Loader, Button, Text, List, Group, Controller, Transition.

Run the Python protocol tests with:

```bash
uv run python -m unittest discover -s tests -v
```

Real Editor validation remains environment-dependent and must be reported separately from these tests.
