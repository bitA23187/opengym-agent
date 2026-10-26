#!/usr/bin/env python3
"""Isolated Linux rehearsal: real age/tar; fake Docker and remote storage."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('backup-server.sh')


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='opengym-backup-test-')
        self.root = Path(self.tmp.name)
        (self.root / 'data').mkdir()
        (self.root / 'bin').mkdir()
        (self.root / 'data' / 'db.json').write_text('{"users":[{"id":"fixture"}]}')
        (self.root / 'running').write_text('true')
        self.key = self.root / 'identity'
        if os.environ.get('TEST_IDENTITY'):
            shutil.copyfile(os.environ['TEST_IDENTITY'], str(self.key))
            recipient = os.environ['TEST_RECIPIENT']
        else:
            subprocess.run(['age-keygen', '-o', str(self.key)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            recipient = subprocess.check_output(['age-keygen', '-y', str(self.key)], universal_newlines=True).strip()
        (self.root / 'backup-recipient.txt').write_text(recipient)
        self.env = dict(os.environ, OPENGYM_BACKUP_REMOTE="test-remote:opengym-backups", OPENGYM_DEPLOY_DIR=str(self.root), TEST_ROOT=str(self.root),
                        REAL_AGE=shutil.which('age'),
                        PATH=str(self.root / 'bin') + ':' + os.environ['PATH'])
        self.mock('docker', '''
case "$1" in
  compose) echo fixture-container ;;
  inspect) cat "$TEST_ROOT/running" ;;
  stop) echo stop >> "$TEST_ROOT/events"; echo false > "$TEST_ROOT/running" ;;
  start) echo start >> "$TEST_ROOT/events"; echo true > "$TEST_ROOT/running" ;;
  *) exit 9 ;;
esac
''')
        self.mock('age', '''
echo encrypt >> "$TEST_ROOT/events"
[[ "$(cat "$TEST_ROOT/running")" == false ]] || exit 8
[[ "${FAIL_ENCRYPT:-0}" == 0 ]] || exit 7
exec "$REAL_AGE" "$@"
''')
        self.mock('rclone', '''
echo "$1" >> "$TEST_ROOT/events"
[[ "${FAIL_UPLOAD:-0}" == 0 ]] || exit 6
''')

    def tearDown(self):
        self.tmp.cleanup()

    def mock(self, name, body):
        path = self.root / 'bin' / name
        path.write_text('#!/usr/bin/env bash\nset -euo pipefail\n' + body)
        path.chmod(0o700)

    def run_backup(self, **extra):
        return subprocess.run(['bash', str(SCRIPT)], env=dict(self.env, **extra),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=30)

    def events(self):
        return (self.root / 'events').read_text().splitlines()

    def test_encrypt_restore_and_order(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.events(), ['stop', 'encrypt', 'start', 'copyto', 'delete'])
        archive, = (self.root / 'backups').glob('*.age')
        plain = subprocess.check_output([self.env['REAL_AGE'], '-d', '-i', str(self.key), str(archive)])
        restored = subprocess.check_output(['tar', 'xOzf', '-', 'data/db.json'], input=plain)
        self.assertEqual(restored, (self.root / 'data' / 'db.json').read_bytes())
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        self.assertTrue(json.loads((self.root / 'backups/status.json').read_text())['ok'])

    def test_encryption_failure_restarts_api(self):
        self.assertNotEqual(self.run_backup(FAIL_ENCRYPT='1').returncode, 0)
        self.assertEqual(self.events(), ['stop', 'encrypt', 'start'])
        self.assertEqual((self.root / 'running').read_text().strip(), 'true')
        self.assertFalse(list((self.root / 'backups').glob('*.age')))

    def test_upload_failure_keeps_archive_and_skips_retention(self):
        self.assertNotEqual(self.run_backup(FAIL_UPLOAD='1').returncode, 0)
        self.assertEqual(self.events(), ['stop', 'encrypt', 'start', 'copyto'])
        self.assertEqual(len(list((self.root / 'backups').glob('*.age'))), 1)
        self.assertFalse(json.loads((self.root / 'backups/status.json').read_text())['ok'])

    def test_already_stopped_api_stays_stopped(self):
        (self.root / 'running').write_text('false')
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.events(), ['encrypt', 'copyto', 'delete'])
        self.assertEqual((self.root / 'running').read_text(), 'false')

    def test_parallel_run_refused(self):
        (self.root / 'backups').mkdir()
        with (self.root / 'backups/.backup.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_backup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('another backup is running', result.stdout)
        self.assertFalse((self.root / 'events').exists())


if __name__ == '__main__':
    unittest.main()
