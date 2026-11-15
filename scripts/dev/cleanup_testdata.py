"""Remove every row produced by pipeline_test.py from the persistent database.

The pipeline writes against the real (Neon) database, so its artefacts must be
swept once verification is done. Rows are identified by the 6-hex RUN tag that
the pipeline embeds in codes, emails and names.

Deletion is iterative: on every pass each model's matching rows are removed, so
rows that only become deletable after their parent is gone (CASCADE) are picked
up by a later pass. PROTECT-style blocks are reported rather than force-broken.
"""
import os
import re
import sys

import django

import _bootstrap

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "zippzo_wms.settings")
django.setup()
_bootstrap.require_local_database()

from django.db import connection, transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError

RUN_RE = re.compile(r"\b([0-9A-F]{6})\b")

# A run tag is uuid4().hex[:6].upper(), i.e. mixed hex letters. Purely numeric
# matches are real data (the seed sites carry PIN 534202 in their address) and
# must never be treated as residue -- deleting the seed rows on that basis would
# be catastrophic. Tags that happen to come out all-numeric are instead caught
# by the structural sweep, which reasons about containers rather than strings.
def is_run_tag(tok):
    return len(tok) == 6 and not tok.isdigit()


APPLY = "--apply" in sys.argv


def managed_models():
    return [m for m in django.apps.apps.get_models() if m._meta.managed]


def text_fields(model):
    from django.db import models as dm
    return [f.attname for f in model._meta.concrete_fields
            if isinstance(f, (dm.CharField, dm.TextField))]


def columns_for(model):
    """Every text column.

    Discovery, deletion and verification must all use the same column set,
    otherwise a run whose only surviving trace is an unlisted column (e.g.
    pick_tasks.zone) is reported as clean while still present.
    """
    return text_fields(model)


def tagged_q(model, runs, cols):
    if not runs:
        # An empty Q() matches every row -- never build one.
        raise ValueError("refusing to build an empty tag query")
    q = Q()
    for col in cols:
        for run in runs:
            q |= Q(**{f"{col}__icontains": run})
    return q


def find_runs(models):
    """Discover run tags by scanning every text column, not just known ones."""
    runs = set()
    for m in models:
        for col in text_fields(m):
            try:
                for val in m.objects.exclude(**{f"{col}__isnull": True}) \
                             .values_list(col, flat=True).iterator():
                    runs.update(t for t in RUN_RE.findall(str(val)) if is_run_tag(t))
            except Exception:
                continue
    return runs


def sweep_dangling(apply):
    """Delete operational rows whose physical container no longer exists.

    Tag matching alone can miss residue: a run tag that is all digits (1.5% of
    runs) looks exactly like a PIN code, and once the parent Site rows are gone
    the tag is the only trace. Structural check instead: a pick/putaway row must
    point at a bin that still exists, a pack row at an LPN that still exists.
    """
    from django.apps import apps as a
    Loc = a.get_model("network", "Location")
    Lpn = a.get_model("inventory", "LpnMaster")
    bins = set(Loc.objects.values_list("location_id", flat=True)) | \
        set(Loc.objects.values_list("barcode", flat=True))
    lpns = set(Lpn.objects.values_list("lpn_id", flat=True)) | \
        set(Lpn.objects.values_list("barcode", flat=True))

    def dangling(model, field, valid):
        bad = set()
        for pk, val in model.objects.exclude(**{f"{field}__in": ["", None]}) \
                                .values_list("pk", field):
            if val not in valid:
                bad.add(pk)
        return bad

    plans = [
        (a.get_model("ds_ops", "PickTask"), "bin", bins),
        (a.get_model("ds_ops", "PackTask"), "lpn", lpns),
        (a.get_model("fulfilment", "OrderAllocation"), "bin", bins),
        (a.get_model("fulfilment", "OrderAllocation"), "lpn", lpns),
    ]
    total = 0
    for model, field, valid in plans:
        bad = dangling(model, field, valid)
        if not bad:
            continue
        print(f"  dangling {model._meta.db_table}.{field}: {len(bad)} row(s)")
        if apply:
            with transaction.atomic():
                total += model.objects.filter(pk__in=bad).delete()[0]
        else:
            total += len(bad)
    return total


class Rollback(Exception):
    pass


def sweep(models, runs, apply):
    blocked = {}
    total = 0
    if not runs:
        return 0, blocked
    # Passes: later passes mop up rows freed by earlier CASCADE deletions.
    for attempt in range(1, 13):
        removed_this_pass = 0
        for m in models:
            cols = columns_for(m)
            if not cols:
                continue
            try:
                n = 0
                while True:
                    ids = list(m.objects.filter(tagged_q(m, runs, cols))
                               .values_list("pk", flat=True)[:500])
                    if not ids:
                        break
                    try:
                        with transaction.atomic():
                            m.objects.filter(pk__in=ids).delete()
                    except ProtectedError as e:
                        blocked.setdefault(m._meta.db_table, set()).add(
                            str(getattr(e, "protected_objects", ""))[:200])
                        break
                    n += len(ids)
                    if len(ids) < 500:
                        break
                if n:
                    removed_this_pass += n
                    print(f"  pass {attempt}: {m._meta.db_table:38s} -{n}")
            except Exception as e:
                print(f"  ! {m._meta.db_table}: {type(e).__name__}: {e}")
        total += removed_this_pass
        print(f"  pass {attempt}: removed {removed_this_pass} row(s)")
        if removed_this_pass == 0:
            break
    return total, blocked


def main():
    models = managed_models()
    runs = sorted(find_runs(models))
    print(f"{len(runs)} run tag(s) detected")
    if not runs:
        print("no tag-based residue")

    if APPLY:
        total, blocked = sweep(models, runs, apply=True)
        print(f"\ntag sweep removed: {total} row(s)")
        d = sweep_dangling(apply=True)
        print(f"dangling sweep removed: {d} row(s)")
    else:
        # One outer transaction so the whole dry run can be rolled back.
        try:
            with transaction.atomic():
                total, blocked = sweep(models, runs, apply=False)
                d = sweep_dangling(apply=False)
                raise Rollback()
        except Rollback:
            pass
        print(f"\nDRY RUN - would remove {total} tag-matched + {d} dangling row(s). rolled back.")
        print("re-run with --apply to commit.")
        return

    if blocked:
        print("\nrows that could NOT be deleted (protected by FK):")
        for table, why in blocked.items():
            print(f"  {table}: {sorted(why)[0] if why else ''}")

    remaining = {}
    for m in models:
        try:
            n = m.objects.filter(tagged_q(m, runs, columns_for(m))).count() if runs else 0
        except Exception:
            continue
        if n:
            remaining[m._meta.db_table] = n
    if remaining:
        print("\nSTILL PRESENT after apply:")
        for table, n in sorted(remaining.items()):
            print(f"  {table:40s} {n}")
    else:
        print("\nverified: no run-tagged rows remain.")


main()
