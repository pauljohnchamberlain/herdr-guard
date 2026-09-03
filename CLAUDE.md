# Herdr Guard

This repository contains the public Herdr Guard plugin.

The public boundary is deliberate: the package may invoke only registered,
typed Herdr operations through the local Herdr CLI. It must not import private
portfolio systems, execute shell strings, use network services, infer targets
from focus, or store state in the checkout.

Source lives in `src/`; tests live in `test/`; manifest actions are static and
must remain small. Runtime configuration and audit state are owned by Herdr's
declared plugin directories.
