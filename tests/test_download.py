"""Tests for the friendly authentication errors in utils/download.py."""

import io

import httpx
import pytest
from huggingface_hub.errors import GatedRepoError, RepositoryNotFoundError

import muscriptor.utils.download as dl


@pytest.mark.parametrize("exc", [GatedRepoError, RepositoryNotFoundError])
def test_gated_repo_maps_to_model_download_error(monkeypatch, exc):
    response = httpx.Response(
        status_code=401,
        request=httpx.Request("GET", "https://huggingface.co/api/models/x"),
    )

    def fake_download(repo_id, filename):
        raise exc("401 Client Error", response=response)

    monkeypatch.setattr(dl, "hf_hub_download", fake_download)
    with pytest.raises(dl.ModelDownloadError) as e:
        dl.download_if_necessary("hf://MuScriptor/muscriptor-medium/model.safetensors")
    msg = str(e.value)
    assert "hf auth login" in msg
    assert "HF_TOKEN" in msg
    assert "https://huggingface.co/MuScriptor/muscriptor-medium" in msg


def _fake_urlopen(body: bytes, seen: dict):
    """Stand in for urllib.request.urlopen: records kwargs, serves `body`."""

    def fake(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return io.BytesIO(body)

    return fake


def test_http_download_uses_timeout(monkeypatch, tmp_path):
    """Plain http(s) downloads must not hang forever on a stalled server."""
    import urllib.request

    monkeypatch.setattr(dl, "_CACHE_DIR", tmp_path)
    seen: dict = {}
    monkeypatch.setattr(
        urllib.request, "urlopen", _fake_urlopen(b"weights-bytes", seen)
    )
    dest = dl.download_if_necessary("https://example.com/model.safetensors")
    assert dest.read_bytes() == b"weights-bytes"
    assert seen["timeout"] == dl._DOWNLOAD_TIMEOUT_S


def test_http_download_without_filename(monkeypatch, tmp_path):
    """A URL with no trailing filename still maps to a file, not the cachedir."""
    import urllib.request

    monkeypatch.setattr(dl, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen(b"x", {}))
    dest = dl.download_if_necessary("https://example.com/")
    assert dest.is_file()
    assert dest.parent == tmp_path
