"""Deterministic public source/static archives from a clean, reviewed Git tree."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]

def archive(files, prefix, output):
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode='w', format=tarfile.PAX_FORMAT) as tar:
        for name, raw, mode in sorted(files):
            entry = tarfile.TarInfo(prefix + '/' + name)
            entry.size = len(raw); entry.mode = mode; entry.uid = entry.gid = 0
            entry.uname = entry.gname = ''; entry.mtime = 0
            tar.addfile(entry, io.BytesIO(raw))
    with output.open('xb') as target:
        with gzip.GzipFile(fileobj=target, filename='', mode='wb', mtime=0, compresslevel=9) as packed:
            packed.write(payload.getvalue())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/public-release')
    args = parser.parse_args()
    destination = (ROOT / args.output).resolve()
    assert not destination.exists(), 'Use a fresh release output directory'
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT).strip(), 'Tracked source must be committed'
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')[:-1]
    source = []
    for name in tracked:
        path = ROOT / name
        assert not path.is_symlink() and path.is_file()
        assert not name.startswith(('evidence/', 'output/', 'releases/', '.private/', 'node_modules/'))
        source.append((name, path.read_bytes(), 0o755 if name.endswith('.sh') else 0o644))
    build = (ROOT / 'releases/current-build.txt').read_text().strip()
    subprocess.check_call(['node', 'scripts/verify-remote.mjs'], cwd=ROOT)
    site = ROOT / 'releases' / build
    static = [(str(p.relative_to(site)), p.read_bytes(), 0o644) for p in site.rglob('*') if p.is_file()]
    destination.mkdir(parents=True, mode=0o700)
    version = json.loads((ROOT / 'package.json').read_text())['version']
    source_file = destination / f'hermes-remote-web-{version}-source.tar.gz'
    static_file = destination / f'hermes-remote-web-{version}-{build}-static.tar.gz'
    archive(source, 'hermes-remote-web', source_file)
    archive(static, build, static_file)
    receipt = {'schema': 'hermes_remote_web_oss_release_v1', 'version': version, 'build': build,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
        'sourceTree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT).decode().strip(),
        'sourceFiles': len(source), 'staticFiles': len(static), 'productionMutation': 0,
        'realProviderGeneration': 'NOT_RUN', 'physicalIPhone': 'NOT_RUN',
        'compatibility': json.loads((ROOT / 'compatibility.json').read_text())}
    (destination / 'release-manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    rows = []
    for path in sorted(destination.iterdir()):
        rows.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name)
    (destination / 'SHA256SUMS').write_text('\n'.join(rows) + '\n')
    print(json.dumps({'status': 'PACKAGED_NOT_PUBLISHED', 'version': version, 'build': build, 'sourceCommit': receipt['sourceCommit'], 'files': len(rows)}))

if __name__ == '__main__':
    main()
