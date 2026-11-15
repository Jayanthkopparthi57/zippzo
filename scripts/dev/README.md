# Development-only scripts

These are **not** part of the deployed application. They are kept for local
debugging against a disposable database and are guarded by
`_bootstrap.require_local_database()`, which refuses to run against Neon or any
non-local host unless `ALLOW_REMOTE_DEV_SCRIPTS=1` is set explicitly.

Run them from the repository root:

```bash
python scripts/dev/pipeline_test.py        # end-to-end walkthrough (writes data)
python scripts/dev/cleanup_testdata.py     # removes rows tagged by the pipeline
python scripts/dev/seed_pick_demo.py       # demo dark-store replenishment data
python scripts/dev/seed_pick_task.py       # one open pick task for UI checks
```

Prefer the real test suites for verification:

```bash
python manage.py test bounded --keepdb
cd frontend && npx playwright test
```

The production dataset is created by `manage.py bootstrap_admin` and the normal
product APIs — never by these scripts.
