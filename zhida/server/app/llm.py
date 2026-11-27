from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from .config import get_settings

ProgressCb = Callable[[dict], Awaitable[None] | None]
logger = logging.getLogger("zhida.llm")


class LLMError(RuntimeError):
    pass


def _extract_json(text: str) -> Any:
    text = (text or "").strip()
    if not text:
        raise LLMError("empty llm response")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        return json.loads(fence.group(1).strip())
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    raise LLMError("failed to parse json from llm")


async def _emit(on_progress: ProgressCb | None, payload: dict) -> None:
    if not on_progress:
        return
    maybe = on_progress(payload)
    if asyncio.iscoroutine(maybe):
        await maybe


# 复用连接，避免每次建连开销
_http_client: httpx.AsyncClient | None = None


def _client(timeout: int) -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=timeout)
    return _http_client


def _usage_meta(model: str, purpose: str, usage: dict | None, *, streamed: bool) -> dict:
    """只记接口返回的真实 token，绝不按字数估算。"""
    usage = usage or {}
    prompt = int(usage.get("prompt_tokens") or 0)
    completion = int(usage.get("completion_tokens") or 0)
    return {
        "model": model,
        "purpose": purpose,
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "tokens_accurate": bool(prompt > 0 or completion > 0),
        "streamed": streamed,
    }


async def _chat_json_once(
    *,
    url: str,
    headers: dict,
    payload: dict,
    model: str,
    purpose: str,
    on_progress: ProgressCb | None,
) -> tuple[dict, dict]:
    client = _client(get_settings().llm_timeout)
    # 优先流式：边收边推进度；要求末包带回 usage，避免假算 token
    stream_payload = dict(payload)
    stream_payload["stream"] = True
    stream_payload["stream_options"] = {"include_usage": True}
    content_parts: list[str] = []
    last_chars = 0
    usage: dict = {}
    try:
        async with client.stream("POST", url, headers=headers, json=stream_payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                # 部分网关不认 stream_options：去掉后再试一次流式
                if resp.status_code == 400 and "stream_options" in stream_payload:
                    raise httpx.HTTPStatusError(
                        f"stream_options unsupported: {body[:200]!r}",
                        request=resp.request,
                        response=resp,
                    )
                raise httpx.HTTPStatusError(
                    f"stream http {resp.status_code}: {body[:200]!r}",
                    request=resp.request,
                    response=resp,
                )
            async for line in resp.aiter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    data_str = line[5:].strip()
                else:
                    data_str = line.strip()
                if not data_str or data_str == "[DONE]":
                    if data_str == "[DONE]":
                        break
                    continue
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                if isinstance(chunk.get("usage"), dict):
                    usage = chunk["usage"]
                delta = (((chunk.get("choices") or [{}])[0]).get("delta") or {}).get("content") or ""
                if not delta:
                    delta = (((chunk.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
                if delta:
                    content_parts.append(delta)
                    chars = sum(len(p) for p in content_parts)
                    if chars - last_chars >= 48 or chars < 64:
                        last_chars = chars
                        await _emit(
                            on_progress,
                            {
                                "event": "delta",
                                "chars": chars,
                                "text": delta[-80:],
                                "message": f"AI 生成中… {chars} 字",
                            },
                        )
        content = "".join(content_parts)
        if not content.strip():
            raise LLMError("empty stream content")
        parsed = _extract_json(content)
        if not isinstance(parsed, dict):
            raise LLMError("llm json root must be object")
        meta = _usage_meta(model, purpose, usage, streamed=True)
        if not meta["tokens_accurate"]:
            logger.warning("llm stream missing usage purpose=%s; tokens left as 0 (no estimate)", purpose)
        return parsed, meta
    except Exception as stream_exc:
        # stream_options 不被支持时：无 options 再流一次；仍无 usage 则非流式（可拿到真实 usage）
        if "stream_options" in str(stream_exc).lower() or "stream_options" in stream_payload:
            try:
                stream_payload.pop("stream_options", None)
                content_parts = []
                last_chars = 0
                usage = {}
                async with client.stream("POST", url, headers=headers, json=stream_payload) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        data_str = line[5:].strip() if line.startswith("data:") else line.strip()
                        if not data_str or data_str == "[DONE]":
                            if data_str == "[DONE]":
                                break
                            continue
                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(chunk.get("usage"), dict):
                            usage = chunk["usage"]
                        delta = (((chunk.get("choices") or [{}])[0]).get("delta") or {}).get("content") or ""
                        if delta:
                            content_parts.append(delta)
                            chars = sum(len(p) for p in content_parts)
                            if chars - last_chars >= 48 or chars < 64:
                                last_chars = chars
                                await _emit(
                                    on_progress,
                                    {
                                        "event": "delta",
                                        "chars": chars,
                                        "text": delta[-80:],
                                        "message": f"AI 生成中… {chars} 字",
                                    },
                                )
                content = "".join(content_parts)
                if content.strip() and usage:
                    parsed = _extract_json(content)
                    if not isinstance(parsed, dict):
                        raise LLMError("llm json root must be object")
                    return parsed, _usage_meta(model, purpose, usage, streamed=True)
            except Exception:  # noqa: BLE001
                pass
        # 非流式兜底：usage 以接口为准
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        parsed = _extract_json(content)
        if not isinstance(parsed, dict):
            raise LLMError("llm json root must be object")
        return parsed, _usage_meta(model, purpose, data.get("usage"), streamed=False)


async def chat_json(
    system: str,
    user: str,
    *,
    purpose: str = "",
    max_tokens: int | None = None,
    temperature: float | None = None,
    on_progress: ProgressCb | None = None,
) -> tuple[dict, dict]:
    settings = get_settings()
    cfg = settings.resolve_llm()
    if not cfg["api_key"]:
        raise LLMError("llm api key missing")

    url = f"{cfg['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    # 规划类 JSON（含多阶段 materials）需要更大输出，避免截断导致解析失败回落本地
    default_cap = settings.llm_max_tokens if purpose.startswith("plan") else min(settings.llm_max_tokens, 1200)
    token_budget = int(max_tokens or default_cap)
    payload = {
        "model": cfg["model"],
        "temperature": settings.llm_temperature if temperature is None else temperature,
        "max_tokens": token_budget,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
    }

    last_err: Exception | None = None
    # 规划类请求失败只重试 1 次，避免用户空等
    retries = 1 if purpose.startswith("plan") else settings.llm_max_retries
    started = time.perf_counter()
    for attempt in range(max(1, retries + 1)):
        try:
            parsed, meta = await _chat_json_once(
                url=url,
                headers=headers,
                payload=payload,
                model=cfg["model"],
                purpose=purpose,
                on_progress=on_progress,
            )
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            meta = dict(meta)
            meta["latency_ms"] = elapsed_ms
            logger.info(
                "llm ok purpose=%s model=%s latency_ms=%s prompt_tokens=%s completion_tokens=%s",
                purpose,
                meta.get("model"),
                elapsed_ms,
                meta.get("prompt_tokens"),
                meta.get("completion_tokens"),
            )
            return parsed, meta
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            # 个别网关不支持 response_format 时降级重试
            if "response_format" in payload and "response_format" in str(exc).lower():
                payload.pop("response_format", None)
                continue
            if "400" in str(exc) and "response_format" in payload:
                payload.pop("response_format", None)
                continue
            # JSON 截断/损坏时抬高 token 再试一次
            if purpose.startswith("plan") and attempt == 0 and (
                isinstance(exc, json.JSONDecodeError) or "Expecting" in str(exc) or "JSON" in str(exc)
            ):
                payload["max_tokens"] = min(max(token_budget * 2, 4096), 8192)
                continue
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.warning(
        "llm failed purpose=%s latency_ms=%s err=%s",
        purpose,
        elapsed_ms,
        last_err,
    )
    raise LLMError(str(last_err) if last_err else "llm failed")
