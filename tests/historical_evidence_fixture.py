"""Pair historical report fixtures with the validated sources they measured.

Parser and assessor functions remain imported from the current checkout. Only
source/report paths used by historical integrity cases point at this private,
task-owned stage; no report hash or validation function is replaced.
"""
from contextlib import ExitStack, contextmanager
import json
from pathlib import Path
import shutil
import subprocess
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def historical_sources(*modules):
    # The existing stager verifies the pinned manifest and all retained public
    # reports before materializing the exact explicit historical source closure.
    # Python owns this temporary stage after the short Node process exits.
    script = """
      import { stageHistoricalEvidence } from './research/validate-history.mjs';
      const stage = stageHistoricalEvidence();
      console.log(JSON.stringify({ root: stage.root }));
    """
    result = subprocess.run(
        ['node', '--input-type=module', '--eval', script], cwd=ROOT,
        capture_output=True, text=True, check=True, timeout=15,
    )
    stage = Path(json.loads(result.stdout)['root'])
    if not stage.is_absolute() or not stage.name.startswith('system-one-history-') or stage.is_symlink():
        raise ValueError('Historical stager returned an unexpected fixture root')
    with ExitStack() as stack:
        stack.callback(shutil.rmtree, stage)
        for module in modules:
            for name in ('ROOT', 'PROTOCOL', 'CORPUS', 'REPORT'):
                value = getattr(module, name, None)
                if isinstance(value, Path):
                    relative = value.relative_to(ROOT)
                    stack.enter_context(mock.patch.object(module, name, stage / relative))
        yield stage
