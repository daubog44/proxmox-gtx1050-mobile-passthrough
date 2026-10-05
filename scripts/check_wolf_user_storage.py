#!/usr/bin/env python3
"""python3 scripts/check_wolf_user_storage.py; --native DIR also tests real Btrfs hard quotas."""
import argparse
import errno
import importlib.machinery
import importlib.util
import os
import sqlite3
import subprocess
import tempfile
import time
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("broker", str(Path(__file__).with_name("omarchy-session-broker")))
broker = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(broker)
parser = argparse.ArgumentParser()
parser.add_argument("--native", type=Path, help="Temporary test directory on Btrfs; run as root")
args = parser.parse_args()
template = {"runner": {"type": "docker", "base_create_json": '{"HostConfig":{"SecurityOpt":["seccomp=unconfined","apparmor=unconfined"],"CapAdd":["SYS_ADMIN"]}}'}}
config = __import__("json").loads(broker.isolate_wolf_app(template, "omarchy-guests")["runner"]["base_create_json"])["HostConfig"]
policy = __import__("json").loads(next(s.removeprefix("seccomp=") for s in config["SecurityOpt"] if s.startswith("seccomp=")))
assert config["CapAdd"] == ["SYS_ADMIN"] and "apparmor=unconfined" in config["SecurityOpt"]
assert policy["defaultAction"] == "SCMP_ACT_ALLOW" and "SCMP_ARCH_X86" in policy["architectures"]
assert {rule["args"][0]["valueTwo"] & 0xff for rule in policy["syscalls"]} == {1, 14, 15, 23, 24, 40, 41, 42, 43, 44, 63}

with tempfile.TemporaryDirectory(dir=args.native) as directory:
    root = Path(directory)
    db = root / "sessions.db"
    with sqlite3.connect(db) as old:
        old.execute("""CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE,
            display_name TEXT, pin TEXT, role TEXT, allowed_apps TEXT, max_bitrate_mbps INTEGER,
            status TEXT, created_at INTEGER)""")
    conn = broker.init_db(db)
    conn.execute("""INSERT INTO users (username, display_name, pin, role, allowed_apps,
        max_bitrate_mbps, status, created_at) VALUES ('storagecheck', 'Quota Check', '9876',
        'guest', '["desktop", "steam"]', 20, 'active', 1)""")
    conn.commit()

    def limit():
        return conn.execute("SELECT storage_limit_gb FROM users WHERE username='storagecheck'").fetchone()[0]

    assert limit() == 0  # existing DB migration preserves unlimited users
    for value in (-1, float("nan"), float("inf"), True, "2"):
        try:
            broker.apply_wolf_storage_limit("storagecheck", value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid quota accepted: {value}")

    with patch.object(broker, "WOLF_STATE_DIR", root / "wolf"):
        with (patch.object(broker, "apply_wolf_storage_limit", return_value=2.1) as apply,
              patch.object(broker, "sync_user_wolf_profile") as profile,
              patch.object(broker, "kill_session") as stop):
            broker.edit_user(conn, "storagecheck", storage_limit_gb=2.1, allowed_apps=["steam", "desktop"])
            assert limit() == 2.1
            profile.assert_not_called()
            stop.assert_not_called()
            apply.assert_called_once_with("storagecheck", 2.1)
            apply.reset_mock()
            try:
                broker.edit_user(conn, "storagecheck", new_username="../bad_name", storage_limit_gb=1)
            except ValueError:
                pass
            else:
                raise AssertionError("Unsafe rename accepted")
            apply.assert_not_called()
        with patch.object(broker, "apply_wolf_storage_limit", side_effect=RuntimeError("filesystem unavailable")):
            try:
                broker.edit_user(conn, "storagecheck", storage_limit_gb=3)
            except RuntimeError:
                pass
            else:
                raise AssertionError("Unenforced quota saved")
            assert limit() == 2.1

        data = broker.wolf_profile_data_dir("storagecheck")
        data.mkdir(parents=True)
        original = os.urandom(128 * 1024)
        (data / "document.bin").write_bytes(original)
        assert broker.wolf_storage_info("storagecheck")["used_gb"] is None  # never charge the VM's parent subvolume
        if args.native:
            with patch.object(broker, "sync_user_wolf_profile") as profile:
                broker.edit_user(conn, "storagecheck", storage_limit_gb=2 / 1024)
                assert (data / "document.bin").read_bytes() == original
                assert any((p / "document.bin").read_bytes() == original
                           for p in data.parent.glob("*.before-quota-*"))
                try:
                    with (data / "allocation.bin").open("wb") as file:
                        try:
                            os.posix_fallocate(file.fileno(), 0, 8 * 1024**2)
                        except OSError as error:
                            assert error.errno == errno.EDQUOT, error
                        else:
                            raise AssertionError("Hard quota did not block writes")
                        broker.edit_user(conn, "storagecheck", storage_limit_gb=16 / 1024)
                        os.posix_fallocate(file.fileno(), 0, 8 * 1024**2)  # same open file; runtime change
                    try:
                        broker.edit_user(conn, "storagecheck", storage_limit_gb=1 / 1024)
                    except ValueError:
                        pass
                    else:
                        raise AssertionError("Limit below occupied space accepted")
                    assert limit() == 16 / 1024
                    assert broker.wolf_storage_info("storagecheck")["limit_bytes"] == 16 * 1024**2
                    broker.edit_user(conn, "storagecheck", storage_limit_gb=0)
                    assert broker.wolf_storage_info("storagecheck")["limit_bytes"] == 0
                    profile.assert_not_called()
                finally:
                    subprocess.run(["btrfs", "subvolume", "delete", str(data)], check=True, stdout=subprocess.DEVNULL)
    conn.close()

with tempfile.TemporaryDirectory(dir=args.native) as directory:
    root = Path(directory)
    nas, spool = root / "nas", root / "spool"
    nas.mkdir()
    assert not broker.check_nas_mount(str(nas))  # writable is not the same as mounted
    with (patch.dict(broker.STORAGE_DEFAULTS, {"nas_mountpoint": str(nas),
          "local_recordings_path": str(spool), "local_saves_path": str(root / "local-saves")}),
          patch.object(broker, "DEFAULT_NAS_MOUNT", str(nas)),
          patch.object(broker, "DEFAULT_LOCAL_SPOOL", str(spool)),
          patch.object(broker, "WOLF_STATE_DIR", root / "wolf"),
          patch.object(broker, "check_nas_mount", return_value=True)):
        conn = broker.init_db(root / "policy.db")
        broker.set_setting(conn, "recordings_previous_paths", "[]")  # only fixture archives may be pruned
        for key in ("retention_recordings_days", "retention_saves_max_snapshots"):
            for value in ("-1", "1.5", "nan", ""):
                try:
                    broker.set_setting(conn, key, value)
                except ValueError:
                    pass
                else:
                    raise AssertionError(f"Invalid retention accepted: {value}")
        broker.set_setting(conn, "retention_saves_max_snapshots", "61")  # no arbitrary 50-copy cap
        conn.close()
        conn = broker.init_db(root / "policy.db")
        assert broker.get_setting(conn, "retention_saves_max_snapshots") == "61"
        broker.set_setting(conn, "nas_share_url", "smb://nas.example/share")
        broker.set_setting(conn, "savegames_nas_path", "smb://nas.example/share/custom-backups")
        assert broker.get_savegames_nas_dir(conn, "check") == nas / "custom-backups/check"
        for value in ("../escape", "smb://other.example/share/backups"):
            try:
                broker.set_setting(conn, "savegames_nas_path", value)
            except ValueError:
                pass
            else:
                raise AssertionError("NAS path escaped the configured share")
        documents = broker.wolf_profile_data_dir("check") / "WolfXFCE/Documents"
        documents.mkdir(parents=True)
        broker.set_setting(conn, "retention_saves_max_snapshots", "0")
        archives = []
        for i in range(3):
            (documents / "note.txt").write_text(str(i))
            archives.append(Path(broker.sync_savegames(conn, "check")["path"]))
        assert len(set(archives)) == 3 and all(p.is_file() for p in archives)
        broker.set_setting(conn, "retention_saves_max_snapshots", "1")
        assert len(broker.prune_savegame_snapshots(conn, "check", dry_run=True)) == 2
        assert all(p.is_file() for p in archives)
        broker.prune_savegame_snapshots(conn, "check")
        assert archives[-1].is_file() and all(not p.exists() for p in archives[:-1])

        old_root = broker.storage_path(conn, "recordings_nas_path")
        files = [old_root / f"check/day/time/{name}.mp4" for name in ("old", "busy", "recent")]
        files[0].parent.mkdir(parents=True)
        for i, file in enumerate(files):
            file.write_bytes(b"test recording")
            if i < 2:
                os.utime(file, (time.time() - 45 * 86400,) * 2)
        session = broker.register_demo_session(conn, "check")["session_id"]
        conn.execute("UPDATE active_sessions SET is_recording=1, recording_file=? WHERE session_id=?", (str(files[1]), session))
        conn.commit()
        broker.set_setting(conn, "recordings_nas_path", "custom-videos")
        assert old_root in broker.recording_roots(conn)
        with patch.object(broker, "probe_recording", return_value={}):
            for record in broker.list_recordings(conn, "check"):
                assert broker.resolve_recording(conn, record["id"]).is_file()
        for days, expected in (("0", 0), ("60", 0), ("30", 1)):
            broker.set_setting(conn, "retention_recordings_days", days)
            assert broker.prune_nas_storage(conn, dry_run=True)["pruned_recordings_count"] == expected
            assert all(p.is_file() for p in files)
        broker.prune_nas_storage(conn)
        assert not files[0].exists() and all(p.is_file() for p in files[1:])
        conn.execute("UPDATE active_sessions SET is_recording=0 WHERE session_id=?", (session,))
        conn.commit()
        with (patch.object(broker, "capture_unavailable_reason", return_value=None),
              patch.object(broker, "ffmpeg_binary", return_value="ffmpeg"),
              patch.object(broker, "fmp4_reader_command", side_effect=lambda *a, **k: ["ffmpeg", a[2]]),
              patch.object(broker.subprocess, "Popen", return_value=SimpleNamespace(pid=424242, poll=lambda: None)),
              patch.object(broker.time, "sleep"), patch.object(broker, "notify_hyprland_user")):
            result = broker.start_recording(conn, session)
            assert result["status"] == "ok" and Path(result["file"]).is_relative_to(nas / "custom-videos")
        broker.RECORDINGS.pop(session)
        conn.close()

if not args.native:
    # Exercise the actual fullscreen handler with the installed TS compiler,
    # a tiny DOM and the native window API stub; no browser/test framework.
    repo = Path(__file__).resolve().parent.parent
    subprocess.run(["node", "-e", r'''
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const ts = require("./apps/omarchy-control/node_modules/typescript");
const main = fs.readFileSync("apps/omarchy-control/src/main.ts", "utf8");
const code = ts.transpileModule(main.slice(main.indexOf("function wireMediaFullscreen("), main.indexOf("function openLiveMonitorModal(")), {}).outputText;
let nativeFullscreen = false, click, key;
const classes = new Set();
const button = {addEventListener: (_, f) => click = f, removeEventListener: () => {}, setAttribute: () => {}};
const modal = {dataset:{}, querySelector: () => button, classList: {
  contains: c => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c)}};
const context = {getCurrentWindow: () => ({isFullscreen: async () => nativeFullscreen,
  setFullscreen: async value => nativeFullscreen = value}),
  document: {addEventListener: (_, f) => key = f, removeEventListener: () => {}},
  showToast: message => {throw Error(message)}, console};
vm.createContext(context); vm.runInContext(code, context);
(async () => {
  const close = context.wireMediaFullscreen(modal);
  await click(); assert(nativeFullscreen && classes.has("media-fullscreen"));
  let stopped = false;
  key({key: "Escape", preventDefault() {}, stopImmediatePropagation() { stopped = true; }});
  await new Promise(setImmediate); assert(stopped && !nativeFullscreen && !classes.has("media-fullscreen"));
  await click(); close(); await new Promise(setImmediate); assert(!nativeFullscreen);
  classes.clear();
  nativeFullscreen = true;
  const closeAlreadyFull = context.wireMediaFullscreen(modal);
  await click(); closeAlreadyFull(); await new Promise(setImmediate); assert(nativeFullscreen);
  const fields = {
    "cfg-savegames-type": "nas", "cfg-savegames-path": "custom-backups", "cfg-savegames-maxsnaps": "61",
    "cfg-recordings-days": "0", "cfg-recordings-path": "custom-videos",
    "cfg-local-saves-path": "/var/lib/custom-backups", "cfg-local-recordings-path": "/var/lib/custom-videos",
  }, saved = {};
  context.document = {querySelector(selector) {
    if (selector === "#btn-save-settings-savegames") return {addEventListener: (_, f) => click = f};
    if (selector === "#cfg-savegames-autosync") return {checked: true};
    return selector.slice(1) in fields ? {value: fields[selector.slice(1)], reportValidity: () => true} : null;
  }};
  Object.assign(context, {nasModalWired: true, currentSession: null, setBusy() {}, showToast() {}, wireStorageActions() {},
    loadEnterpriseData: async () => {}, api: {updateEnterpriseSetting: async (key, value) => saved[key] = value}});
  vm.runInContext(ts.transpileModule(main.slice(main.indexOf("function wireEnterpriseActions()"), main.indexOf("async function loadEnterpriseData(")), {}).outputText, context);
  context.wireEnterpriseActions(); await click();
  assert.equal(saved.retention_saves_max_snapshots, "61"); assert.equal(saved.retention_recordings_days, "0");
  assert.equal(saved.recordings_nas_path, "custom-videos"); assert.equal(saved.local_recordings_path, "/var/lib/custom-videos");
})().catch(error => {console.error(error); process.exitCode = 1;});
'''], cwd=repo, check=True)

print("Storage: quote home, fullscreen, retention modificabile/zero, percorsi NAS e protezione registrazioni attive OK")
