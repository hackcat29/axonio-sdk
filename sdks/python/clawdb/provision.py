from __future__ import annotations

import asyncio
import os
import shutil
import socket
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(frozen=True)
class ProvisionResult:
    endpoint: str
    api_key: str | None


def _is_port_open(host: str, port: int, timeout: float = 0.2) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def _platform_id() -> str:
    import platform
    import sys

    machine = platform.machine().lower()
    if sys.platform == 'linux' and machine in ('x86_64', 'amd64'):
        return 'linux-x64'
    if sys.platform == 'linux' and machine in ('aarch64', 'arm64'):
        return 'linux-arm64'
    if sys.platform == 'darwin' and machine in ('x86_64', 'amd64'):
        return 'darwin-x64'
    if sys.platform == 'darwin' and machine in ('arm64', 'aarch64'):
        return 'darwin-arm64'
    if sys.platform == 'win32' and machine in ('x86_64', 'amd64'):
        return 'win32-x64'
    raise RuntimeError(f'Unsupported platform: {sys.platform}-{machine}')


def _download_binary() -> Path:
    platform_id = _platform_id()
    bin_dir = Path.home() / '.clawdb' / 'bin'
    bin_dir.mkdir(parents=True, exist_ok=True)

    archive_name = f'clawdb-server-{platform_id}.tar.gz'
    archive_path = bin_dir / archive_name

    for base in _release_base_candidates():
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            archive_resp = client.get(f'{base}/{archive_name}')
            if archive_resp.status_code >= 400:
                continue
            archive_path.write_bytes(archive_resp.content)
            return archive_path

    raise RuntimeError('Unable to locate downloadable clawdb-server release archive')


def _release_base_candidates() -> list[str]:
    configured = os.getenv('CLAWDB_SERVER_RELEASE_BASE_URL', '').strip()
    candidates = [
        configured,
        'https://github.com/Claw-DB/ClawDB/releases/latest/download',
        'https://github.com/clawdb/clawdb/releases/latest/download',
        'https://github.com/claw-db/clawdb/releases/latest/download',
    ]
    return list(dict.fromkeys([candidate for candidate in candidates if candidate]))


def _binary_name() -> str:
    return 'clawdb-server.exe' if os.name == 'nt' else 'clawdb-server'


def _installed_binary_path() -> Path:
    return Path.home() / '.clawdb' / 'bin' / _binary_name()


def _path_binary() -> str | None:
    return shutil.which('clawdb-server')


def _extract_binary(archive_path: Path) -> Path:
    bin_dir = archive_path.parent
    final_binary = _installed_binary_path()

    with tarfile.open(archive_path, 'r:gz') as archive:
        archive.extractall(bin_dir)

    candidates = [
        bin_dir / f'clawdb-server-{_platform_id()}',
        bin_dir / 'clawdb-server',
        bin_dir / 'clawdb-server.exe',
    ]
    extracted = next((candidate for candidate in candidates if candidate.exists()), None)
    if extracted is None:
        raise RuntimeError('Downloaded archive did not contain clawdb-server binary')

    if extracted != final_binary:
        extracted.replace(final_binary)
    if os.name != 'nt':
        final_binary.chmod(0o755)
    return final_binary


def _spawn_local_server(binary: str | Path) -> None:
    env = os.environ.copy()
    env.setdefault('CLAW_GUARD_JWT_SECRET', 'clawdb-sdk-local-dev-secret')
    env.setdefault('CLAW_VECTOR_ENABLED', 'false')
    subprocess.Popen(
        [str(binary), '--grpc-port', '50050'],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


async def _wait_for_local_server(timeout_s: float = 5.0) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout_s
    while asyncio.get_running_loop().time() < deadline:
        if _is_port_open('127.0.0.1', 50050):
            return True
        await asyncio.sleep(0.1)
    return False


async def resolve_endpoint() -> ProvisionResult:
    from clawdb._http import CLOUD_ENDPOINT

    explicit_url = (os.getenv('CLAWDB_URL') or '').strip()
    api_key = (os.getenv('CLAWDB_API_KEY') or '').strip() or None
    if explicit_url:
        # Keep the key: a cloud or self-hosted URL may need it.
        return ProvisionResult(endpoint=explicit_url, api_key=api_key)

    if api_key:
        return ProvisionResult(endpoint=CLOUD_ENDPOINT, api_key=api_key)

    if _is_port_open('127.0.0.1', 50050):
        return ProvisionResult(endpoint='http://localhost:50050', api_key=None)

    try:
        path_binary = _path_binary()
        if path_binary:
            _spawn_local_server(path_binary)
            if await _wait_for_local_server():
                return ProvisionResult(endpoint='http://localhost:50050', api_key=None)

        installed_binary = _installed_binary_path()
        if installed_binary.exists():
            _spawn_local_server(installed_binary)
            if await _wait_for_local_server():
                return ProvisionResult(endpoint='http://localhost:50050', api_key=None)

        archive_path = _download_binary()
        extracted_binary = _extract_binary(archive_path)
        _spawn_local_server(extracted_binary)
        if await _wait_for_local_server():
            return ProvisionResult(endpoint='http://localhost:50050', api_key=None)
    except Exception as exc:
        raise RuntimeError(
            'Unable to auto-provision local clawdb-server. Start clawdb-server manually, set CLAWDB_URL, or set CLAWDB_API_KEY.'
        ) from exc

    raise RuntimeError(
        'Unable to auto-provision local clawdb-server. A local server did not become healthy after startup.'
    )
