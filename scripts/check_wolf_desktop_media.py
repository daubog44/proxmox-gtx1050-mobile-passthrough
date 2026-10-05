#!/usr/bin/env python3
"""python3 scripts/check_wolf_desktop_media.py; stdlib, no GPU or NAS needed."""
import importlib.machinery
import importlib.util
import os
import io
import struct
import time
import argparse
import subprocess
import sys
import tarfile
import tempfile
import tomllib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("broker", str(Path(__file__).with_name("omarchy-session-broker")))
broker = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(broker)

for events, expected in (("New streaming session started [active sessions: 2]\nCLIENT DISCONNECTED",1),
                         ("CLIENT DISCONNECTED",0), ("",None)):
    with patch.object(broker.subprocess, "check_output", side_effect=["123", events]):
        assert broker.sunshine_stream_count() == expected


# A later shutdown of the old lobby must not redirect the new session backwards.
from unittest.mock import MagicMock
connection = MagicMock()
response = connection.getresponse.return_value
response.status = 200
response.read.side_effect = [
    b'{"lobbies":[{"id":"old","connected_sessions":["123"]},{"id":"new","connected_sessions":[],"multi_user":true}]}',
    b'{"success":true}', b'{"success":true}',
]
with patch.object(broker, "_UnixHTTPConnection", return_value=connection):
    assert broker.wolf_api("POST", "/api/v1/lobbies/join", {"lobby_id":"new","moonlight_session_id":"123","pin":None})["success"]
assert [call.args[1] for call in connection.request.call_args_list] == ["/api/v1/lobbies", "/api/v1/lobbies/leave", "/api/v1/lobbies/join"]
response.read.side_effect = [b'{"lobbies":[{"id":"new","connected_sessions":["123"]}]}']
connection.request.reset_mock()
with patch.object(broker, "_UnixHTTPConnection", return_value=connection):
    broker.wolf_api("POST", "/api/v1/lobbies/join", {"lobby_id":"new","moonlight_session_id":"123"})
assert connection.request.call_count == 1  # no duplicate membership

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    base = root / "omarchy-live-123"
    active = Path(str(base) + ".0")
    newer = Path(str(base) + ".1")
    unrelated = root / "omarchy-live-1234"
    for path in (base, active, newer, unrelated):
        path.touch()
    os.utime(active, ns=(1, 1))
    os.utime(newer, ns=(2, 2))

    def unix_table(*paths):
        return "Num RefCount Protocol Flags Type St Inode Path\n" + "".join(
            f"000: 2 0 00010000 0001 01 1 {path}\n" for path in paths)

    with patch.object(broker, "WOLF_TAP_DIR", directory):
        with patch.object(Path, "read_text", return_value=unix_table(active, unrelated)):
            assert broker.wolf_tap_socket("wolf-123") == active  # stale base exists
            assert broker.capture_unavailable_reason("wolf-123") is None
            assert broker.wolf_tap_socket("wolf-../123") is None
        with patch.object(Path, "read_text", return_value=unix_table(active, newer)):
            assert broker.wolf_tap_socket("wolf-123") == newer
        with patch.object(Path, "read_text", return_value=unix_table(unrelated)):
            assert broker.wolf_tap_socket("wolf-123") is None
            assert broker.capture_unavailable_reason("wolf-123") is not None

    tap_script = Path(__file__).with_name("omarchy-wolf-live-tap").read_text()
    patch_code = tap_script.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
    config = root / "config.toml"
    config.write_text('''[gstreamer.video]
default_sink = """queue ! rtpmoonlightpay_video ! appsink"""
[[gstreamer.video.hevc_encoders]]
check_elements = ["nvh265enc"]
encoder_pipeline = """nvh265enc gop-size=-1 ! h265parse"""
[gstreamer.video.defaults.nvcodec]
video_params_zero_copy = """cudaupload ! cudaconvertscale ! video/x-raw(memory:CUDAMemory)"""
''')
    for _ in range(2):  # new install, then an already-installed tap
        subprocess.run([sys.executable, "-c", patch_code, str(config), "120", "test-tap"], check=True,
                       stdout=subprocess.DEVNULL)
        video = tomllib.loads(config.read_text())["gstreamer"]["video"]
        encoder = video["hevc_encoders"][0]
        assert encoder["check_elements"] == ["nvh265enc"]
        assert "gop-size=120" in encoder["encoder_pipeline"]
        assert encoder["encoder_pipeline"].count("repeat-sequence-header=true") == 1
        assert encoder["encoder_pipeline"].count("config-interval=1") == 1
        assert "cudaupload" not in video["defaults"]["nvcodec"]["video_params_zero_copy"]
        assert "omarchy_live_tee" in video["default_sink"]
        assert "unixfdsink" in video["default_sink"] and "shmsink" not in video["default_sink"]
        assert "flush-on-eos=true" in video["default_sink"]

    with (patch.object(broker, "WOLF_STATE_DIR", root / "wolf"),
          patch.object(broker, "DEFAULT_NAS_MOUNT", str(root / "nas")),
          patch.dict(broker.STORAGE_DEFAULTS, {"nas_mountpoint": str(root / "nas"), "local_saves_path": str(root / "local-saves")}),
          patch.object(broker, "check_nas_mount", return_value=True)):
        home = broker.wolf_profile_data_dir("test") / "WolfXFCE"
        documents = home / "Documents"
        documents.mkdir(parents=True)
        big = documents / "large.dat"
        with big.open("wb") as file:
            file.truncate(513 * 1024 * 1024)  # sparse, catches the old 512 MB cutoff
        (documents / "note.txt").write_text("desktop data")
        (home / ".cache").mkdir()
        (home / ".cache" / "temporary").write_text("cache")
        conn = broker.init_db(root / "sessions.db")
        try:
            assert broker.get_setting(conn, "retention_recordings_days") == "0"
            conn.execute("""INSERT INTO users (username,display_name,pin,role,allowed_apps,max_bitrate_mbps,status,created_at)
                            VALUES ('test','Test','1234','guest','[]',20,'active',1)""")
            conn.execute("""INSERT INTO active_sessions (session_id,username,client_ip,app_name,resolution,fps,bitrate_kbps,vram_mb,started_at,state)
                            VALUES ('wolf-123','test','127.0.0.1','Desktop','2560x1600',60,20000,600,1,'running')""")
            conn.commit()
            result = broker.sync_savegames(conn, "test")
            with tarfile.open(result["path"], "r:gz") as archive:
                assert archive.getmember("WolfXFCE/Documents/large.dat").size == big.stat().st_size
                assert archive.extractfile("WolfXFCE/Documents/note.txt").read() == b"desktop data"
                assert not any(".cache" in Path(name).parts for name in archive.getnames())
            copies_before = len(broker.list_savegames(conn, "test"))
            with patch.object(tarfile.TarFile, "addfile", side_effect=OSError("NAS unavailable")):
                try: broker.sync_savegames(conn, "test")
                except OSError: pass
                else: raise AssertionError("Failed backup reported as successful")
            assert len(broker.list_savegames(conn, "test")) == copies_before
            assert not list(Path(result["path"]).parent.glob("*.part"))

            packet = broker.moonlight_input_packet({"kind":"move", "x":1, "y":0})
            assert packet[:4] == struct.pack("<HH", 0x206, 18)
            assert packet[4:12] == struct.pack(">I",14) + struct.pack("<I",5)
            assert packet[12:] == struct.pack(">hhhhh",32766,0,0,32766,32766)
            for geometry in ((0.8, 0.8), (1.125, 1.125), (0.75, 1.2)):
                payload = broker.moonlight_input_packet({"kind":"move", "x":0.8, "y":0.3}, geometry)[12:]
                x,y,_,w,h = struct.unpack(">hhhhh",payload)
                assert abs(x / w - 0.8 * geometry[0]) < 0.0001
                assert abs(y / h - 0.3 * geometry[1]) < 0.0001
            assert broker.moonlight_input_packet({"kind":"key","code":84,"down":True,"modifiers":6})[12:] == struct.pack("<BHBH",0,0x8054,6,0)
            assert broker.moonlight_input_packet({"kind":"key","code":96,"down":True})
            for event in ({"kind":"move","x":float('nan'),"y":0}, {"kind":"key","code":65,"down":1},
                          {"kind":"button","code":9,"down":True}, {"kind":"text","text":"x"*33}):
                try: broker.moonlight_input_packet(event)
                except ValueError: pass
                else: raise AssertionError(f"Unsafe input accepted: {event}")
            with patch.object(broker, "send_direct_event") as send, patch.object(broker, "wolf_input_geometry", return_value=(1, 1)):
                lease = broker.direct_control(conn,"wolf-123","start")["lease"]
                broker.direct_control(conn,"wolf-123","input",lease,[{"kind":"key","code":65,"down":True}])
                broker.direct_control(conn,"wolf-123","stop",lease)
                first = broker.direct_control(conn,"wolf-123","start", owner="viewer-a")["lease"]
                second = broker.direct_control(conn,"wolf-123","start", owner="viewer-a")["lease"]
                try: broker.direct_control(conn,"wolf-123","stop",first)
                except ValueError: pass
                else: raise AssertionError("An old viewer released its replacement")
                assert broker._direct_controls["wolf-123"]["lease"] == second
                try: broker.direct_control(conn,"wolf-123","start",owner="viewer-b")
                except ValueError: pass
                else: raise AssertionError("Another viewer stole the active control")
                broker.direct_control(conn,"wolf-123","stop",second)
                assert send.call_args.args[1] == {"kind":"key","code":65,"down":False}
                try: broker.direct_control(conn,"wolf-123","input",lease,[])
                except ValueError: pass
                else: raise AssertionError("Released input lease accepted")

            listing = broker.user_storage(conn,"test","list","WolfXFCE/Documents")
            assert {i['name'] for i in listing['items']} == {'large.dat','note.txt'}
            outside = root / 'outside.txt'; outside.write_text('private VM data')
            (documents/'escape').symlink_to(outside)
            for relative in ('../outside.txt','/etc/passwd','WolfXFCE/Documents/escape'):
                try: broker.user_storage_path(conn,'test',relative)
                except ValueError: pass
                else: raise AssertionError(f"Home escape allowed: {relative}")
            assert 'escape' not in {i['name'] for i in broker.user_storage(conn,'test','list','WolfXFCE/Documents')['items']}
            broker.user_storage(conn,'test','delete','WolfXFCE/Documents/large.dat')
            assert not big.exists() and outside.read_text() == 'private VM data'
            try: broker.user_storage(conn,'test','delete','')
            except ValueError: pass
            else: raise AssertionError('Deleted home root')

            snapshot = broker.sync_savegames(conn,'test')
            selected = conn.execute('SELECT id FROM savegame_manifests WHERE file_path=?',(snapshot['path'],)).fetchone()[0]
            (documents/'note.txt').write_text('new data')
            try: broker.user_storage(conn,'test','restore',snapshot_id=selected)
            except ValueError: pass
            else: raise AssertionError('Restored over an active desktop without force')
            real_run = subprocess.run
            def run(command, **kwargs):
                return SimpleNamespace(returncode=0) if command[0]=='chown' else real_run(command,**kwargs)
            with (patch.object(broker,'stop_user_apps'), patch.object(broker.subprocess,'run',side_effect=run),
                  patch.object(broker,'kill_session',return_value={'status':'ok'}) as stop):
                restored = broker.user_storage(conn,'test','restore',snapshot_id=selected,force=True)
                assert restored['status']=='ok' and (documents/'note.txt').read_text()=='desktop data'
                assert stop.call_args.kwargs['stop_apps'] and not stop.call_args.kwargs['backup']
            protected = broker.list_savegames(conn,'test')[0]
            with tarfile.open(protected['file_path'],'r:gz') as archive:
                assert archive.extractfile('WolfXFCE/Documents/note.txt').read()==b'new data'
            bad = root/'unsafe.tar.gz'
            with tarfile.open(bad,'w:gz') as archive:
                entry=tarfile.TarInfo('../outside.txt'); entry.size=3; archive.addfile(entry,io.BytesIO(b'bad'))
            conn.execute('UPDATE savegame_manifests SET file_path=? WHERE id=?',(str(bad),selected));conn.commit()
            with patch.object(broker,'kill_session') as stop:
                try: broker.user_storage(conn,'test','restore',snapshot_id=selected,force=True)
                except tarfile.FilterError: pass
                else: raise AssertionError('Malicious backup accepted')
                stop.assert_not_called()
            assert outside.read_text()=='private VM data'
            broker.user_storage(conn,'test','delete-backup',snapshot_id=selected)
            assert not bad.exists()
            with (patch.object(broker,'notify_hyprland_user'), patch.object(broker,'kick_live_readers'),
                  patch.object(broker,'stop_live_stream'), patch.object(broker,'stop_user_apps'),
                  patch.object(broker,'wolf_api',side_effect=RuntimeError('driver failure'))):
                assert broker.kill_session(conn,'wolf-123',backup=False)['status']=='error'
                assert conn.execute("SELECT 1 FROM active_sessions WHERE session_id='wolf-123'").fetchone()
        finally:
            conn.close()

parser=argparse.ArgumentParser();parser.add_argument('--native-tap',action='store_true');args=parser.parse_args()
if args.native_tap:
    with tempfile.TemporaryDirectory(dir='/tmp/sockets') as tmp:
        sock=str(Path(tmp)/'test.sock')
        command=['docker','exec','wolf','timeout','20','gst-launch-1.0','-q','fakesrc',
            'is-live=true','format=time','sizetype=fixed','sizemax=1316','datarate=131600','sync=true','!',
            'identity','drop-allocation=true','!',
            'application/octet-stream','!','unixfdsink',f'socket-path={sock}','wait-for-connection=false','sync=false','async=false']
        producer=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        deadline=time.monotonic()+5
        while not Path(sock).exists() and time.monotonic()<deadline:time.sleep(.05)
        assert Path(sock).is_socket()
        for _ in range(3):
            data=subprocess.check_output(['gst-launch-1.0','-q','unixfdsrc',f'socket-path={sock}','num-buffers=5','!','fdsink','fd=1','sync=false'],timeout=5)
            assert len(data)==5*1316 and producer.poll() is None, (len(data),producer.poll())
        # App changes may briefly keep two pipelines for the same client alive.
        successor_command=command.copy()
        successor_command.insert(successor_command.index('fakesrc')+1,'num-buffers=200')
        successor=subprocess.Popen(successor_command,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        successor_sock=sock+'.0'
        for _ in range(40):
            if Path(successor_sock).is_socket(): break
            time.sleep(.05)
        assert Path(successor_sock).is_socket(), successor.stderr.read().decode()
        data=subprocess.check_output(['gst-launch-1.0','-q','unixfdsrc',f'socket-path={successor_sock}','num-buffers=5','!','fdsink','fd=1','sync=false'],timeout=5)
        assert len(data)==5*1316 and producer.poll() is None
        assert successor.wait(timeout=5)==0, successor.stderr.read().decode()
        assert Path(sock).is_socket() and not Path(successor_sock).exists()
        reader=subprocess.Popen(['gst-launch-1.0','-q','unixfdsrc',f'socket-path={sock}','!','fdsink','fd=1','sync=false'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        time.sleep(.3);reader.kill();reader.wait();time.sleep(.2)
        assert producer.poll() is None, producer.stderr.read().decode()
        assert producer.wait(timeout=23)==124, producer.stderr.read().decode()
    print('UnixFD nativo: lettori ricollegati/terminati e cambio app sovrapposto senza errore della pipeline OK')

print("Wolf desktop: input, lease, file isolati, ripristino protetto, errori di disconnessione e tap OK")
